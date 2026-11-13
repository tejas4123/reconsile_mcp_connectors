# Slice 5 — Packaging, CI & integration docs

Status: **APPROVED and IMPLEMENTED 2026-11-13** (deviations in §9)
Date: 2026-11-13
Builds on: Slices 0–4 ([architecture](architecture.md))

## Goal

Make Reconcile MCP something another engineering team can **pick up, run and integrate** without reading the code. This covers CLAUDE.md Day 7 and §13's requirement that *"the demo must be repeatable from a clean Docker Compose environment."*

What this slice must prove:
- **One command to a running system:** `docker compose up` on a clean machine gives a migrated, seeded database, the MCP server and a worker, with no local Python needed.
- **Repeatable demo:** both demos (finance and vendor compliance) and the batch run work from that clean environment through one documented command.
- **Every change is checked automatically:** lint, strict types and the full test suite against a real PostgreSQL, plus an image build, on each push and pull request.
- **An integrator knows how to connect:** a client team can connect their agent platform, map their identity provider, and understand the security model and the operational signals, all from the docs.

---

## 1. Container image

One image, several entry points (`reconcile-mcp-http`, `reconcile-worker`, `alembic`, `reconcile-seed`):

- **Multi-stage build** on `python:3.12-slim`: `uv sync --frozen` installs exactly what `uv.lock` pins, and the final stage holds only the virtualenv and the app.
- **Runs as a non-root user**, with no compilers in the final image and a `HEALTHCHECK` on `/healthz`.
- **No secrets baked in:** configuration comes from environment variables only.
- **Network settings for containers:** the server binds `0.0.0.0` inside the container, and `RECONCILE_ALLOWED_HOSTS` / `RECONCILE_ALLOWED_ORIGINS` are configurable. The MCP SDK rejects unexpected `Host` headers (with a 421 error), so this matters behind a real hostname.

## 2. Docker Compose: clean environment to running demo

```text
postgres   (healthy) ─┐
migrate    alembic upgrade head        (runs once, exits 0)
seed       reconcile-seed              (runs once; renders certificates into a shared volume)
mcp        reconcile-mcp-http :8090    (depends on migrate + seed completing successfully)
worker     reconcile-worker            (depends on migrate + seed completing successfully)
jaeger     (profile: observability)
demo       (profile: demo) runs the scripted walkthroughs against mcp, minting dev tokens inside the network
```

- `docker compose up -d` brings up a working system. `docker compose --profile demo run --rm demo` plays the full story: finance → vendor compliance → batch → audit trail.
- The documents folder is a named volume shared by `seed`, `mcp` and `worker`.
- **Dev-only secrets** (the JWT signing secret, the Postgres password) come from `.env` with clearly-labelled defaults. The compose file says plainly that production uses the customer identity provider's JWKS and a secret manager.

## 3. Continuous integration (GitHub Actions)

`.github/workflows/ci.yml`, on each push and pull request:
1. `uv sync --frozen`
2. `ruff check`
3. `ruff format --check`
4. `mypy --strict src`
5. `pytest` against a **PostgreSQL 16 service container** (the suite creates its own test database and migrates it)
6. `alembic check`: the models and migrations must agree
7. `docker build`: the image must build

Actions are pinned to specific versions, permissions are read-only, and dependencies are cached. I'll check the current action versions when writing the workflow.

## 4. Documentation for integrators

| Doc | Contents |
|---|---|
| `docs/integration.md` | **Connecting clients:** Claude Desktop / Claude Code (stdio and remote), the Claude API's MCP connector (needs a public HTTPS URL + bearer token), Azure AI Foundry agents, the OpenAI Agents SDK, LangGraph, and a plain `mcp.Client`. Exact configuration snippets, **checked against each platform's current docs** at writing time. **Identity provider setup:** the claims Reconcile expects (`tenant`, `scope`/`scp`, `sub`, `azp`), how to map them in Microsoft Entra ID (app roles → scopes) and generic OIDC, and why `recon:approve` must never be granted to agent identities. **Adding a source system:** implementing the adapter contract, registering a profile, the write allowlist. **Adding a reconciliation type:** writing and versioning a definition. |
| `docs/demo.md` | A ~10-minute scripted demo for an interview or a customer: what to run, what to point at in the output, what each moment proves (reuse, evidence, approval gate, crash safety, tenant isolation), and likely questions with short answers. |
| `docs/operations.md` | Configuration reference (every `RECONCILE_*` variable), running migrations, scaling workers, the metrics to alert on and suggested thresholds, reading a trace, recovery behaviour, a backup note, and a production-readiness checklist (what this demo deliberately does not do yet). |
| `docs/architecture.md` | A **Mermaid architecture diagram** (renders on GitHub) and a request-flow sequence diagram (detect → propose → approve → apply), replacing the ASCII sketch. |
| `README.md` | Trimmed to a fast path: what it is, a 3-command quick start (Compose), links to the docs above. |

