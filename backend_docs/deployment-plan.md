# Deployment plan — Cloudflare + Neon + dashboard (Stage 7)

Status: **APPROVED 2026-11-13 (defaults).** Phase 2a done (§6); Phases 2b–3 next; cloud steps (Phase 4) wait for the Workers Paid plan and login emails.
Date: 2026-11-13

## 1. Audit findings (Phase 1)

### What exists

| Area | Finding | Source |
|---|---|---|
| Repository | Python 3.12 service (`src/reconcile_mcp`): FastAPI host, MCP SDK `mcp>=2.3` (`MCPServer`, Streamable HTTP at `/mcp`), SQLAlchemy 2.1 async + psycopg 3, Alembic migrations `0001`–`0006`, 263 passing tests, CI, Docker Compose | repo |
| Dockerfile | Multi-stage `python:3.12-slim`, non-root, port 8090, one image with several entry points (`reconcile-mcp-http`, `reconcile-worker`, `reconcile-seed`, `alembic`) | `Dockerfile` |
| REST today | `/api/v1/proposals` (list, detail, decision), `/api/v1/admin/types…` (configuration), `/healthz`, `/readyz`, OAuth protected-resource metadata | `interfaces/http/routes.py` |
| Missing for a dashboard | list runs, dashboard statistics, start a run over REST, run detail / discrepancies / explanation / evidence / audit over REST (these exist as services and MCP tools, not as REST routes) | services vs routes |
| Auth | JWT bearer only: HS256 (dev) or JWKS (`RECONCILE_ENV=prod` requires JWKS). Tenant and scopes come from token claims | `security/` |
| **Cloudflare** | The account has **one Worker, `remote-obsidian-mcp`**, created 2026-11-12. It is **not** part of Reconcile. There is **no Wrangler config in this repository**. | Cloudflare API (read-only) |
| **Neon** | One project, `my-first-project` (PostgreSQL **18**, aws-us-east-2). Its database holds `notes`, `note_revisions` and `sync_events`: **the Obsidian project's data, not Reconcile's.** | Neon API (read-only) |
| Local tooling | Node 24, npm 11, Docker 28 on **arm64** (Cloudflare Containers need `linux/amd64` images, so the image is cross-built). Wrangler isn't installed yet. | local |

**So "already deployed" applies to a different project.** Reconcile has no Worker and no database in the cloud yet. I won't modify `remote-obsidian-mcp` or the Obsidian tables. The plan creates **new, separate** resources.

### Constraints that shape the design

1. **Python Workers can't run this backend.** Cloudflare's docs state that async SQLAlchemy isn't supported (no greenlet), and that `threading`/`multiprocessing` don't work in Pyodide. The service is async SQLAlchemy, plus a background worker loop, plus uvicorn. **→ Cloudflare Containers** run the existing Docker image unchanged.
2. **Containers need the Workers Paid plan** ($5/month, which includes 25 GiB-hours of memory, 375 vCPU-minutes and 200 GB-hours of disk per month; usage beyond that is billed). They are billed only while running, and can sleep when idle.
3. **Neon's pooled endpoint (PgBouncer, transaction mode) is incompatible with the app** because of three session-level features:
   - every connection runs `SET ROLE reconcile_app` once, for row-level security
   - the sweeper holds a session advisory lock
   - psycopg uses prepared statements

   **→ use Neon's direct (unpooled) connection string.** The connection pool in the app is small (10 + 10), well within Neon's direct connection limits.
4. **Container disks are ephemeral.** The document adapter reads files from `RECONCILE_DOCUMENTS_ROOT`, written by the seed. Those files disappear when an instance stops.
5. **MCP Streamable HTTP sessions are held in memory per instance.** A session must keep reaching the same container instance.
6. **Cloudflare Access can protect the dashboard but not `/mcp`.** MCP clients (Inspector, Claude, Foundry) send bearer tokens and can't do an Access browser login.

---

## 2. Target architecture

