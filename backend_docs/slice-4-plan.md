# Slice 4 — Durable execution, reliability & observability

Status: **APPROVED and IMPLEMENTED 2026-11-13** (deviations in §12)
Date: 2026-11-12
Builds on: Slices 0–3 ([architecture](architecture.md))

## Goal

Turn reconciliation from "one record, run inside the request" into a **durable background workflow**:

- **Batch runs:** reconcile many records at once ("all invoices of vendor V-1001", "every vendor in the VMS").
- **Crash safety:** a run survives a worker dying at any point and finishes exactly once, with no duplicate discrepancies and no records skipped.
- **Bounded retries:** transient source-system failures are retried with backoff, permanent ones fail fast, and both carry a typed error.
- **Unattended recovery:** stuck runs and in-flight corrections (`APPLYING`) are recovered without anyone calling a tool.
- **One trace per request:** a single trace follows an agent's tool call → the queued job → every adapter call → every SQL statement, plus metrics an operations team can alert on.
- **Database-enforced tenant isolation:** PostgreSQL row-level security (RLS) as defence in depth. A query that forgets its tenant filter returns nothing, not someone else's data.

The MCP surface stays at **the same 8 tools**. Batch runs are one optional parameter on `start_reconciliation`.

---

## 1. Key decision: what runs the background work

Both options sit behind a `RunExecutor` interface, so the reconciliation logic doesn't care which is used.

| | **A. PostgreSQL job queue** (recommended) | **B. Celery + Redis** (as listed in CLAUDE.md) |
|---|---|---|
| Enqueue | `INSERT INTO run_jobs` **in the same transaction** that creates the run | `task.delay()` after the run is committed |
| Lost or phantom jobs | Impossible: the run and its job commit or roll back together | Possible: a crash between the commit and `delay()` leaves a run with no job. Needs a transactional outbox plus a relay to be safe. |
| Claiming | `SELECT … FOR UPDATE SKIP LOCKED` with a lease (`locked_until`) and heartbeat | Broker visibility timeout + `acks_late`; Redis is not a durable store by default |
| Retry / backoff state | Columns on the job (`attempts`, `not_before`), visible via SQL | Inside the broker; the database must still hold the durable state |
| Infrastructure | none new | Redis + Celery workers (+ beat for scheduled sweeps) |
| Throughput ceiling | Thousands of jobs per minute on one Postgres, far beyond this workload | Higher; matters at very large scale |

**Recommendation: A.** The hard part of a background workflow is keeping "the database says X" and "the queue says Y" consistent. With A there is only one system to keep consistent. This deviates from CLAUDE.md's Redis/Celery suggestion, which says "or an equivalent task system". The `RunExecutor` interface keeps a Celery executor (with an outbox) possible later, if scale ever needs it.

---

## 2. Batch runs

`start_reconciliation` gains an optional `selection`. Existing callers are unaffected:

```json
{"reconciliation_type": "invoice_to_po",
 "selection": {"filter": {"vendor_id": "V-1001"}, "limit": 500},
 "idempotency_key": "…"}
```

- Exactly one of `source_refs` (one record, as today) or `selection` (a filter on the **declared** source-A fields, pushed down to the adapter) must be given.
- Every run has a hard cap (default 1,000 records; configurable per tenant) to bound cost and run time.
- Each source-A record becomes one `reconciliation_entities` row with its own `status` (`DONE` / `FAILED`) and typed `error`. **A bad record doesn't sink the run.** The run is `COMPLETED_WITH_DISCREPANCIES` (or `COMPLETED`), and `summary.entities_failed` is above 0. A run is `FAILED` only if the selection itself fails, or retries are exhausted.
- `get_reconciliation_status` gains progress: `entities_total`, `entities_done`, `entities_failed`, `attempts`, `next_retry_at`.

**Inline vs queued:**
- A single-record run executes **inline** (as today), so an agent gets its answer in one call.
- A batch run is **queued**. `start_reconciliation` returns at once with `status: PENDING` and the `run_id`, and the tool description tells the agent to poll `get_reconciliation_status`.
- Optional, if time permits: MCP resource-update notifications for `reconciliation://runs/{id}`, so clients that subscribe don't need to poll.

This also fixes a Slice 1 limitation: a queued start completes its idempotency record immediately with the `PENDING` response. A retry returns the same `run_id`, and nothing is left `IN_PROGRESS`.

