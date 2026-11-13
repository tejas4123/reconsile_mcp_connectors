# Integration guide

How another team connects its agents to Reconcile MCP, wires up its identity provider, and extends the
server with new source systems and reconciliation types.

The client snippets below were checked against each platform's documentation on **2026-11-13**. Where a
detail could not be confirmed, it says so. Platform APIs move quickly, so re-check the linked page
before relying on a snippet.

---

## 1. The endpoint

| | |
|---|---|
| Transport | MCP **Streamable HTTP** at `https://<host>/mcp` (SSE is not served) |
| Auth | `Authorization: Bearer <JWT>` on every request; `401` + `WWW-Authenticate` otherwise |
| Discovery | OAuth protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` |
| Protocol | MCP 2026-07-28, also serving 2025-era clients from the same endpoint |
| Surface | 8 tools, 5 resources, 3 prompts: see [tools.md](tools.md) |
| Human approval | `POST /api/v1/proposals/{id}/decision` (REST, `recon:approve`), not an MCP tool |

Behind a real hostname, set `RECONCILE_ALLOWED_HOSTS` (JSON list, e.g. `["mcp.example.com"]`) and
`RECONCILE_PUBLIC_BASE_URL`. The MCP SDK answers `421 Misdirected Request` for any unexpected `Host` header.

Local development can use **stdio** (`reconcile-mcp-stdio`). It has no token, so it runs as the
`RECONCILE_DEV_*` identity, and it refuses to start unless `RECONCILE_ENV=dev`.

---

## 2. Connecting clients

### Plain MCP client (Python, `mcp` SDK v2)
```python
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}) as http, \
        Client(streamable_http_client("https://<host>/mcp", http_client=http)) as client:
    result = await client.call_tool("start_reconciliation", {...})