```mermaid
flowchart LR
  subgraph Users
    B[Browser: dashboard user]
    M[MCP client: Inspector / Claude / agent]
  end
  subgraph CF[Cloudflare]
    A[Cloudflare Access\n(dashboard + /api only)]
    W[Worker: reconcile-mcp\nStatic Assets: React SPA\n+ gateway & token issuer]
    subgraph C[Container: existing Docker image]
      H[reconcile-mcp-http :8090\nFastAPI: /api/v1, /mcp, /healthz, /readyz]
      K[reconcile-worker\nbatch jobs + sweeper]
    end
  end
  N[(Neon PostgreSQL\nNEW project 'reconcile-mcp'\ndirect connection, TLS)]

  B -- HTTPS --> A --> W
  M -- "HTTPS + Bearer JWT\n/mcp (no Access)" --> W
  W -- "/api/* (Worker-minted JWT\nfor the Access user)" --> H
  W -- "/mcp, /.well-known/* (passthrough)" --> H
  H --> N
  K --> N
  H -. "JWKS: verifies RS256 tokens\nsigned by the Worker" .-> W
```

**One new Worker (`reconcile-mcp`), separate from `remote-obsidian-mcp`:**
- **Static Assets** serve the React app (`not_found_handling: "single-page-application"`).
- `run_worker_first: ["/api/*", "/mcp", "/mcp/*", "/healthz", "/readyz", "/.well-known/*", "/auth/*"]` sends those paths to the Worker code. Everything else is served as static assets, never reaching the container.
- **Why one Worker for both dashboard and gateway:** they share one origin, so there's no CORS and no third-party cookies. Splitting into two Workers adds a second deploy and CORS configuration with no security gain, because the API's real protection is token verification in the Python service. The existing Obsidian Worker stays fully separate either way.

**The container** runs the **unchanged** image with a small entrypoint script that:
1. re-renders the synthetic documents (see §3.4)
2. starts `reconcile-mcp-http` and `reconcile-worker` in the same instance, supervised so that if either exits, the container exits

Other container settings:
- Instance type `basic` (¼ vCPU, 1 GiB) to start.
- All requests go to **one named instance (`primary`)**, which satisfies the in-memory MCP session constraint. Horizontal scaling needs sticky routing by `Mcp-Session-Id` or stateless MCP mode; that's documented as a later step.
- Inactivity timeout of 15 minutes. Batch jobs survive sleep because the queue is durable: a job interrupted by sleep has its lease expire and resumes from its last committed chunk on the next wake. That is the existing, tested crash-recovery path.

**Neon:** a **new project** (`reconcile-mcp`). Schema via Alembic `0001`–`0006`, run once from a trusted machine using the owner role. The app connects as the owner login and `SET ROLE`s to `reconcile_app`, exactly as today.

---

## 3. Design decisions

### 3.1 Authentication: Cloudflare Access + Worker-issued tokens (recommended)

| Caller | How it authenticates | What the Python service sees |
|---|---|---|
| Dashboard user | Cloudflare Access login (one-time PIN by email, or GitHub/Google) | The Worker verifies the Access JWT, maps the email to a tenant and scopes (a small allowlist in Worker config), and **mints a 5-minute RS256 JWT** (`sub` = email, `tenant`, `scope`). It forwards the request with that token. The browser never sees a backend token or any secret. |
| MCP client | `Authorization: Bearer <JWT>` | Verified by the existing `JWTTokenVerifier` via JWKS. `/mcp` isn't behind Access. |
| Getting an MCP token | The dashboard's **MCP connection settings** page: a logged-in user can mint a **short-lived agent token** for their tenant with `recon:read run propose apply` only (**never `approve` or `admin`**). It's shown once, with a ready-made MCP Inspector configuration. | Same JWKS verification |

