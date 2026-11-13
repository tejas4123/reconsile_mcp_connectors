# Reconcile MCP

Enterprise **reconciliation and exception resolution** as a reusable **Model Context Protocol** server.

Any MCP-capable agent can:
- compare records across disconnected systems
- get discrepancies backed by exact source evidence and deterministic explanations
- propose corrections, which only a **human** can approve
- apply approved corrections safely, with a full audit trail

It works with Claude, Azure AI Foundry, the OpenAI Agents SDK, LangGraph and custom clients.

Three use cases run through **one server and the same 8 tools**:
- **Finance:** invoice ↔ purchase order.
- **Vendor compliance:** vendor-system insurance record ↔ certificate **document**.
- **Contract obligations:** signed contract **document** ↔ CRM (renewal date derived from effective date + term, notice period and deadline) and ↔ ERP (payment terms, every payment milestone vs the payment schedule).

Customers are configured, not coded: a tenant version of a type is a platform template plus a small, validated patch (tolerances, windows, severities, approval rules). Each change is dry-run against the customer's live data, activated, audited and reversible, through a REST admin API that agents can't reach.

> All data is synthetic. The ERP (`erp_sim`), vendor management system (`vms_sim`) and CRM (`crm_sim`) are
> **simulated** PostgreSQL schemas, and the certificates and contracts are generated text files. All of them are reached only through
> adapters, so real systems plug in the same way.

## Quick start (Docker, no local Python)

```bash
docker compose up -d --build                      # postgres → migrate → seed → MCP server + worker
docker compose --profile demo run --rm demo       # the full demo: finance, vendor compliance, batch, contracts, onboarding
```

MCP endpoint: `http://localhost:8090/mcp` (bearer JWT). The ~16-minute walkthrough of the output is in [docs/demo.md](docs/demo.md). Remove everything with `docker compose down -v`.

## Deployment

- [Cloudflare Containers + Neon deployment](docs/deploy-cloudflare-neon.md) — backend-only deployment of the existing Dockerized Python MCP server. No frontend deployment is involved.
- [Operations guide](docs/operations.md) — configuration, scaling, alerts, investigating runs, production-readiness checklist.

## Docs

| | |
|---|---|
| [docs/demo.md](docs/demo.md) | Demo script: what to run, what each step proves, likely questions |
| [docs/integration.md](docs/integration.md) | Connecting Claude Code/Desktop/API, Azure AI Foundry, OpenAI Agents SDK, LangGraph; IdP setup; adding adapters and reconciliation types |
| [docs/tools.md](docs/tools.md) | MCP tools, resources, prompts, scopes, actions, approval API, error codes |
| [docs/operations.md](docs/operations.md) | Configuration, scaling, alerts, investigating runs, production-readiness checklist |
| [docs/architecture.md](docs/architecture.md) | Diagrams, architecture decisions, schema |
| [Slice 2](docs/slice-2-plan.md) · [Slice 3](docs/slice-3-plan.md) · [Slice 4](docs/slice-4-plan.md) · [Slice 5](docs/slice-5-plan.md) · [Slice 6](docs/slice-6-plan.md) · [Slice 7](docs/slice-7-plan.md) | Design records, including what changed during implementation |

## What makes it production-minded

- **Deterministic core.** No LLM inside the server: arithmetic, dates, matching, validation, permissions and approvals are plain code. Agents reason; the server enforces.
- **Every finding has evidence:** the source system, record, field, observed value and time. From documents, the exact line (`doc://…#L15 "Policy Expiry: 19-Nov-2026"`). Derived values (a renewal date computed from the effective date and the term) cite every input line and show the calculation.
- **Configuration without code, safely:** customer rules are validated patches on platform templates, with a dry run on live data before activation, immutable activated versions, one-call rollback, and runs pinned to the version they used. Tenants can tighten approval rules but never loosen them.
- **Agents can't approve.** Approval is a REST call that needs `recon:approve`. The proposer can never decide (four-eyes), enforced by the service and by a database trigger.
- **Safe writes:** re-validated against fresh data, version-checked and idempotent, verified after writing, and recovered after process interruptions.
- **Tenant isolation in three layers:** identity only from the token, composite foreign keys, and PostgreSQL row-level security.
- **Durable batches:** a PostgreSQL job queue, leases, chunked restart-safe processing, bounded retries, and a sweeper.
- **Observable:** OpenTelemetry traces and metrics with structured JSON logs and correlation IDs.

## MCP surface

- **Configure (REST, `recon:admin`, not MCP):** `/api/v1/admin/types/{key}`: drafts, validate, dry run, activate, rollback
- **Detect:** `start_reconciliation` (one record, or a batch via `selection`), `get_reconciliation_status`, `list_discrepancies`, `explain_discrepancy`
- **Resolve:** `propose_resolution`, `validate_resolution`, `apply_resolution`
- **Audit:** `get_reconciliation_audit`

There are also 6 resources and 4 prompts. Details: [docs/tools.md](docs/tools.md).

## Local development

Requirements: Docker, [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env
docker compose up -d --wait postgres     # PostgreSQL 16 on localhost:55433
uv sync
set -a; source .env; set +a
uv run alembic upgrade head
uv run reconcile-seed
uv run reconcile-mcp-http                # MCP at http://localhost:8090/mcp
uv run reconcile-worker                  # (second shell) batches + sweeper
```

To run the scripted walkthroughs against it, mint dev tokens first:
```bash
AGENT=$(uv run reconcile-mint-token --tenant acme-india --subject finance-agent@acme \
  --client-id finance-agent --scopes "recon:read recon:run recon:propose recon:apply")
APPROVER=$(uv run reconcile-mint-token --tenant acme-india --subject controller@acme \
  --client-id approvals-ui --scopes "recon:read recon:approve")
```
Then run any of the finance, vendor compliance, contract obligations or batch walkthrough examples.

## Tests

```bash
uv run pytest
uv run ruff check src tests examples && uv run mypy src
./scripts/compose_smoke.sh
```

CI runs lint, type checking, PostgreSQL-backed tests, migration consistency checks, image builds and a clean-room Compose demo.

## Layout

```text
src/reconcile_mcp/
  domain/            value objects, definitions, action catalog (no I/O)
  engine/            pure matching, comparison, derived fields, line items, policy rules, severity, resolution
  adapters/          SourceAdapter contract, PostgreSQL + document adapters, retries, registry
  documents/         deterministic extraction with verbatim spans
  services/          workflows, job queue, sweeper, idempotency, audit, explanations
  interfaces/mcp     MCP server, tools, resources, prompts
  interfaces/http    FastAPI host: /mcp, /api/v1 approvals + admin configuration, /healthz, /readyz
  security/          JWT verification, principals, scopes
  templates/         versioned reconciliation definitions + synthetic certificate and contract templates
  db/                models, simulated ERP/VMS/CRM tables, Alembic migrations (incl. RLS)
  worker.py · wiring.py · clock.py · observability.py · cli.py
tests/{unit,integration,contract}
examples/
scripts/
cloudflare/          Cloudflare Worker proxy to the Python container
Dockerfile           Python MCP container image
wrangler.jsonc       Cloudflare Worker + Container definition
```

## Known limitations

The source systems are currently simulated behind adapter contracts. Documents use plain-text demo files; PDF extraction and durable tenant-scoped object storage are not yet production-ready. The long-running `reconcile-worker` process must be deployed separately from the Cloudflare HTTP container before batch processing is considered live. See [docs/operations.md](docs/operations.md).