```
This is what `examples/*_walkthrough.py` and the Claude agents in `examples/` use.

### Claude Code
Source: https://code.claude.com/docs/en/mcp
```bash
claude mcp add --transport http reconcile https://<host>/mcp --header "Authorization: Bearer <token>"
```
Equivalent `.mcp.json` entry: `{"type": "http", "url": "https://<host>/mcp", "headers": {"Authorization": "Bearer ${RECONCILE_TOKEN}"}}`.
- The add command doesn't validate the token; a bad token shows up later as a failed connection.
- For local development, `claude mcp add reconcile -- uv --directory /path/to/reconcile-mcp run reconcile-mcp-stdio` uses stdio instead.

### Claude Desktop
Source: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- **Remote server:** add it as a *custom connector* in the app (Customize → Connectors → Add custom connector). Fixed credentials such as a bearer token go in the connector's **request headers** setting.
- **Network:** connections to remote connectors come from Anthropic's cloud, so the server must be reachable from the public internet (or allowlist Anthropic's IP ranges).
- **Local stdio:** use `claude_desktop_config.json` with the `reconcile-mcp-stdio` command (see README).
- *Not verified:* the exact labels in the request-headers dialog.

### Claude API (Messages API MCP connector)
Source: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
```python
response = client.beta.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{"type": "url", "url": "https://<host>/mcp", "name": "reconcile",
                  "authorization_token": token}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "reconcile"}],
    messages=[...],
)
```
- The URL **must be `https://`** and **publicly reachable**, because Anthropic's servers make the calls.
- Every `mcp_servers` entry must be referenced by exactly one `mcp_toolset`.
- Only tools are used (not resources or prompts).
- For a server inside a private network, run the tool loop yourself instead: `examples/common/claude_mcp_loop.py` does exactly that with the Claude API and `mcp.Client`.
- *Not stated by the docs:* the exact header used to send `authorization_token`. Reconcile expects `Authorization: Bearer`.

### Azure AI Foundry (Microsoft Foundry) Agent Service
Source: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/model-context-protocol
```python
from azure.ai.projects.models import MCPTool, PromptAgentDefinition

tool = MCPTool(
    server_label="reconcile",
    server_url="https://<host>/mcp",
    require_approval="always",            # Foundry-side gate; Reconcile still enforces its own approvals
    project_connection_id="reconcile-mcp-conn",
)
```
- The bearer token is **not** an inline field. Create a project connection of type *Custom keys* with key `Authorization` and value `Bearer <token>`, and reference it by name in `project_connection_id`.
- Only remote endpoints are supported; private endpoints need the Standard setup with your own VNet.
- Non-streaming tool calls time out after 100 seconds. Single-record runs finish well within that; use `selection` (queued) for large batches.
- *Not verified* (the page was only partly readable): the full semantics of `allowed_tools` and the minimum SDK versions.

### OpenAI Agents SDK (Python)
Source: https://openai.github.io/openai-agents-python/mcp/
```python
from agents import Agent
from agents.mcp import MCPServerStreamableHttp

async with MCPServerStreamableHttp(
    name="reconcile",
    params={"url": "https://<host>/mcp", "headers": {"Authorization": f"Bearer {token}"}, "timeout": 30},
    cache_tools_list=True,
) as server:
    agent = Agent(name="Finance agent", instructions="...", mcp_servers=[server])
```

### LangChain / LangGraph
Source: https://docs.langchain.com/oss/python/langchain/mcp
```python
from fastmcp.client import Client
from langchain.mcp import MCPAdapter

async with MCPAdapter(Client("https://<host>/mcp", auth=token)) as adapter:   # langchain[mcp] >= 1.4 (beta)
    tools = await adapter.list_tools()
```
The older `langchain-mcp-adapters` package (`MultiServerMCPClient` with `"transport": "http"` and `"headers"`) still works, but its repository is archived.

---

## 3. Identity provider setup

Reconcile is an OAuth 2.1 **resource server**: it verifies tokens and never issues them. In production
set `RECONCILE_JWT_JWKS_URL`, `RECONCILE_JWT_ISSUER` and `RECONCILE_JWT_AUDIENCE`.
`RECONCILE_ENV=prod` refuses to start with a shared HS256 secret.

| Claim | Meaning | Required |
|---|---|---|
| `iss`, `aud`, `exp` | standard checks | yes |
| `sub` | the user or service the agent acts for (recorded as the audit `actor`) | yes |
| `azp` / `client_id` / `appid` | the calling application or agent (recorded as the audit `client_id`) | recommended |
| `tenant` (configurable via `RECONCILE_JWT_TENANT_CLAIM`) | Reconcile tenant slug | yes |
| `scope` (space-separated) or `scp` (list) | permissions below | yes |

| Scope | Give to |
|---|---|
| `recon:read` | agents, reviewers, dashboards |
| `recon:run` | agents that start reconciliations |
| `recon:propose` | agents that propose corrections |
| `recon:apply` | agents that apply **already approved** corrections |
| `recon:approve` | **human approver roles only.** Never grant it to an agent's client identity. Reconcile also blocks self-approval (four-eyes) in the service and in the database. |
| `recon:admin` | customer administrators and FDEs who configure rules. Never agents; keep it separate from `recon:approve`, so the people who set thresholds aren't the people who approve exceptions under them. |

**Microsoft Entra ID:**
- Register Reconcile as an API (set the app ID URI as `aud`), and define the scopes as app roles or delegated scopes.
- Add a `tenant` claim through claims mapping or a directory extension holding the customer's Reconcile tenant slug. Entra's own `tid` is Microsoft's tenant, not Reconcile's.
- Point `RECONCILE_JWT_JWKS_URL` at `https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`.

**Development:** `uv run reconcile-mint-token --tenant acme-india --scopes "recon:read recon:run"` mints HS256 tokens. It's refused when `RECONCILE_ENV=prod`.

---

## 4. Adding a source system (adapter)

1. Implement the `SourceAdapter` protocol (`src/reconcile_mcp/adapters/base.py`):
   - reads: `fetch_entity`, `find_entities` (filters pushed down to the source), `get_evidence` (from the snapshot you returned)
   - `validate_reference`
   - writes: `writable_fields`, `apply_update` (must be idempotent per `change_id` and version-checked), `find_change`
   - raise the typed errors so retries behave correctly: `RecordNotFound`, `AdapterUnavailable` (retryable), `VersionConflict`, …

   No business logic belongs in an adapter.
2. Register a builder for the new `kind` in `AdapterRegistry`. Retries, spans and metrics are added automatically by `RetryingAdapter`.
3. For another PostgreSQL database you only need a profile (`EntityMapping`s with a `writable_fields` allowlist) and a data source whose config names an environment variable for the connection string: `{"profile": "...", "dsn_env": "ERP_DSN"}`. The secret is never stored in the database.

## 5. Configuring a customer (no code)

Most onboarding is tuning an existing type, not writing a new one: a customer's tolerance, expiry window, severities, or which actions need approval. Use the admin API ([tools.md](tools.md#customer-configuration-api-reconadmin-rest-only)) with a `recon:admin` token:

```bash
ADMIN=$(uv run reconcile-mint-token --tenant globex --subject fde@globex --client-id admin-console \
  --scopes "recon:read recon:admin")
curl -s -X POST localhost:8090/api/v1/admin/types/invoice_to_po/drafts -H "Authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"patch": {"fields.amount.tolerance.percent": "1.0"}, "change_note": "Globex FIN-07"}'
# then: POST /api/v1/admin/drafts/{id}/dry-run, .../activate; POST /api/v1/admin/types/{key}/rollback to undo
```

The loop is: draft, validate, dry run against the customer's live records, activate, then evaluate with the customer's agent. Agents need no change: they see the effective rules in `reconciliation://rules/{key}`. `examples/onboard_customer_walkthrough.py` runs the whole loop.

A tenant version is pinned to the platform template version it patched. A newer platform template doesn't change a tenant's active version; create a new draft to adopt it.

## 6. Adding a reconciliation type

Write a versioned JSON definition (see `src/reconcile_mcp/templates/`):
- source A and source B
- candidate lookups
- match rules (exact / normalized / fuzzy with thresholds; `prefer_latest_by`)
- `derived_fields` (optional: values computed from other fields, e.g. renewal = effective date + term; evidence cites every input)
- field rules (comparators, tolerances, severity escalations)
- `line_items` (optional: pair a list on each side by key, e.g. contract milestones ↔ a system schedule)
- `policies` (single-source checks)
- `authoritative` sides
- `allowed_actions` per discrepancy type
- `resolution_policy` (which actions need human approval, caps, approval lifetime)

Add it to `src/reconcile_mcp/templates/` and `BUILTIN_TEMPLATES`, so the seed or a migration installs it as a platform row (`tenant_id NULL`, status `active`). Customer-specific variations then go through §5. Bump the `version` instead of editing a definition in place, so past runs stay explainable. Agents discover it via `reconciliation://types`; no tool changes are needed.