- The Worker publishes `/.well-known/jwks.json`. The container sets `RECONCILE_JWT_JWKS_URL` to it, plus `RECONCILE_ENV=prod`. The private signing key is a **Worker secret**.
- **Four-eyes still holds:** agents propose under their token's subject; a human approves in the dashboard under their email. The proposer can never approve (service check plus database trigger).
- **Alternative (not recommended):** paste dev-minted tokens into the dashboard. It's quick, but it puts long-lived bearer tokens in the browser, and `RECONCILE_ENV=prod` refuses HS256.
- **Later:** replace the Worker issuer with the customer's IdP (Entra ID). The backend needs no change, only a different JWKS URL.

### 3.2 REST endpoints to add (thin wrappers over existing services)

| Endpoint | Service | Scope | New service code? |
|---|---|---|---|
| `GET /api/v1/types` | `ReconciliationService.list_types` | read | no |
| `GET /api/v1/stats` | new `ReportingService.stats` (counts by run status, open discrepancies by severity, proposals awaiting approval, last 7 days) | read | **yes** (read-only, tenant-scoped, RLS) |
| `GET /api/v1/runs?status=&type=&cursor=` | new `ReportingService.list_runs` (keyset pagination) | read | **yes** |
| `POST /api/v1/runs` | `ReconciliationService.start` (same idempotency key semantics as the MCP tool) | run | no |
| `GET /api/v1/runs/{id}` | `get_status` | read | no |
| `GET /api/v1/runs/{id}/discrepancies` | `list_discrepancies` | read | no |
| `GET /api/v1/discrepancies/{id}` | `ExplanationService.explain` (evidence, derivations, match, proposals) | read | no |
| `GET /api/v1/runs/{id}/evidence` | new: the evidence records of a run, filterable by source and document (evidence explorer) | read | **yes** (read-only) |
| `GET /api/v1/runs/{id}/audit` | `AuditQueryService.page` | read | no |
| existing `/api/v1/proposals…` | approvals queue and decisions | read / approve | no |

- MCP tools and REST call the **same service objects** (one `Services` instance in `create_app`).
- The dashboard **doesn't propose or apply** in v1. That stays agent work through MCP, so the demo shows the agent/human split. Approve and reject happen in the dashboard.

### 3.3 Dashboard (React + Vite + TypeScript + Tailwind)

The pages from your brief:
- **Dashboard:** live counts from `/stats`
- **Runs:** filterable list with pagination
- **Create reconciliation:** type picker from `/types`, plus source ref or batch filter
- **Run details:** status, progress, discrepancies
- **Discrepancy details:** explanation, evidence, derivations, proposals
- **Evidence explorer:** document excerpts with line references, structured-record values
- **Approvals:** queue; detail with checks and evidence; approve or reject with optimistic concurrency
- **Audit logs**
- **MCP connection settings:** endpoint, token minting, Inspector configuration, the effective rules per type

Implementation:
- A typed API client generated from FastAPI's OpenAPI schema (`openapi-typescript`), so frontend types can't drift from the Pydantic models.
- TanStack Query for loading, error and empty states. React Router.
- No hardcoded numbers, no optimistic "success" toasts: success is shown only from the server's response.
- No secrets in `VITE_*` variables; the frontend has no configuration beyond relative URLs.

### 3.4 Documents on an ephemeral disk

