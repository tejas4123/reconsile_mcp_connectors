# Demo script (about 16 minutes)

Everything runs from a clean Docker environment, with no local Python needed. Verified on 2026-11-13 with `scripts/compose_smoke.sh` (fresh volumes → `docker compose up` → full demo → readiness check), which CI also runs.

## Setup (before the meeting)

```bash
docker compose up -d --build            # postgres -> migrate -> seed -> mcp + worker
curl -s localhost:8090/readyz           # {"status":"ready","worker_last_seen_seconds":0.4}
```

## Run it

```bash
docker compose --profile demo run --rm demo
```

This resets the synthetic data, mints a token for each identity, and runs five acts against the running server and worker. Talk over the output as it appears.

### Act 1: Finance (about 3 minutes)

| Output | What to say |
|---|---|
| `COMPLETED_WITH_DISCREPANCIES {'HIGH': 1}` | "The agent asked one MCP tool to reconcile an invoice against its purchase order." |
| `INR 125,000.00 exceeds … by INR 5,000.00 (4.17%)` + four `evidence` lines | "No LLM computed this. It's decimal arithmetic in the engine. Every finding cites the system, record and field it came from." |
| `HIGH: escalated from MEDIUM because difference 4.17% >= 2%` | "Severity rules are customer configuration (a versioned definition), not code." |
| `HOLD_PAYMENT … approved by policy:auto` | "Low-risk containment is auto-approved by policy, and the audit says the policy approved it, not the agent." |
| `AWAITING_APPROVAL` then `APPROVAL_REQUIRED` | "The agent tried to apply the PO amendment anyway. The server refused. Approval isn't an MCP tool at all, so an agent can't approve its own change." |
| `APPROVED by controller@acme` | "A different human approved over REST. The proposer can never approve, and a database trigger enforces that too." |
| `verification: … 'amount' no longer differs` | "The write was version-checked and idempotent, then re-read and re-compared. *Applied* means *confirmed*." |

### Act 2: Vendor compliance, same server and tools (about 3 minutes)

| Output | What to say |
|---|---|
| `CRITICAL … 365 day(s) later` and `HIGH … expires in 7 day(s) as of …` | "A second agent and a second use case, with the same 8 tools. Only a reconciliation definition and a document adapter were added." |
| `doc://acme-india/COI-V1003-2026#L15  "Policy Expiry: 19-Nov-2026"` | "Evidence from a document is the exact line, with its position and the file hash. It's never paraphrased." |
| `as_of` | "Time is an input. The run records the date it was judged against, and agents can't change it." |
| `date_mismatch RESOLVED`, `expiry_breach OPEN` | "The system record is now correct, but the vendor still needs a renewed certificate, so that finding correctly stays open." |

### Act 3: Batch on the background worker (about 2 minutes)

| Output | What to say |
|---|---|
| `status PENDING` ×2 | "Batches are queued in the same database transaction as the run, so a job can't be lost." |
| `4/4 done … 6/6 done` | "A worker processes records in chunks, each committed separately. If you kill it mid-run, another worker continues from the last chunk. The test suite proves exactly-once processing." |

### Act 4: Contract obligations, a third agent on the same tools (about 3 minutes)

| Output | What to say |
|---|---|
| `derived  renewal_date = effective_date 2025-12-27 + initial_term 12 months = 2026-12-27` | "Contracts rarely state a renewal date; they state a start date and a term. The server derives it with calendar arithmetic, and shows its working." |
| two document `evidence` lines (`Effective Date: …`, `Initial Term: twelve (12) months`) | "A derived value cites *every* line it came from. Nothing was inferred by a model." |
| `CRITICAL … 182 day(s) later` | "The CRM thinks this renews six months later than the contract says, so nobody would have sent notice in time." |
| `notice_deadline_window … expires in 15 day(s)` + `FLAG_FOR_LEGAL_REVIEW … APPROVED` | "The non-renewal notice deadline is itself derived: renewal minus the notice period. It's two weeks away, so it goes to legal immediately, and the flag is auto-approved because it changes nothing." |
| `milestones[M3]: … missing from the ERP payment schedule` + the table row as evidence | "Line-item reconciliation: each contract milestone is matched to an ERP schedule row. This obligation was never set up, so it would never have been invoiced." |
| `APPROVED by legal-ops@acme` → `APPLIED … verification: … no longer differs` ×3 | "Same approval gate, same verified writes, now on the CRM and ERP contract records." |
| `ERP run: RESOLVED` | "Two engine features were added, derived fields and line items, both as generic configuration. No new tools, and nothing contract-specific in the engine." |

