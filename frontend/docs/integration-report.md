# Reconcile MCP — Comprehensive Backend Integration & Authentication Report

This document records the exhaustive technical discovery of the **Reconcile MCP** backend, detailing its authentication mechanism, API contracts, database architecture, and frontend integration strategy.

---

## 1. Discovered Backend Architecture

### 1.1 Service Topology & Interfaces
Reconcile MCP is architected as a single deployable process hosting two primary interfaces:
1. **MCP Interface (`/mcp`)**: Mounted as a Starlette app using the official `mcp>=2.3` SDK (`MCPServer.streamable_http_app`). Serves the 8 reconciliation tools, 6 resources, and 4 prompts over Streamable HTTP.
2. **REST Management & Human Approval API (`/api/v1`)**: FastAPI router exposing dashboard reporting, execution control, human four-eyes approval decisions, and customer rule configuration.
3. **Health & Readiness Endpoints**:
   - `GET /healthz`: Service liveness check (returns `{"status": "ok"}`).
   - `GET /readyz`: Database connection verification (`SELECT 1`) and worker heartbeat latency measurement (`SELECT max(last_seen_at) FROM worker_heartbeats`).
4. **OAuth Protected Resource Metadata**:
   - Advertised at `/.well-known/oauth-protected-resource/mcp` according to **RFC 9728**.

---

## 2. Authentication & Security Discovery

### 2.1 Architecture: OAuth 2.1 Resource Server
The backend operates strictly as an **OAuth 2.1 / RFC 6750 Resource Server**. It is **not** an Identity Provider (IdP).
- **Transport**: Stateless HTTP Header: `Authorization: Bearer <token>`.
- **Browser Cookies**: **Not supported**. There is no session cookie, `Set-Cookie` header, or cookie-based session table in the backend database.
- **Trace Context**: Supports `X-Correlation-ID: <string>` (up to 64 chars) propagated through context vars into audit logs and response tracing.

### 2.2 Token Verification Implementation (`src/reconcile_mcp/security/tokens.py`)
All HTTP requests to protected routes pass through `call_context` in `src/reconcile_mcp/interfaces/http/routes.py`, invoking `JWTTokenVerifier`:
- **Production Mode (`RECONCILE_ENV=prod`)**:
  - Asymmetric key retrieval via `jwt.PyJWKClient(settings.jwt_jwks_url)`.
  - Supported algorithms: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `PS256`.
  - Rejects execution if symmetric secrets are present in production.
- **Development/Test Mode (`RECONCILE_ENV=dev|test`)**:
  - Symmetric verification (`HS256`) using `RECONCILE_JWT_SECRET` (must be at least 32 bytes).
  - Dev tokens minted via CLI:
    ```bash
    uv run python -m reconcile_mcp.cli token --tenant <slug> --subject <user> --scopes "<scopes>"
    ```

### 2.3 User, Password, and Session Models Inspection
An exhaustive audit of `src/reconcile_mcp/` and `src/reconcile_mcp/db/models.py` reveals:
- **User Models**: **None exist**. There is no `User`, `Account`, or `Credential` table. Identity is derived strictly from verified JWT claims (`sub`, `azp`/`client_id`).
- **Password Verification**: **None exists**. The backend has no password hashing (`bcrypt`, `argon2`, `pbkdf2`) or password authentication routes (`POST /login`).
- **Session Tables**: **None exist**. Sessions are stateless bearer tokens.
- **Tenant Isolation**: Handled via `Tenant` table in PostgreSQL (`tenants`). The token claim `settings.jwt_tenant_claim` (default: `"tenant"`) is mapped to `Tenant.slug`. If the tenant is missing from the database, the backend raises `Forbidden("the authenticated tenant is not provisioned")`.

### 2.4 Scope & Authorization Matrix
Permissions are conveyed via the `scope` or `scp` claim:

| Scope | Category | Backend Enforcement | Frontend Surface |
|---|---|---|---|
| `recon:read` | Read-only | `GET /stats`, `GET /types`, `GET /runs/**`, `GET /discrepancies/**`, `GET /evidence/**`, `GET /audit/**`, `GET /proposals/**` | Unlocks general dashboard, runs, exceptions, evidence, and audit logs. |
| `recon:run` | Execution | `POST /runs`, MCP tool `start_reconciliation` | Unlocks "New Run" workflow (`/runs/new`). |
| `recon:propose` | AI Agent | MCP tools `propose_resolution`, `validate_resolution` | Machine identity scope for proposing resolutions. |
| `recon:approve` | Human Gate | `POST /proposals/{id}/decision` | Unlocks four-eyes decision authorization on proposals (`/approvals`). Proposer cannot approve (four-eyes check). |
| `recon:apply` | Remediation | MCP tool `apply_resolution` | Machine identity scope for executing approved writes. |
| `recon:admin` | Governance | `POST /admin/types/**`, `PUT /admin/drafts/**`, etc. | Unlocks tuning rule tolerances, drafts, activation, and rollback (`/rules`). |

