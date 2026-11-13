# Operations guide

## Processes

| Process | Command | Scale |
|---|---|---|
| MCP + REST server | `reconcile-mcp-http` | Horizontally. It holds no state; sessions are in memory per replica, so use sticky routing for 2025-era clients. |
| Worker (+ sweeper) | `reconcile-worker` | Horizontally. Jobs are claimed with `SKIP LOCKED`, and only one sweeper runs at a time (advisory lock). |
| Migrations | `alembic upgrade head` | Once per deploy, **before** starting the new version. Run as the database owner. |
| Seed (demo only) | `reconcile-seed` | Never in production. |

On SIGTERM the worker stops claiming new jobs, finishes the current one and exits; allow about 30 seconds of grace. A worker killed outright (OOM, node loss) is safe: its lease expires (60 seconds by default), and another worker resumes the run from the last committed chunk.

## Configuration (`RECONCILE_*` environment variables)

| Variable | Default | Notes |
|---|---|---|
| `ENV` | `dev` | `prod` requires `JWT_JWKS_URL` and forbids `JWT_SECRET` |
| `DATABASE_URL` | — | Login user must be a member of `DB_APP_ROLE` |
| `DB_APP_ROLE` | `reconcile_app` | Role the service `SET ROLE`s to; row-level security applies to it |
| `JWT_JWKS_URL` / `JWT_ISSUER` / `JWT_AUDIENCE` / `JWT_TENANT_CLAIM` | — / … / `reconcile-mcp` / `tenant` | Token verification |
| `JWT_SECRET` | — | HS256, dev/test only (at least 32 bytes) |
| `PUBLIC_BASE_URL` | `http://localhost:8090` | Advertised resource URL |
| `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` | localhost | JSON lists; DNS-rebinding protection |
| `DOCUMENTS_ROOT` | `var/documents` | Document store root (one directory per tenant) |
| `ADAPTER_TIMEOUT_S` | 10 | Per source-system call |
| `IDEMPOTENCY_TTL_HOURS` | 24 | |
| `MAX_BATCH_RECORDS` / `CHUNK_SIZE` | 1000 / 50 | Batch cap; records per transaction |
| `RUN_DEADLINE_S` | 900 | Per attempt; exceeding it is retryable |
| `JOB_MAX_ATTEMPTS` / `JOB_LEASE_S` / `JOB_BACKOFF_BASE_S` | 5 / 60 / 30 | Exponential backoff with jitter |
| `WORKER_POLL_S` / `WORKER_HEARTBEAT_S` / `SWEEP_INTERVAL_S` | 1 / 20 / 30 | |
| `APPLYING_RECOVERY_AFTER_S` | 120 | When the sweeper completes stuck applies |
| `HTTP_HOST` / `HTTP_PORT` | `127.0.0.1` / 8090 | `0.0.0.0` in the container image |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (standard OpenTelemetry variable) | unset | Enables tracing and metrics export (OTLP/HTTP) |

## What to alert on

| Signal | Suggested threshold | Meaning |
|---|---|---|
| `/readyz` not 200 | 2 consecutive failures | Database unreachable |
| `/readyz` `worker_last_seen_seconds` | > 120 | No worker alive; batches will wait |
| `reconcile.queue.oldest_age_seconds` | > 300 | Workers can't keep up, or they keep failing |
| `reconcile.jobs.retries` rate | sustained > 0 | A source system is flapping (check `code`) |
| `reconcile.adapter.errors` by `data_source`, `code` | spike | A source system is down or credentials expired |
| `reconcile.tool.errors` with `outcome=INTERNAL_ERROR` | any | Bug; look up the `correlation_id` in the logs |
| runs with `status=FAILED` (`reconcile.runs`) | spike | Read the run's `error.code` |
| proposals in `APPLYING` > 10 min | any | Sweeper not running or source writes failing |

## Investigating a run

1. `get_reconciliation_status` (or `reconciliation://runs/{id}`) gives the status, progress, typed error, attempts and next retry.
2. `get_reconciliation_audit` gives the ordered history, with actor, client and `correlation_id` for each step.
3. Search the logs by `correlation_id` (JSON); each log line also carries `trace_id`.
4. Open the trace in your tracing backend: tool call → service → adapter → SQL, and for batches the linked `run_job.process`.

## Data and backups

All durable state is in PostgreSQL: runs, discrepancies, evidence, proposals, approvals, audit, jobs. Back up the database; the audit table is append-only. The document store is a directory in this demo; production would read it from SharePoint, S3 or a document management system through an adapter.

## Production-readiness checklist (what this demonstration does not yet do)

- [ ] Real source adapters (SAP, Dynamics, Salesforce, SharePoint…); here the ERP, VMS and CRM are simulated schemas
- [ ] A dedicated database login user (member of `reconcile_app`) and secrets from a secret manager
- [ ] An IdP configured with the claim mapping in [integration.md](integration.md); no HS256 tokens
- [ ] TLS termination and `ALLOWED_HOSTS` set for the real hostname
- [ ] Multi-approver or amount-tiered approval policies, if required
- [ ] A review step for configuration changes (today one `recon:admin` user can draft and activate; a second-person sign-off on activation is a natural extension)
- [ ] A notification channel for approvers (the approval API exists; there is no UI)
- [ ] Retention policies for audit, evidence and idempotency data
- [ ] Load testing of batch sizes and worker counts for the customer's volumes