---

## 3. Durable execution: leases, chunks, recovery

```text
txn  run (PENDING) + run_jobs row (+ traceparent) + audit                      commit
worker  claim:  UPDATE run_jobs SET locked_by, locked_until = now()+60s
               WHERE id = (SELECT id … WHERE state='queued' AND not_before <= now()
                           ORDER BY not_before FOR UPDATE SKIP LOCKED LIMIT 1)
        heartbeat every 20s extends locked_until
        process the selection in chunks of 50 records; each chunk is one transaction
            (entities + discrepancies + evidence + progress + audit)
        finish: run final status + job done                                    commit
```

- **Restart-safe chunks:** each chunk commits together. On a retry, the worker skips records that already have a `DONE` entity. A new constraint `UNIQUE (run_id, source_a_record_id)` and the existing discrepancy fingerprint make double-processing impossible, even if two workers overlap.
- **Lease expiry = crash detection:** if a worker dies, its lease lapses, and another worker reclaims the job (`attempts + 1`) and continues from the last committed chunk.
- **Run deadline:** a run that exceeds its wall-clock limit (default 15 minutes) fails with `RUN_DEADLINE_EXCEEDED`, which is retryable.

### Sweeper (inside the worker; a PostgreSQL advisory lock makes exactly one instance active)

| Every | Finds | Does |
|---|---|---|
| 30s | jobs with an expired lease | puts them back in the queue (or fails them once `max_attempts` is reached) |
| 60s | proposals stuck in `APPLYING` for more than 2 minutes | runs the Slice 2 recovery path: `find_change` → finish the bookkeeping, or retry the same idempotent write. The audit actor is `system:recovery`. |
| 10 min | approvals past their expiry | marks them `EXPIRED`, reopens the discrepancy (apply already refuses these; this keeps the queue honest) |
| 1h | expired idempotency records | deletes them |

---

## 4. Retries and timeouts

| Layer | Policy |
|---|---|
| Adapter call | A `RetryingAdapter` wrapper (the adapters themselves stay free of business logic) retries **only** errors marked `retryable` (unavailable, timeout): 3 attempts, exponential backoff with jitter (0.2s → 1.6s), capped by the per-call timeout. |
| Job | A run failing with a retryable error is rescheduled: `not_before = now() + 30s × 2^attempt` (± jitter), up to 5 attempts, then `FAILED` with the last typed error. Non-retryable errors (`RECORD_NOT_FOUND`, `INVALID_REFERENCE`…) fail immediately. |
| Per record (batch) | A non-retryable error on one record marks only that entity `FAILED` and the run continues. A retryable error retries the whole chunk via the job. |
| Timeouts | per adapter call (exists) → per chunk → per run deadline → per job lease. Each is smaller than the next. |

Every retry and give-up is an audit event (`run.retry_scheduled`, `run.failed`) and a metric.

---

## 5. Observability (OpenTelemetry)

The MCP SDK already wraps every MCP request in an OpenTelemetry span (`tools/call start_reconciliation`, with `gen_ai.tool.name`). It's a no-op until an OpenTelemetry SDK is configured. This slice configures it and adds the rest:

- **Configuration:** standard `OTEL_*` environment variables (for example `OTEL_EXPORTER_OTLP_ENDPOINT`). Telemetry stays off unless configured. A `docker compose --profile observability` adds Jaeger for local viewing.
- **Spans:**
  - FastAPI (HTTP) and SQLAlchemy (every query), via the standard instrumentations
  - service spans (`reconciliation.execute`, `resolution.apply`…)
  - adapter spans (`adapter.find_entities`, with `data_source` and `entity_type`)
  - worker spans: `run_job.process` is **linked to the originating tool call** through a `traceparent` stored on the job row, so one trace runs from the agent to the worker
- **Logs:** each JSON log line gains `trace_id` / `span_id` next to `correlation_id`, so logs and traces join up.
- **Metrics:**
  - `reconcile.tool.duration` and `reconcile.tool.errors` (by tool and outcome)
  - `reconcile.run.duration`
  - `reconcile.discrepancies` (by type and severity)
  - `reconcile.queue.depth` and `reconcile.queue.oldest_age_seconds`
  - `reconcile.adapter.duration` and `reconcile.adapter.errors` (by data source)
  - `reconcile.proposals` (by action and outcome)
  - `reconcile.approval.wait_seconds`
