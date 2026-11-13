# Real Model Context Protocol (MCP) Client Implementation Report

**Author:** Senior Python Backend & MCP Protocol Engineer  
**Date:** November 13, 2026  
**Status:** Completed & Production Verified  
**Repositories:**  
- **Backend:** `tejas4123/reconcile-mcp` (branch: `deploy/production-readiness`)  
- **Frontend / BFF:** `reconsile_mcp_controller`  
- **Live Upstream Server:** `https://reconcile-mcp.onrender.com/mcp`

---

## Executive Summary

Reconcile has been upgraded from a visual prototype/direct browser fetch console to a **production-grade, protocol-compliant MCP client architecture**. 

Direct browser fetches previously failed with CORS errors when connecting across origins (e.g. from `localhost:5174` or `*.vercel.app` to `https://reconcile-mcp.onrender.com/mcp`), because the upstream server operates as an enterprise JSON-RPC 2.0 Streamable HTTP endpoint without permissive wildcard CORS headers. 

By implementing an official Python Model Context Protocol (`mcp 2.3.0`) client connection manager inside the Reconcile backend (`McpClientManager`) and exposing dedicated REST endpoints under `/api/v1/mcp/connections/...`, the Developer Console now executes protocol handshakes, schema discovery, tool dispatch, resource reading, and prompt resolution completely server-side with tenant isolation, SSRF defenses, and telemetry logging.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Reconcile Web Console                           │
│              (Visual MCP Controller - DeveloperPage.tsx)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API
                                    │ (/api/v1/mcp/connections/...)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    BFF Proxy & Gateway Layer                           │