---

## 3. Discovered Backend API Endpoints & Request/Response Contracts

All API endpoints are defined in `src/reconcile_mcp/interfaces/http/routes.py` and prefixed with `/api/v1`:

### 3.1 Dashboard & Operational Statistics
- `GET /api/v1/stats`:
  - **Auth**: `recon:read`
  - **Response**: `StatsView` (`runs_total: int`, `runs_by_status: dict[RunStatus, int]`, `runs_last_7_days: list[dict]`, `open_discrepancies: int`, `open_discrepancies_by_severity: dict[Severity, int]`, `proposals_awaiting_approval: int`, `last_run_at: datetime | null`, `generated_at: datetime`).
- `GET /api/v1/types`:
  - **Auth**: `recon:read`
  - **Response**: `list[ReconciliationTypeView]` (`key: str`, `version: int`, `title: str`, `description: str`, `scope: str`, `source_refs_required: list[str]`, `compared_fields: list[str]`, `tenant_overrides: dict`).

### 3.2 Reconciliation Execution & Status
- `GET /api/v1/runs`:
  - **Auth**: `recon:read`
  - **Query Params**: `status` (`RunStatus`), `type` (`str`), `limit` (`1-100`, default `20`), `cursor` (`str | null`).
  - **Response**: `RunPage` (`items: list[RunListItem]`, `next_cursor: str | null`).
- `POST /api/v1/runs`:
  - **Auth**: `recon:run`
  - **Request Body**: `StartRunRequest` (`reconciliation_type: str`, `source_refs: dict[str, str] | null`, `selection: dict[str, Any] | null`, `idempotency_key: str`).
  - **Response (201)**: `StartReconciliationResult` (`run_id: UUID`, `status: RunStatus`, `replayed: bool`, `total_entities: int`, `discrepancy_count: int`).
- `GET /api/v1/runs/{run_id}`:
  - **Auth**: `recon:read`
  - **Response**: `RunStatusResult` (`run_id: UUID`, `reconciliation_type: str`, `status: RunStatus`, `records_compared: int`, `discrepancies_found: int`, `resolutions_proposed: int`, `resolutions_applied: int`, `created_at: datetime`, `completed_at: datetime | null`).
- `GET /api/v1/runs/{run_id}/discrepancies`:
  - **Auth**: `recon:read`
  - **Query Params**: `severity` (`Severity`), `status` (`DiscrepancyStatus`), `limit` (`1-200`, default `50`), `cursor` (`str | null`).
  - **Response**: `DiscrepancyPage` (`items: list[DiscrepancyListItem]`, `next_cursor: str | null`).
- `GET /api/v1/discrepancies/{discrepancy_id}`:
  - **Auth**: `recon:read`
  - **Response**: `DiscrepancyExplanation` (`discrepancy: DiscrepancyDetail`, `match_confidence: float`, `derivations: list[DerivationDetail]`, `evidence: list[EvidenceDetail]`, `allowed_actions: list[str]`, `explanation: str`).
- `GET /api/v1/runs/{run_id}/evidence`:
  - **Auth**: `recon:read`
  - **Query Params**: `side` (`a | b`), `documents_only` (`bool`), `limit` (`1-200`, default `50`), `cursor` (`str | null`).
  - **Response**: `RunEvidencePage` (`items: list[EvidenceItem]`, `next_cursor: str | null`).
- `GET /api/v1/runs/{run_id}/audit`:
  - **Auth**: `recon:read`
  - **Query Params**: `limit` (`1-200`, default `50`), `cursor` (`str | null`).
  - **Response**: `AuditPage` (`items: list[AuditEventItem]`, `next_cursor: str | null`).

### 3.3 Four-Eyes Human Approvals
- `GET /api/v1/proposals`:
  - **Auth**: `recon:read`
  - **Query Params**: `status` (`ProposalStatus`, default: `AWAITING_APPROVAL`), `limit` (`1-200`, default `50`).
  - **Response**: `list[ProposalResult]`.
- `GET /api/v1/proposals/{proposal_id}`:
  - **Auth**: `recon:read`
  - **Response**: `ProposalDetail` (`proposal: ProposalResult`, `version: int`, `explanation: DiscrepancyExplanation`).