- **Privacy:** spans and metrics carry IDs, types, counts and codes only. They never carry evidence values, amounts, document excerpts, rationale text or tokens. A test enforces this.
- **Health:** `/readyz` reports database status and the time since the last worker heartbeat. The worker exposes `/healthz` on its own port.

---

## 6. Row-level security (defence in depth)

- The app connects as a **non-owner** role `reconcile_app`. Migrations run as the owner, and RLS is `FORCE`d.
- Every transaction first runs `SET LOCAL app.tenant_id = '<uuid>'`, through one SQLAlchemy `after_begin` hook that reads the current tenant from a context variable set by the principal resolver.
- Policies on every tenant table: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. **With no tenant set, queries return zero rows, so the system fails closed.**
- Cross-tenant maintenance (claiming jobs, sweeping) uses two things: the `run_jobs` table, which holds IDs only and has no business data, and narrow `SECURITY DEFINER` functions (e.g. `stuck_applying_proposals()` returning `(tenant_id, proposal_id)` pairs). Each item is then processed under its own tenant.
- The simulated ERP/VMS schemas stand in for the customer's own systems and are out of RLS scope. The existing composite foreign keys and tenant-scoped queries stay; RLS is the third layer, not a replacement.

---

## 7. Schema changes (migration `0004`)

```text
run_jobs              id, tenant_id, run_id UNIQUE, state (queued|running|done|failed), attempts, max_attempts,
                      not_before, locked_by, locked_until, last_error JSONB, traceparent, created_at, updated_at
                      INDEX (state, not_before) — the claim query
reconciliation_runs   + selection JSONB, + deadline_at, + execution ('inline'|'queued')
reconciliation_entities + source_a_record_id, + status (DONE|FAILED), + error JSONB
                      UNIQUE (run_id, source_a_record_id)
worker_heartbeats     worker_id PK, started_at, last_seen_at, version
roles / RLS           reconcile_app (no BYPASSRLS), policies on all tenant tables, FORCE RLS, grants,
                      SECURITY DEFINER sweep functions
```

---

## 8. New runtime pieces

- `uv run reconcile-worker`: claims and processes jobs, heartbeats, runs the sweeper (only when it holds the advisory lock), and shuts down gracefully on SIGTERM. On shutdown it stops claiming, finishes the current chunk, and releases its lease.
- `RunExecutor` interface with `InlineExecutor` (single-record runs, tests) and `QueuedExecutor`.
- `RetryingAdapter` wrapper, applied by the adapter registry.
- `observability.configure_telemetry()`, called by the HTTP app, the worker and the CLI.

---

## 9. Tests to add

- **Crash recovery:** a worker claims a batch job, commits 2 of 4 chunks, then "dies" (stops without releasing its lease). After the lease expires, a second worker finishes the run. Every record is processed exactly once, with no duplicate entities or discrepancies, and `attempts == 2`.
- **No double claims:** 5 workers race on 20 jobs, and each job is processed once.
- **Transactional enqueue:** a rolled-back run leaves no job, and a committed run always has one.
- **Retries:** a transient adapter failure followed by success completes; a permanent error fails immediately; exhausting attempts → `FAILED` with the last error; backoff times grow.
- **Batch:** a mixed batch (some matched, some missing a counterpart, one unreadable document) → per-entity results, `entities_failed == 1`, and the run is not `FAILED`.
- **Sweeper:** a stuck `APPLYING` proposal is completed without a second write; expired approvals are closed; only one sweeper runs at a time (advisory lock).
- **RLS:** as `reconcile_app`, a query with no tenant set returns 0 rows; tenant A's session can't read or update tenant B's rows even via raw SQL; the existing isolation tests still pass with RLS on.
- **Telemetry** (in-memory exporter): one trace contains the MCP tool span → service span → adapter spans → SQL spans, plus the linked worker span; metrics are recorded; no span attribute contains an amount, excerpt or rationale.
- **Regression:** all 141 existing tests pass, and both scripted demos still work (single-record runs stay inline).

---

## 10. Order of work