│                     (server/handlers.ts)                               │
│  - Injects server-minted RS256/HS256 tokens                            │
│  - Tenant-scoped session forwarding                                    │
│  - Resilient dual-layer fallback to @modelcontextprotocol/sdk          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API (/api/v1/mcp/...)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Python Backend Service (McpClientManager)                 │
│         (src/reconcile_mcp/services/mcp_client_manager.py)             │
│  - Streamable HTTP Transport (streamable_http_client)                  │
│  - Official Python MCP SDK (mcp 2.3.0)                                 │
│  - AsyncExitStack persistent session management                        │
│  - SSRF URL validation (cloud metadata / private IP blocking)          │
│  - In-memory execution history telemetry buffer                        │
│  - FastAPI lifespan auto-cleanup on shutdown                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Streamable HTTP (POST / SSE)
                                    │ JSON-RPC 2.0 Protocol Handshake
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Target MCP Server (Render / Local)                   │
│               https://reconcile-mcp.onrender.com/mcp                   │
│  - initialize & initialized handshake                                  │
│  - tools/list & tools/call (8 tools)                                   │
│  - resources/list & resources/read (reconciliation://types)            │
│  - prompts/list & prompts/get (4 templates)                            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Implementation Details

### 2.1 Service Layer (`src/reconcile_mcp/services/mcp_client_manager.py`)
- **Transport**: Employs `mcp.client.streamable_http.streamable_http_client` and `mcp.client.session.ClientSession`.
- **Session Lifecycle**: Uses Python's `contextlib.AsyncExitStack` stored in memory per `(tenant, connection_id)`. The task group and SSE reader/writer streams remain active across subsequent REST calls until explicitly closed via `disconnect()` or server shutdown.
- **SSRF Defense**: `_validate_target_url` blocks non-HTTP schemes, AWS/GCP cloud metadata IP addresses (`169.254.169.254`, `169.254.170.2`, `metadata.google.internal`), and private IP ranges in production.
- **Auto Dev Token**: In dev/test environments, relative `/mcp` or matching local URLs auto-mint a dev JWT (`mint_dev_token`) with `recon:read`, `recon:run`, and `recon:admin` scopes. Sensitive tokens are never returned in JSON API responses.
- **Telemetry**: Tracks latency (ms), timestamp, operation name, arguments, status (`success`/`error`), and summary across the last 100 executions per connection.

### 2.2 REST Router (`src/reconcile_mcp/interfaces/http/mcp_client_routes.py`)
Mounted under `/api/v1/mcp` and protected by `CallContext` dependency injection with tenant isolation and granular RBAC scopes:
- Connection creation and connection lifecycle require `recon:admin`.
- Tool execution requires `recon:run` or `recon:admin`.
- Resources, prompts, discovery, and telemetry require `recon:read`.

### 2.3 App Lifespan & Wiring
- Registered in `src/reconcile_mcp/wiring.py` under the `Services` dataclass.
- Clean shutdown handler wired in `src/reconcile_mcp/interfaces/http/app.py`:
  ```python
  @asynccontextmanager
  async def lifespan(_: FastAPI) -> AsyncIterator[None]:
      async with mcp.session_manager.run():
          yield
      await services.mcp_client_manager.aclose()
      await services.registry.aclose()
      await engine.dispose()
  ```

---

## 3. REST API Specifications

| Method | Endpoint | Description | Scope Required |
|---|---|---|---|
| `POST` | `/api/v1/mcp/connections` | Register and optionally connect an MCP server endpoint | `recon:admin` |
| `GET` | `/api/v1/mcp/connections` | List active & configured MCP connections for caller's tenant | `recon:read` |
| `GET` | `/api/v1/mcp/connections/{connection_id}` | Get connection details, capabilities, and server info | `recon:read` |
| `POST` | `/api/v1/mcp/connections/{connection_id}/connect` | Establish Streamable HTTP session and run initialize handshake | `recon:admin` |
| `POST` | `/api/v1/mcp/connections/{connection_id}/disconnect` | Disconnect session and release transport resources | `recon:admin` |
| `POST` | `/api/v1/mcp/connections/{connection_id}/refresh` | Re-fetch tools, resources, and prompts from server | `recon:read` |
| `GET` | `/api/v1/mcp/connections/{connection_id}/tools` | List discovered MCP tools with JSON input schemas | `recon:read` |
| `GET` | `/api/v1/mcp/connections/{connection_id}/resources` | List discovered MCP resources and URIs | `recon:read` |
| `GET` | `/api/v1/mcp/connections/{connection_id}/prompts` | List discovered MCP prompt templates | `recon:read` |
| `POST` | `/api/v1/mcp/connections/{connection_id}/tools/{tool_name}/call` | Execute an MCP tool with validated arguments | `recon:run` or `recon:admin` |
| `POST` | `/api/v1/mcp/connections/{connection_id}/resources/read` | Read content of an MCP resource by URI | `recon:read` |
| `POST` | `/api/v1/mcp/connections/{connection_id}/prompts/get` | Retrieve prompt messages and template variables | `recon:read` |
| `GET` | `/api/v1/mcp/connections/{connection_id}/history` | Get protocol execution history and latency log | `recon:read` |

---

## 4. Verification and Testing

### 4.1 Backend Python Unit Tests
Ran test suite using pytest on Python 3.12:
- `tests/unit/test_mcp_client_manager.py`: Validated SSRF blocking (169.254.169.254, google metadata), tenant connection isolation, relative URL resolution, and auto-cleanup.
- `tests/unit/test_mcp_client_routes.py`: Validated HTTP 201 creation, listing, detail retrieval, disconnect, and history query.
- Full unit test suite status: **160 passed in 0.30s**.

### 4.2 Live Remote MCP Server Integration Test (`tests/integration/test_live_render_probe.py`)
Tested live end-to-end connection to `https://reconcile-mcp.onrender.com/mcp` across all 10 verification steps:
```
1. Connecting to live endpoint: https://reconcile-mcp.onrender.com/mcp ...
   Connection status: CONNECTED
   Server Info: {'name': 'reconcile-mcp', 'title': 'Reconcile MCP', 'version': '0.1.0', 'description': 'Enterprise reconciliation and exception resolution.', 'website_url': None, 'icons': None}
   Protocol Version: 2025-11-25
   Discovered: 8 tools, 1 resources, 4 prompts
2. Discovered Tools (8):
   - start_reconciliation: Start a reconciliation run.
   - get_reconciliation_status: Return the status, timings, discrepancy counts by severity.
   - list_discrepancies: List the discrepancies found by a run.
   - explain_discrepancy: Explain one discrepancy: a deterministic summary.
   - propose_resolution: Record a proposed resolution and validate it immediately.
   - validate_resolution: Re-run deterministic checks for a proposal.
   - apply_resolution: Apply an APPROVED proposal to the source system.
   - get_reconciliation_audit: Return the append-only audit trail of a run.
3. Discovered Resources (1):
   - reconciliation://types
4. Reading resource 'reconciliation://types' ...
   Read 1 content item(s). Latency: 2148.24ms
   Sample: [{"key": "contract_to_crm", "version": 1, "title": "Contract to CRM", "description": "Compares a signed sales contract against the CRM opportunity."}]
5. Discovered Prompts (4):
   - reconcile_financial_records
   - resolve_reconciliation_exceptions
   - investigate_vendor_compliance
   - review_contract_obligations
6. Getting prompt 'reconcile_financial_records' ...
   Retrieved 1 message(s). Latency: 411.82ms
7. Calling read-only tool 'get_reconciliation_audit' ...
   Executed in 1879.71ms. is_error=True (NOT_FOUND returned gracefully in structured error response for unpersisted test run id)
8. Session Execution History (4 entries):
   [2026-11-13T16:53:32.282302+00:00] call_tool -> get_reconciliation_audit (error, 1879.71ms)
   [2026-11-13T16:53:30.402387+00:00] get_prompt -> reconcile_financial_records (success, 411.82ms)
   [2026-11-13T16:53:29.990293+00:00] read_resource -> reconciliation://types (success, 2148.24ms)
   [2026-11-13T16:53:27.840597+00:00] initialize -> https://reconcile-mcp.onrender.com/mcp (success, 2667.55ms)
9. Disconnecting ...
   Status after disconnect: DISCONNECTED
10. Testing invalid credential handling against live endpoint ...
   Failed to connect MCP client to https://reconcile-mcp.onrender.com/mcp: Server returned an error response
   Correctly rejected invalid credentials with error: connection to MCP server failed: Server returned an error response
SUCCESS: All live integration checks (including invalid auth) verified against https://reconcile-mcp.onrender.com/mcp!
```

### 4.3 Frontend BFF & Controller Integration
- BFF forward-proxy wired in `frontend/server/handlers.ts` to forward `/api/v1/mcp/*` to backend REST endpoints with server-minted tokens.
- Automatic fallback to `@modelcontextprotocol/sdk` when communicating with upstream instances running earlier deployments without `/api/v1/mcp/*`.
- Tested `handleApiRequest` end-to-end:
  - Connection creation: `HTTP 201 Created`, status `CONNECTED`, 8 tools discovered.
  - Resource reading: `reconciliation://types` loaded.
  - Telemetry: Real latency and history populated.
- Frontend test suite: **28 passed in 165ms**.
- Production build: **`tsc -b && vite build` built in 240ms with 0 errors**.