## 5. Small product fixes uncovered while packaging

- **Per-source connection strings:** a PostgreSQL data source can name a secret (`dsn_env: "ERP_DSN"`) instead of reusing the application's own database. This is the minimum needed before pointing at a real customer database; today the adapter always reads through the app's own connection.
- Allowed hosts and origins become configurable (see §1).
- The stdio entry point gets the same SQL tracing as HTTP and the worker.

---

## 6. Tests to add

- A Compose smoke test (`scripts/compose_smoke.sh`, also run in CI as a separate job): from a clean volume, `docker compose up -d --wait`, then the demo profile must exit 0, and `/readyz` must report the database and a fresh worker heartbeat.
- A unit test for the per-source connection string (resolved from the environment, never stored in the database; a missing variable gives a typed `ADAPTER_UNAVAILABLE`).
- The existing 166 tests keep passing.

---

## 7. Order of work

1. Dockerfile and `.dockerignore`; configurable hosts and origins; the per-source connection string.
2. Compose services (migrate, seed, mcp, worker, demo profile, documents volume); the demo runner script.
3. CI workflow (lint, types, tests with Postgres, alembic check, image build, Compose smoke job).
4. Docs: integration (with current platform docs checked), demo, operations, Mermaid diagrams, README trim.
5. A clean-room run: delete the volumes, run `docker compose up`, run the demo, and record the result in `docs/demo.md`.

---

## 8. Decisions to confirm

1. **One image, several entry points,** rather than separate server and worker images. *Recommended:* simpler to build and version.
2. **Compose runs migrations and seeding as one-shot services** before the server and worker start. *Recommended.* The alternative is having the server migrate itself at startup, which is risky with several replicas.
3. **CI includes a Compose smoke job** (slower, around 2–3 minutes) in addition to the unit/integration job. *Recommended:* it's the only proof that the clean-environment demo works.
4. **Integration docs are verified against current platform docs** (Azure AI Foundry, Claude API connector, OpenAI Agents SDK, LangGraph), and say so where something couldn't be verified. *Recommended.*
5. **Use Case B (contract ↔ CRM reconciliation) is out of scope here.** It would mostly be a new definition, a document profile and a simulated CRM, and could be a later slice to show reuse a third time, which fits LegalGraph-style contract intelligence. *Recommended:* keep Slice 5 about packaging.

---

## 9. Implementation notes (deviations from this plan)

| Area | Planned | Implemented | Why |
|---|---|---|---|
| Health check | `HEALTHCHECK` in the image | defined per service in Compose (`mcp` probes `/readyz`) | The worker shares the image but has no HTTP port; an image-level check would mark it unhealthy. |
| Compose smoke | `docker compose up --wait` | `up -d`, then polling `/readyz`, checking that `migrate`/`seed` exited 0, then running the demo | `--wait` handling of one-shot services that exit is not dependable across Compose versions. |
| Smoke isolation | — | own Compose project name and host ports (`reconcile-smoke`, 55444/8091) | The clean-room test can never touch a developer's running stack or volumes. |
| Formatting check in CI | whole repo | `src tests examples` | Ruff also tries to reformat illustrative snippets inside Markdown docs. |
| Action pinning | pinned versions | exact release tags (`actions/checkout@v7.0.1`, `astral-sh/setup-uv@v10.3.2`); `uv` image `0.13.6` | Releases at least two weeks old at the time of writing. Pinning to commit SHAs is a further hardening step. |
| Demo re-runs | — | `run_demo.py` re-seeds first | `docker compose --profile demo run --rm demo` is repeatable as many times as needed. |
| Running the demo | — | starting the `demo` profile recreates `migrate`/`seed` and restarts `mcp`/`worker` (Compose re-applies dependencies) | Harmless (about 10 seconds), and the demo re-seeds anyway. |