1. Migration 0004 (jobs, entity status, run selection, heartbeats) and the `RunExecutor` interface. The inline executor keeps current behaviour.
2. Batch selection in the service, with chunked, restart-safe processing and per-entity status.
3. Worker: claim, lease, heartbeat, graceful shutdown; job-level retries with backoff.
4. `RetryingAdapter`; run deadlines.
5. Sweeper (expired leases, `APPLYING` recovery, expired approvals, idempotency cleanup) with the advisory lock.
6. OpenTelemetry: setup, spans, `traceparent` propagation to jobs, metrics, log correlation; the Jaeger compose profile.
7. RLS: roles, policies, the `after_begin` tenant hook, `SECURITY DEFINER` sweep functions; run the whole suite under RLS.
8. Docs and demo: a batch run of all V-1001 invoices queued from MCP and processed by the worker, with the worker killed mid-run and recovered; the trace shown in Jaeger.

---

## 11. Decisions to confirm

1. **PostgreSQL job queue instead of Celery + Redis**, behind a `RunExecutor` interface. *Recommended:* transactional enqueue removes the lost-job problem by design.
2. **Batch runs via an optional `selection` on `start_reconciliation`** (still 8 tools), with a default cap of 1,000 records per run. *Recommended.*
3. **Single-record runs stay inline; batch runs are queued** (the agent polls status). *Recommended.*
4. **Per-record failures don't fail the run**; they're counted in `entities_failed`. *Recommended.*
5. **RLS in this slice** (new app role, fail-closed policies). *Recommended:* it's the last missing isolation layer from the original plan. The alternative is deferring it to Slice 5.
6. **Telemetry off by default**, with a local Jaeger profile for demos. *Recommended.*

---

## 12. Implementation notes (deviations from this plan)

| Area | Planned | Implemented | Why |
|---|---|---|---|
| `RunExecutor` interface | separate executor protocol with inline and queued executors | single-record runs execute inline inside `ReconciliationService.start`; batches go through `JobQueue.enqueue` (same transaction) plus `execute_queued`, run by the worker | One fewer abstraction. A Celery variant would replace `JobQueue` and the worker loop; the service's `execute_queued` (restart-safe, chunked) stays as is. |
| Run deadline | `deadline_at` column | per-attempt wall-clock deadline held in memory; exceeding it raises retryable `RUN_DEADLINE_EXCEEDED` | A deadline stored on the run would also apply to the retry, which would then fail immediately. Each attempt resumes from the last committed chunk anyway. |
| Reclaiming dead workers' jobs | sweeper re-queues expired leases | the claim query itself also picks up `running` jobs whose lease expired (while attempts remain); the sweeper only fails jobs whose **last** attempt died | Recovery doesn't wait for a sweep cycle. |
| App database role | login role `reconcile_app` | `NOLOGIN` role; the service connects as its login user and runs `SET ROLE reconcile_app` on every pooled connection | No password in migrations or config. In production, use a dedicated login user that is a member of the role. |
| Declaring the tenant to PostgreSQL | context variable + global hook | every service session is opened with `tenant_session(factory, tenant_id)`; an `after_begin` hook runs `set_config('app.tenant_id', …, true)` for that transaction | Explicit at every call site and impossible to "forget" across async tasks. Sessions with no tenant see nothing. |
| `tenants` table | under RLS | readable directory (no RLS), write access revoked from the app role | Resolving a token's tenant slug happens before a tenant is known. |
| Batch with only failed records | — | run `FAILED` with `ALL_RECORDS_FAILED` | A "completed" run with zero successful records would mislead. |
| Single-record runs | — | any error still fails the run (as in Slices 1–3); per-record isolation applies to batches | For one record, the record *is* the run. |
| Selection validation | — | field **names** are checked at start; a filter on a field the adapter doesn't expose fails the run with `INVALID_REFERENCE` when the worker executes it | Keeps `start_reconciliation` free of source-system I/O. |
| SQL tracing | standard instrumentation | standard instrumentation with `skip_dep_check=True` | `opentelemetry-instrumentation-sqlalchemy` 0.66b2 declares support for SQLAlchemy < 2.1 only and silently did nothing on 2.1. Verified that spans are created and correctly parented on 2.1 (including async sessions); revisit when it declares 2.1. |
| Resource-update notifications | optional | not implemented | Polling `get_reconciliation_status` (with progress counts) covers it. |