The seed records its reference date (in the documents data source's config). A new `reconcile-seed --render-documents-only` re-renders the same synthetic documents for that date at container start, so the content and hashes are identical across restarts and evidence stays valid.

The full reset (`reconcile-seed`) is a one-off job run from a trusted machine, never from the dashboard. Production would put documents in R2 or a document management system behind the same adapter contract. That's documented as a remaining risk.

### 3.5 Configuration and secrets

| Setting | Where |
|---|---|
| `RECONCILE_DATABASE_URL` (Neon **direct**, `sslmode=require`) | Worker secret → container `env` |
| JWT signing private key | Worker secret (Worker only) |
| `RECONCILE_JWT_JWKS_URL`, `RECONCILE_JWT_ISSUER`, `RECONCILE_JWT_AUDIENCE`, `RECONCILE_ENV=prod` | Worker vars → container `env` |
| `RECONCILE_PUBLIC_BASE_URL`, `RECONCILE_ALLOWED_HOSTS`, `RECONCILE_ALLOWED_ORIGINS` | the public hostname (the SDK's DNS-rebinding protection rejects other `Host` headers) |
| Access team domain + application audience, user→tenant/scopes allowlist | Worker vars |
| Frontend | none |

### 3.6 Operations
- **Health:** the Worker's `/healthz` checks the Worker itself; `/readyz` is forwarded to the container (database plus worker heartbeat). Container logs and Worker logs go to Workers Observability, with JSON logs carrying the existing correlation and trace IDs.
- **Migrations:** `alembic upgrade head` against Neon's direct URL, from a trusted machine (later, a CI job with a protected secret). Each migration is first rehearsed on a **Neon branch**. Rollback is `alembic downgrade` or Neon point-in-time restore (6-hour history on this plan).
- **Deploy and rollback:** `wrangler deploy` builds and pushes the amd64 image and the assets; `wrangler rollback` reverts the Worker version. Container rollouts follow Cloudflare's rollout behaviour. All of this is written up in `docs/deployment.md`.

---

## 4. Implementation phases (each ends with tests run and a report)

| Phase | Work | Proof |
|---|---|---|
| 2a Backend | `ReportingService` (stats, runs list, run evidence) + REST routes + tests; `--render-documents-only`; container entrypoint; PostgreSQL 18 compatibility run (local `postgres:18` container running the full suite) | the suite passes on PG16 **and** PG18 |
| 2b Frontend | `web/` React app with all pages, the typed client, and component tests; served locally against the Compose stack | the dashboard drives a real local backend |
| 3 Integration | Worker gateway (`worker/`): Access JWT verification, RS256 token minting + JWKS, request routing, MCP token page API; Worker unit tests | `wrangler dev` with the local container image |
| 4 Cloud | **With your go-ahead:** create the Neon project; rehearse migrations on a branch, then migrate main; set Worker secrets; `wrangler deploy`; configure the Access application | URLs respond; `/readyz` reports the database and worker as ready |
| 5 Remote MCP | MCP Inspector (`npx @modelcontextprotocol/inspector`) against `https://…/mcp` with a minted token: discovery, a tool call, resources, prompts, error format, session lifecycle; plus an automated remote contract script | recorded output |
| 6 End to end | The finance (₹125,000 vs ₹120,000) and vendor compliance flows against the deployed system: the agent over remote MCP, approval in the dashboard, verification and audit | recorded output |
| 7 Delivery | URLs, migration status, test results, security limitations, remaining risks | `docs/deployment.md` |

---

## 5. Decisions I need from you

1. **Neon:** create a **new project `reconcile-mcp`** (recommended; isolates it from the Obsidian data and its credentials), or a separate database inside `my-first-project`?
2. **Cloudflare plan:** Containers need **Workers Paid ($5/month plus usage beyond the included amounts)**. Is the account on it, or OK to upgrade? Without it, the Python backend can't run on Cloudflare at all.
3. **Hostname:** `reconcile-mcp.<your-subdomain>.workers.dev` (no setup needed), or a custom domain you own on Cloudflare (e.g. `reconcile.example.com`, with `/mcp` on the same host)?
4. **Login:** Cloudflare Access (Zero Trust free tier, up to 50 users) with email one-time PIN. Which email(s), and with what roles? For example: you as `acme-india` with `recon:read recon:run recon:approve`, and a second email for `recon:admin`. Configuration and approval should ideally be different people (§3.1).
5. **Demo data in the cloud:** seed the synthetic Acme and Globex data into the new Neon project (recommended, since the end-to-end tests in Phase 6 need it)?

Shelved by this change of direction: the Slice 8 evaluation-harness proposal (`docs/slice-8-plan.md`) stays on disk, unbuilt.

---

## 6. Progress log

### Phase 2a — backend (done)
- **PostgreSQL 18:** the full suite passes on PG18 as well as PG16.
- **Found and fixed a managed-Postgres blocker (migration `0007`).** Tenant tables used `FORCE ROW LEVEL SECURITY`, so the *owner* was subject to RLS too. That only worked locally because the local owner is a superuser.
  - With a non-superuser owner, which is how Neon works, the seed failed with `new row violates row-level security policy for table "reconciliation_types"`, and the sweeper's `SECURITY DEFINER` functions would have seen no rows.
  - **Fix:** RLS stays enabled but not forced. The application still never queries as the owner (it always runs `SET ROLE reconcile_app`, a non-owner with NOBYPASSRLS), so tenant isolation is unchanged. A new test pins this.
  - The full suite now passes as a **non-superuser owner without BYPASSRLS** on PG18, which is stricter than Neon, and CI runs that configuration on every push.
- **Dashboard REST API:**
  - `GET /api/v1/stats`, `/types`, `/runs` (keyset pagination, filters), `POST /api/v1/runs`
  - `GET /api/v1/runs/{id}`, `…/discrepancies`, `…/evidence`, `…/audit`, `GET /api/v1/discrepancies/{id}`
  - Thin wrappers over the same services as MCP, plus a new read-only `ReportingService`. Contract tests cover the flow, idempotent replay, tenant isolation (404 for another tenant) and scopes (401/403).
- **Ephemeral documents:** the seed records its reference date; `reconcile-seed --render-documents-only` reproduces the documents byte for byte (tested).
- **Container runtime:** `reconcile-all` re-renders the documents, then runs the HTTP server and the worker under a supervisor. Verified in Docker:
  - ready with a live worker heartbeat
  - killing the worker stops the instance with the worker's exit status
  - SIGTERM shuts down gracefully, with exit status 0
- Totals: 267 tests (PG16 and PG18), ruff, mypy strict and `alembic check` all clean.


### Phase 4 (partial) — Neon deployed; Cloudflare backend blocked on the Free plan
- **Neon project `reconcile-mcp`** (`cool-unit-61258166`, aws-ap-southeast-1, PostgreSQL 18.7), database `reconcile`, owner `reconcile_owner`. It's separate from the Obsidian project.
  - The app uses the **direct** endpoint. Credentials live only in the git-ignored local file `.env.neon` (mode 0600).
- **Migrations `0001`–`0007` applied**, verified in Neon:
  - 21 tables; RLS on 10 tenant tables, none forced
  - `reconcile_app` without BYPASSRLS
  - the owner can `SET ROLE` to it
- **Correction to Phase 2a:** Neon's owner role *does* have `rolbypassrls = true` directly, so `0007` wasn't strictly needed for Neon. It remains correct, and portable to managed Postgres where the owner lacks BYPASSRLS.
- **Seeded** synthetic Acme and Globex data, with seed date 2026-11-12.
- **End-to-end against Neon** (local server and worker → Neon), both scenarios passed:
  - **Finance:** ₹5,000 (4.17%) mismatch detected, hold auto-approved, amendment refused until approved by `controller@acme`, then applied and verified. Neon shows PO-7781 = 125000.0000 (row version 2) and the invoice ON_HOLD.
  - **Vendor compliance:** CRITICAL date mismatch and HIGH expiry breach, both citing `doc://acme-india/COI-V1003-2026#L15`. Hold applied; correction approved by `procurement-lead@acme` and applied; Neon shows V-1003 expiry 2026-11-19, ON_HOLD.
  - The dashboard REST API (`/stats`, `/runs`) returns matching numbers. Tenant isolation holds: Globex sees 0 runs.
- **Cloudflare:** nothing deployed. **Cloudflare Containers are not available on the Free plan** (Cloudflare's Containers pricing lists Free as N/A), and Python Workers can't run the backend (§1). Options:

| Option | Cost | What runs where | Trade-off |
|---|---|---|---|
| **A. Workers Paid** (as planned) | $5/month plus usage beyond the included amounts | Worker (dashboard + gateway) and Container (backend) on Cloudflare; Neon | The intended architecture; everything on Cloudflare |
| **B. Cloudflare Free + Cloudflare Tunnel** | $0 | Dashboard Worker on Free; backend container on a machine you control (your Mac or a small VM), exposed through `cloudflared` | Free and real HTTPS, but only up while that machine runs. A stable hostname needs a domain on your Cloudflare account; a quick tunnel (`*.trycloudflare.com`) is temporary and for testing only |
| **C. Cloudflare Free + another container host** | depends on the host's free tier (to be verified when chosen) | Dashboard Worker on Free; backend on a container platform; Neon | Always on, but outside Cloudflare |

### Phase 3–4 — gateway built and tested; Cloudflare deploy blocked at Containers (Free plan)
- **Production auth without a shared secret:**
  - `reconcile-keys` generates an RS256 key pair. The private key stays in git-ignored `var/keys/` (mode 0600).
  - `reconcile-mint-token --private-key …` issues tokens.
  - The gateway publishes only the public JWKS. The service runs in `RECONCILE_ENV=prod` and verifies tokens with its existing JWKS support.
  - A unit test proves: valid token accepted; wrong key rejected; wrong audience rejected.
- **Gateway Worker (`gateway/`, Wrangler 4.156.0):**
  - serves `/.well-known/jwks.json`
  - routes `/mcp`, `/api/*`, `/healthz`, `/readyz`, OAuth metadata and `/docs` to one named container instance (`primary`), running the existing image's `reconcile-all`
  - the database URL is a Worker secret, passed to the container's environment
- **Tested locally with `wrangler dev`** (real Worker runtime + real container + Neon):
  - JWKS served without private key material
  - cold start to `/readyz` = ready in about 10 s
  - **the full finance flow passed through the gateway with RS256 tokens in prod mode** (detect → explain → hold → approval required → human approval → apply → verified → audit)
- **`wrangler deploy` (2026-11-12):** the Worker script `reconcile-mcp` **was uploaded**. Creating the Container application then failed: `GET /accounts/…/containers/me` returned **401 Unauthorized**.
  - The OAuth token *does* include `containers (write)`, so the account isn't entitled to Containers. That's consistent with Containers requiring Workers Paid.
  - No database secret was uploaded. **The deployed Worker can serve the JWKS, but `/mcp` can't work until a container can start.**

### Free-tier public MCP link (Cloudflare quick tunnel) — working
- **Topology:** MCP client → Cloudflare edge (`*.trycloudflare.com`, HTTPS) → `cloudflared` on the operator's Mac → gateway Worker under `wrangler dev` (the real Workers runtime) → the backend container (`reconcile-all`, `RECONCILE_ENV=prod`) → Neon.
  - It only works while the Mac, `wrangler dev` and `cloudflared` are running. The quick-tunnel hostname changes on every restart.
- **Verified from the public URL:**
  - landing and JWKS pages
  - cold start to ready in about 8 s
  - no or invalid token → **401** with `WWW-Authenticate … resource_metadata=…`
  - OAuth protected-resource metadata advertises the public URL
- **MCP Inspector 2.13.0 (CLI) against the public URL:**
  - 8 tools listed (4 marked read-only), 4 prompts, 5 resource templates, plus `reconciliation://types`
  - `reconciliation://rules/invoice_to_po` read
  - `start_reconciliation` called (INV-2026-0045 → COMPLETED)
  - a bad run id → typed `NOT_FOUND` error (`isError: true`)
  - `prompts/get` returned the vendor-compliance prompt
- **End to end over the public URL (RS256 tokens):**
  - finance: ₹5,000 mismatch → hold → approval required → `controller@acme` approves → PO amended and verified
  - vendor compliance: CRITICAL and HIGH findings with `doc://…#L15` evidence → hold → `procurement-lead@acme` approves → VMS corrected and verified; the expiry breach correctly stays open
- **Demo data:** re-seeded afterwards, so the original discrepancies are present again.