### Act 5: Onboarding a customer without code (about 3 minutes)

| Output | What to say |
|---|---|
| `effective: platform v2` and `INV-G-1001: … {'MEDIUM': 1}` | "Globex is a new customer on the platform template. Their finance team says variances under 1% are fine, so today this invoice is noise for them." |
| `UNKNOWN_PATH … (known: amount, currency, vendor)`, `NOT_TUNABLE source_a.data_source`, `LOOSENS_APPROVAL …` | "Configuration is validated deterministically, and every problem comes back at once. A customer can tune thresholds, but can't repoint sources, and can never switch off human approval the platform requires." |
| `fields.amount.tolerance.percent: 0 -> 1.0` | "A tenant version is the platform template plus a small patch, so the customer's real differences stay visible and reviewable." |
| `v2 -> vN: 4 examined, 2 change, 2 finding(s) removed` | "A dry run on the customer's live data before anything changes. Nothing is persisted. This is the 'evaluate the baseline' step of the FDE loop." |
| `vN active by fde@globex` → `INV-G-1001: COMPLETED {} (type_version N)` | "Same agent, same tool call. The rules changed, the integration didn't. The 1.5% invoice is still reported." |
| `reconciliation://rules/invoice_to_po: tenant vN, overrides {…}` | "Agents can see the rules they're judged by, but configuration is REST-only under `recon:admin`; no MCP tool can change it." |
| `INV-2026-0042 … (type_version 2)` | "Acme is untouched: configuration is per tenant." |
| `retired vN; effective: platform v2` | "Rollback is one call. Runs made under vN still explain themselves with vN's rules, because every run pins its version." |

### Optional: traces (about 2 minutes)

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318 docker compose --profile observability up -d
docker compose --profile demo run --rm demo
# http://localhost:16686 → service reconcile-mcp → "tools/call start_reconciliation"
```
Show one trace going from the tool call through service, adapter and SQL spans, and the worker's `run_job.process` linked back to the call that queued it.

## Likely questions

- **Why MCP and not just REST?** Agents discover the tools, prompts and resources with typed schemas, on any MCP platform (Claude, Foundry, OpenAI Agents, LangGraph). REST is kept for what agents must *not* do: approvals.
- **Where is the LLM?** In the agent. The server is deterministic; LLMs explain and choose actions, but arithmetic, dates, validation, permissions and approvals are code.
- **How is one tenant kept from another's data?** Identity comes from the token, never from arguments. There are three layers: tenant-scoped queries, composite foreign keys, and PostgreSQL row-level security (a session with no tenant sees nothing).
- **What if a worker dies mid-write to the ERP?** The intent is recorded before the write, and the write carries a change ID and is version-checked. Recovery checks whether the change landed before ever writing again.
- **Why approve and apply one at a time in act 4?** An approval pins the record version the approver reviewed. If two changes to the same CRM record were approved together, applying the first makes the second stale, and the server refuses it rather than write over a record the approver didn't see.
- **How do you onboard a customer whose rules differ?** Tune the platform template with a patch over the admin API: draft, dry run on their data, activate, roll back if needed. No deploy, no code. See [integration.md](integration.md) §5.
- **How do I add SAP?** Implement the adapter contract and register it; nothing in the engine changes. See [integration.md](integration.md) §4.
- **Why Postgres instead of Celery + Redis?** Writing the job in the same transaction as the run removes the lost-job problem by design. See [slice-4-plan.md](slice-4-plan.md) §1.

## Reset

```bash
docker compose --profile demo run --rm demo      # re-seeds automatically; repeatable
docker compose down -v                           # remove everything, including volumes
```