- `POST /api/v1/proposals/{proposal_id}/decision`:
  - **Auth**: `recon:approve` (enforces four-eyes: proposer cannot decide).
  - **Request Body**: `DecisionRequest` (`decision: "APPROVED" | "REJECTED"`, `comment: str | null`, `expected_version: int`).
  - **Response**: `ProposalResult` (or `409 Conflict` if superseded).

### 3.4 Governance & Rule Configuration (Admin)
- `GET /api/v1/admin/types/{key}`:
  - **Auth**: `recon:admin`
  - **Response**: `EffectiveTypeView` (`key: str`, `version: int`, `effective_definition: dict`, `platform_template: dict`, `diff_from_template: dict`, `versions: list[TypeVersionSummary]`, `active_draft: DraftSummary | null`).
- `POST /api/v1/admin/types/{key}/drafts`:
  - **Auth**: `recon:admin`
  - **Request Body**: `DraftRequest` (`change_note: str`, `overrides: dict`).
  - **Response (201)**: `DraftResult`.
- `POST /api/v1/admin/drafts/{draft_id}/dry-run`:
  - **Auth**: `recon:admin`
  - **Request Body**: `DryRunRequest` (`sample_record: dict`).
  - **Response**: `DryRunResult`.
- `POST /api/v1/admin/drafts/{draft_id}/activate`:
  - **Auth**: `recon:admin`
  - **Request Body**: `ActivateRequest` (`change_note: str`).
  - **Response**: `TypeVersionView`.
- `POST /api/v1/admin/types/{key}/rollback`:
  - **Auth**: `recon:admin`
  - **Request Body**: `RollbackRequest` (`target_version: int`, `reason: str`).
  - **Response**: `RollbackResult`.

---

## 4. Frontend-Backend Integration Implementation

### 4.1 Error Handling & HTTP Status Code Mapping
The centralized API client translates backend status codes into strongly-typed error classes:
- **`400 Bad Request`**: Maps to `BadRequestError`.
- **`401 Unauthorized`**: Maps to `UnauthorizedError`, automatically terminating the local session and redirecting to `/session-expired`.
- **`403 Forbidden`**: Maps to `ForbiddenError`, showing granular permission feedback (`recon:approve`, `recon:admin`).
- **`404 Not Found`**: Maps to `NotFoundError`.
- **`409 Conflict`**: Maps to `ConflictError` (used when optimistic version locking fails on proposals).
- **`422 Unprocessable Content`**: Maps to `ValidationError` with validation issue payloads.
- **`429 Rate Limited`**: Maps to `RateLimitError`.
- **`500+ / Network Failure`**: Maps to `NetworkError` with target URL details.

### 4.2 Page-by-Page Integration Matrix

| Page Route | Backend APIs Used | Live Data Status | Handled Fallbacks / Empty States |
|---|---|---|---|
| `/` (Overview) | `GET /stats`, `GET /runs?limit=6`, `GET /types` | **Live** | Informative empty states when zero runs exist. |
| `/runs` | `GET /runs`, `GET /types` | **Live** | Cursor-based pagination, filter controls, empty state. |
| `/runs/new` | `GET /types`, `POST /runs` | **Live** | Form validation, 201 created confirmation, idempotency key generation. |
| `/runs/:runId` | `GET /runs/{id}`, `/discrepancies`, `/evidence`, `/audit` | **Live** | Tabbed inspector, raw JSON viewer. |
| `/exceptions` | `GET /runs`, `GET /runs/{id}/discrepancies` | **Live** | Run selector, severity filter, status filter, CSV/JSON export. |
| `/exceptions/:id` | `GET /discrepancies/{id}` | **Live** | Field comparison, match confidence percentage, OCR citations. |
| `/evidence` | `GET /runs`, `GET /runs/{id}/evidence` | **Live** | Side A/B filter, document extraction, SHA-256 copy. |
| `/approvals` | `GET /proposals`, `POST /proposals/{id}/decision` | **Live** | Four-eyes authorization gate, optimistic locking (`expected_version`). |
| `/connections` | `GET /readyz` | **Live Health** | Real-time worker heartbeat check; architecture callout on DB connectors. |
| `/rules` | `GET /types`, `/admin/types/{key}`, `/admin/drafts/**` | **Live** | Live draft creation, dry-run simulation, activation, rollback. |
| `/audit` | `GET /runs`, `GET /runs/{id}/audit` | **Live** | Append-only event history, correlation ID tracking. |
| `/developer` | `/mcp` transport | **Live** | Real MCP catalog inspection for 8 tools, 6 resources, 4 prompts. |
| `/settings` | `/readyz`, Token Claims Inspector | **Live** | Real backend health ping, live JWT claims inspection. |
| `/login` | `GET /api/v1/types` verification | **Live** | Real backend credential verification and tenant binding. |

