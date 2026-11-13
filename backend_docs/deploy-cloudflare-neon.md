# Deploy Reconcile MCP on Cloudflare Containers + Neon

This is a backend-only deployment. It deploys the existing Python MCP/REST
application from the repository's Dockerfile. It does not deploy or require
the React frontend.

## Why a Worker entry point is required

The Reconcile MCP application is a Dockerized FastAPI/Python service. A
Cloudflare Worker cannot infer that Docker service from `npx wrangler deploy`
by itself. The repository therefore includes:

- `wrangler.jsonc`: declares a Worker entry point and a Cloudflare Container
  image built from the existing root `Dockerfile`.
- `cloudflare/worker.ts`: a small Worker/Durable Object proxy that forwards
  requests to the Python container on port 8090.
- `package.json`: pins Wrangler so the build does not use an ephemeral
  `npx` install.

There is deliberately no `assets.directory` setting. This is not a static
website. Cloudflare Containers build and deploy the Docker image alongside
the Worker. See the official [Containers getting started guide](https://developers.cloudflare.com/containers/get-started/)
and [Wrangler container configuration](https://developers.cloudflare.com/containers/configuration/wrangler/).

## Architecture

- Cloudflare Worker: public HTTPS entry point and request router.
- Cloudflare Container: runs the existing Python FastAPI + MCP server.
- Neon PostgreSQL: durable application state and job queue.

The Worker routes all requests to one named Durable Object/container. Keeping
one stable Python process is important because the MCP Streamable HTTP session
manager keeps sessions in process memory.

The public MCP endpoint will be:

```text
https://<worker-name>.<workers-subdomain>.workers.dev/mcp
```

The same service exposes `/healthz`, `/readyz`, and the existing
`/api/v1` approval/configuration endpoints.

## 1. Cloudflare project settings

Use **Workers Builds / Workers**, not Pages.

- Git repository: `tejas4123/reconcile-mcp`
- Production branch: `deploy/production-readiness` initially
- Root directory: repository root (`.`); do not select `frontend`
- Build command: leave empty (Wrangler builds the Worker and container)
- Deploy command: `npx wrangler deploy`

The deploy command in the error log was not itself wrong for a Worker
Container deployment. The missing piece was the Wrangler configuration and
Worker entry point. With `wrangler.jsonc` at the repository root, Wrangler
can identify the Worker script and its Docker image instead of looking for
static files.

Cloudflare's Workers Builds environment can build Dockerfile-based Containers.
For local CLI deployment, Docker must be running. The Docker image must be
compatible with `linux/amd64`.

## 2. Neon database setup

Create a Neon production project and create two database logins:

- Migration/owner login: used only to run Alembic.
- Application login: a non-owner login, member of `reconcile_app`.

Use the Neon **direct** connection URL initially for both roles. The
application code executes `SET ROLE reconcile_app` when a DB connection is
created and uses transaction-scoped `set_config('app.tenant_id', ...)` for
RLS. Do not switch to Neon's pooled connection until this session/role
behavior has been explicitly tested with your chosen pooling mode.

Connection strings must use the SQLAlchemy psycopg format:

```text
postgresql+psycopg://ROLE:PASSWORD@HOST/DBNAME?sslmode=require
```

### Run migrations before first service request

From the repository root, after installing the project dependencies:

```bash
uv sync
RECONCILE_MIGRATION_DATABASE_URL='postgresql+psycopg://OWNER:...@HOST/DBNAME?sslmode=require' uv run alembic upgrade head
```

The Alembic environment prefers `RECONCILE_MIGRATION_DATABASE_URL` and falls
back to `RECONCILE_DATABASE_URL` for local development. Do not put the owner
URL in the Cloudflare runtime Worker secrets.

Migration `0004` creates `reconcile_app NOLOGIN NOBYPASSRLS` and grants it
to the migration connection's CURRENT_USER. After the migration, connect as
the database owner and grant it to your application login:

```sql
GRANT reconcile_app TO reconcile_app_login;
```

Replace `reconcile_app_login` with the actual application login role. The
application login must not be a superuser, table owner, or have BYPASSRLS.

Before sending production traffic, test the RLS boundary with two tenant
identities and verify that a session with no tenant context sees no tenant
rows. Prefer a disposable Neon branch for rehearsal before production.

## 3. Configure Cloudflare runtime variables and secrets

The Worker passes its environment to the Python container. Set the following
in **Workers & Pages → reconcile-mcp-server → Settings → Variables and Secrets**
(or with `npx wrangler secret put NAME` from the repository root).

Required runtime settings:

| Name | Value |
|---|---|
| `RECONCILE_ENV` | `prod` (already in `wrangler.jsonc`) |
| `RECONCILE_DB_APP_ROLE` | `reconcile_app` (already configured) |
| `RECONCILE_DATABASE_URL` | Neon application login URL |
| `RECONCILE_JWT_JWKS_URL` | Production identity provider JWKS endpoint |
| `RECONCILE_JWT_ISSUER` | Exact issuer claim from the identity provider |
| `RECONCILE_JWT_AUDIENCE` | `reconcile-mcp` (already configured) |
| `RECONCILE_JWT_TENANT_CLAIM` | Tenant claim name, default `tenant` |
| `RECONCILE_PUBLIC_BASE_URL` | Exact public Worker URL, without `/mcp` |
| `RECONCILE_ALLOWED_HOSTS` | `["container:*"]` (the private internal host used by the Worker-to-container hop) |
| `RECONCILE_ALLOWED_ORIGINS` | JSON array of explicitly trusted MCP client origins; use `[]` if callers do not send Origin headers |

The following are already configured in `wrangler.jsonc`:
`RECONCILE_HTTP_HOST=0.0.0.0`, `RECONCILE_HTTP_PORT=8090`,
`RECONCILE_DOCUMENTS_ROOT=/data/documents`, and `RECONCILE_LOG_LEVEL=INFO`.

Set sensitive values as **Worker secrets**, never in `wrangler.jsonc`,
`package.json`, or source code. In particular, do not expose the Neon
connection string or JWT signing credentials.

Example commands (Wrangler prompts for each value):

```bash
npx wrangler secret put RECONCILE_DATABASE_URL
npx wrangler secret put RECONCILE_JWT_JWKS_URL
npx wrangler secret put RECONCILE_JWT_ISSUER
npx wrangler secret put RECONCILE_PUBLIC_BASE_URL
```

Set `RECONCILE_ALLOWED_ORIGINS` as a Worker variable or secret using valid
JSON. If an MCP client sends an Origin header, its exact origin must be
allowlisted. Do not use a wildcard origin in production.

**Important ordering:** deploy the Worker, set all required runtime variables
and secrets, run the database migrations, and only then make the first request
to the Worker URL. The first request creates/starts the container; the
application must have valid settings and a migrated database before that
happens.

## 4. Deploy

The repository includes a root `package.json` with Wrangler pinned to the
version shown in the deployment log. In Workers Builds, use:

```bash
npx wrangler deploy
```

For local deployment, first ensure Docker is running and the Wrangler account
is authenticated:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler builds the existing `Dockerfile`, publishes the image, and deploys
the Worker/Container configuration. The first Container provisioning can take
several minutes. A Worker URL may appear before its Container is ready; allow
the initial provisioning to finish and check the container status/logs.

## 5. Verify

After all runtime secrets are configured and migrations have run:

- `GET /healthz` should return HTTP 200.
- `GET /readyz` should return HTTP 200 when PostgreSQL is reachable.
- An MCP request without a bearer token should receive an authentication
  challenge.
- Invalid or expired tokens should be rejected.
- A valid identity-provider token should initialize Streamable HTTP and allow
  `tools/list`, `resources/list`, and `prompts/list`.
- Verify tenant isolation using two provisioned tenant identities.
- Verify the approval API rejects callers without `recon:approve`.

The Worker uses a single named container to preserve MCP session affinity.
Do not increase `max_instances` or route requests to random container IDs
without first designing MCP session affinity and shared session handling.

## 6. Important limitations / remaining deployment work

### Background batch worker

This Cloudflare Worker configuration deploys the HTTP/MCP service only.
The project also has a separate long-running `reconcile-worker` process for
batch jobs, retries and the sweeper. That process is not started by the HTTP
container. Batch reconciliation will remain queued until the worker is
deployed separately or adapted to an appropriate Cloudflare background-job
design. Do not claim batch processing is live until this is complete.

### Document persistence

The Dockerfile creates `/data/documents`, but the current Cloudflare Container
configuration does not attach durable shared document storage. The repository
currently uses a local filesystem demo adapter. Do not store real customer
documents there; implement a tenant-scoped durable object-storage adapter
before customer document processing.

### Source-system adapters

The ERP, VMS and CRM schemas are simulated. This deployment makes the
demonstration server remotely reachable; it does not create SAP, Dynamics,
Salesforce, SharePoint or other production integrations.

## 7. Rollback

Keep the previous Worker version available and roll back the Worker/container
deployment if health or MCP protocol smoke tests fail. Do not automatically
downgrade the PostgreSQL schema; Alembic downgrades can be destructive. Use a
reviewed forward-fix or restore plan.
