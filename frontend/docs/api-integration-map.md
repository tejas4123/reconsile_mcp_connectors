# Reconcile MCP — API & Capability Integration Map

This document establishes the authoritative integration mapping between the **Reconcile MCP** backend (FastAPI HTTP REST at `/api/v1` and MCP streamable transport at `/mcp`) and the frontend user interface.

Every endpoint, schema, and MCP tool was verified against the actual backend source code (`src/reconcile_mcp/`).

---

## 1. Feature Integration Summary Table

| Feature | Existing API / MCP Capability | Integration Status | Notes / Limitations |
|---|---|---|---|
| **Reconciliation runs** | `GET /api/v1/runs`<br>`GET /api/v1/runs/{run_id}` | **Available** | Supports filtering by `status`, `type`, pagination with `limit` (1-100) and `cursor`. Returns `RunPage` and `RunStatusResult`. |
| **Create reconciliation** | `POST /api/v1/runs`<br>`GET /api/v1/types` | **Available** | Requires `recon:run` scope. Supports single-record (`source_refs`) and batch (`selection`) runs with required `idempotency_key`. Returns `StartReconciliationResult` (201). |
| **Exceptions** | `GET /api/v1/runs/{run_id}/discrepancies`<br>`GET /api/v1/discrepancies/{discrepancy_id}` | **Available (per-run & by-ID)**<br>*(Global listing Unavailable)* | Discrepancies are indexed under specific reconciliation runs. The frontend queries the active/selected run's discrepancies or aggregates recent runs. Single discrepancy root-cause is queried via `/discrepancies/{id}`. |
| **Evidence** | `GET /api/v1/runs/{run_id}/evidence` | **Available (per-run)**<br>*(Global listing Unavailable)* | Scoped to `run_id` with filters for `side` (a/b), `documents_only`, and cursor pagination. Global tenant document search is not exposed via REST. |
| **Resolution proposals** | `GET /api/v1/proposals`<br>`GET /api/v1/proposals/{id}`<br>MCP Tool: `propose_resolution`<br>MCP Tool: `validate_resolution`<br>MCP Tool: `apply_resolution` | **Partially Available on REST**<br>*(Full on MCP)* | Reading proposals is available via REST. Proposing and applying resolutions are intentionally architected as MCP tools for autonomous agents; the human REST API handles read and approval to preserve security boundaries. |
| **Approvals** | `GET /api/v1/proposals?status=AWAITING_APPROVAL`<br>`GET /api/v1/proposals/{id}`<br>`POST /api/v1/proposals/{id}/decision` | **Available** | Fully implemented in HTTP REST. Requires `recon:approve` scope. Enforces four-eyes principle (proposer cannot approve) and optimistic locking via `expected_version`. |
| **Audit history** | `GET /api/v1/runs/{run_id}/audit` | **Available (per-run)**<br>*(Global stream Unavailable)* | Scoped to `run_id` with cursor pagination. Returns append-only chronological log of detection, proposals, approvals, writes, and verification events. |
| **Connections** | Internal model `DataSource` in DB (`data_sources` table) | **Unavailable via REST** | Connectors (ERP, VMS, CRM, S3/Files, Postgres) are configured at the infrastructure/pipeline level. No HTTP endpoints exist for connection CRUD. |
| **Reconciliation rules** | `GET /api/v1/types`<br>`GET /api/v1/admin/types/{key}`<br>`POST /api/v1/admin/types/{key}/drafts`<br>`PUT /api/v1/admin/drafts/{id}`<br>`POST /api/v1/admin/drafts/{id}/validate`<br>`POST /api/v1/admin/drafts/{id}/dry-run`<br>`POST /api/v1/admin/drafts/{id}/activate`<br>`POST /api/v1/admin/types/{key}/rollback` | **Available** | Complete rule lifecycle management is implemented in FastAPI under `/api/v1/admin` requiring `recon:admin` scope. |
| **Operational Stats** | `GET /api/v1/stats` | **Available** | Live database aggregates: total runs, runs by status, 7-day trend, open discrepancies by severity, and pending approvals count. |
| **Health & Readiness** | `GET /healthz`<br>`GET /readyz` | **Available** | Service liveness and database/worker readiness checks. |
| **MCP Developer Tools** | 8 Tools, 6 Resources, 4 Prompts at `/mcp` | **Available** | Streamable HTTP MCP server mounted at `/mcp`. |

---

## 2. Authentication & Authorization Contracts

### Protocol & Headers
- **Transport**: Standard Bearer Token in HTTP `Authorization` Header: `Bearer <token>`
- **Correlation ID**: Optional trace header `X-Correlation-ID: <string>` (up to 64 chars) propagated into logging and audit payloads.
- **Tenant Context**: Resolved server-side from JWT claims (`jwt_tenant_claim`, defaults to `https://reconcile.example/tenant` or `tenant`). The tenant is **never** passed as an unverified query or body parameter.
- **Dev Token Minting**: Local development tokens can be minted via the backend CLI:
  ```bash
  uv run python -m reconcile_mcp.cli token --tenant acme-india --scope "recon:read recon:run recon:propose recon:approve recon:apply recon:admin" --sub "user_ops_lead"
  ```

### RBAC Scope Matrix
| Scope | Endpoints / MCP Tools | Purpose |
|---|---|---|
| `recon:read` | `GET /stats`, `GET /types`, `GET /runs`, `GET /runs/{id}`, `GET /runs/{id}/discrepancies`, `GET /runs/{id}/evidence`, `GET /runs/{id}/audit`, `GET /discrepancies/{id}`, `GET /proposals`, MCP tools `get_*`, `list_*`, `explain_*` | Read-only inspection of reconciliation operations. |
| `recon:run` | `POST /runs`, MCP tool `start_reconciliation` | Trigger single-record or batch reconciliation executions. |
| `recon:propose` | MCP tools `propose_resolution`, `validate_resolution` | Generate and validate corrective action proposals. |
| `recon:approve` | `POST /proposals/{id}/decision` | Human approver decision (Approve/Reject). Granted only to human operator roles. |
| `recon:apply` | MCP tool `apply_resolution` | Execute approved changes into external source systems. |
| `recon:admin` | `/admin/types/**`, `/admin/drafts/**` | Manage reconciliation type definitions, rules, drafts, and activations. |

---

## 3. Discovered HTTP Endpoints & Contracts

### 3.1 Approvals & Proposals
- `GET /api/v1/proposals`: Query parameters: `status` (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `SUPERSEDED`, `EXPIRED`, `APPLIED`), `limit` (default 50). Returns `list[ProposalResult]`.
- `GET /api/v1/proposals/{proposal_id}`: Returns `ProposalDetail` containing the proposal, optimistic `version`, and full `DiscrepancyExplanation`.
- `POST /api/v1/proposals/{proposal_id}/decision`: Body: `{"decision": "APPROVED" | "REJECTED", "comment": string | null, "expected_version": int}`. Returns `ProposalResult` (or 409 Conflict if superseded).

### 3.2 Reporting & Runs
- `GET /api/v1/stats`: Returns `StatsView` (`runs_total`, `runs_by_status`, `runs_last_7_days`, `open_discrepancies`, `open_discrepancies_by_severity`, `proposals_awaiting_approval`, `last_run_at`, `generated_at`).
- `GET /api/v1/types`: Returns `list[ReconciliationTypeView]` (`key`, `version`, `title`, `description`, `scope`, `source_refs_required`, `compared_fields`, `tenant_overrides`).
- `GET /api/v1/runs`: Query parameters: `status`, `type`, `limit`, `cursor`. Returns `RunPage` (`items: list[RunListItem]`, `next_cursor: string | null`).
- `POST /api/v1/runs`: Body: `StartRunRequest` (`reconciliation_type: string`, `idempotency_key: string`, `source_refs?: dict[str, str]`, `selection?: Selection`). Returns `StartReconciliationResult` (status code 201).
- `GET /api/v1/runs/{run_id}`: Returns `RunStatusResult` (status, execution, entities_total, entities_compared, entities_failed, discrepancies_by_severity, error).
- `GET /api/v1/runs/{run_id}/discrepancies`: Query parameters: `severity`, `status`, `limit`, `cursor`. Returns `DiscrepancyPage` (`items: list[DiscrepancySummary]`, `next_cursor`).
- `GET /api/v1/runs/{run_id}/evidence`: Query parameters: `side`, `documents_only`, `limit`, `cursor`. Returns `RunEvidencePage` (`items: list[RunEvidenceItem]`, `next_cursor`).
- `GET /api/v1/runs/{run_id}/audit`: Query parameters: `limit`, `cursor`. Returns `AuditPage` (`items: list[AuditEventView]`, `next_cursor`).
- `GET /api/v1/discrepancies/{discrepancy_id}`: Returns `DiscrepancyExplanation` (summary, severity_rationale, rule, policy, derivations, match, evidence, allowed_actions, proposals).

### 3.3 Rule Administration
- `GET /api/v1/admin/types/{key}`: Returns `EffectiveTypeView` (`key`, `effective`, `overrides`, `definition`, `tunable_paths`, `versions`).
- `POST /api/v1/admin/types/{key}/drafts`: Body: `DraftRequest` (`patch`, `change_note`). Returns `DraftResult` (201).
- `PUT /api/v1/admin/drafts/{draft_id}`: Body: `DraftUpdateRequest` (`patch`, `change_note`, `expected_version`). Returns `DraftResult`.
- `DELETE /api/v1/admin/drafts/{draft_id}`: Discards draft (204 No Content).
- `POST /api/v1/admin/drafts/{draft_id}/validate`: Validates draft against platform schema and safety constraints. Returns `DraftResult`.
- `POST /api/v1/admin/drafts/{draft_id}/dry-run`: Body: `DryRunRequest` (`selection`). Returns `DryRunResult` with before/after finding changes over live records.
- `POST /api/v1/admin/drafts/{draft_id}/activate`: Body: `ActivateRequest` (`expected_version`). Returns `TypeVersionView`.
- `POST /api/v1/admin/types/{key}/rollback`: Body: `RollbackRequest` (`change_note`). Returns `RollbackResult`.

---

## 4. Discovered MCP Server Capabilities (`/mcp`)

### 4.1 Tools
1. `start_reconciliation`: Initiate single-record or batch run with idempotency.
2. `get_reconciliation_status`: Fetch run execution status, timing, and error details.
3. `list_discrepancies`: Retrieve discrepancy records for a given run with cursor pagination.
4. `explain_discrepancy`: Fetch deterministic, evidence-backed root cause explanation.
5. `propose_resolution`: Record proposed resolution and validate against fresh source data.
6. `validate_resolution`: Re-evaluate deterministic business rules against live source data.
7. `apply_resolution`: Execute approved write against source system adapters with idempotency.
8. `get_reconciliation_audit`: Query chronological immutable event history.

### 4.2 Resources
- `reconciliation://types`: Tenant-scoped available reconciliation definitions.
- `reconciliation://rules/{key}`: Effective tenant rule configuration, tolerances, and actions.
- `reconciliation://runs/{run_id}`: Single run summary.
- `reconciliation://discrepancies/{run_id}`: First 100 discrepancies for a run.
- `reconciliation://audit/{run_id}`: Run audit event log.
- `reconciliation://proposals/{proposal_id}`: Resolution proposal detail.

### 4.3 Prompts
- `reconcile_financial_records(invoice_number)`: Guidance for matching vendor invoice against purchase order.
- `resolve_reconciliation_exceptions(run_id)`: Guidance for progressing open exceptions and approved proposals.
- `investigate_vendor_compliance(vendor_id)`: Guidance for inspecting liability-insurance certificates against policy.
- `review_contract_obligations(contract_id)`: Guidance for comparing contract terms against CRM/ERP.

---

## 5. Frontend No-Fake-Data Integration Architecture

In strict adherence to the **No Fake Data Policy**:
1. **Direct Backend Queries**: All data displayed in the application is queried from the live backend API routes.
2. **True Empty States**: When the backend returns 0 records (e.g. no runs, no discrepancies, no approvals), the UI renders informative, professional empty states explaining how records are created.
3. **Reconnection & Error Recovery**: If the backend is unreachable or returns HTTP errors (401, 403, 404, 500), the UI displays clear error alerts with retry triggers and links to the Settings page to check the API URL and JWT token.
4. **Documented Gaps**: Features lacking dedicated REST endpoints (such as global cross-run discrepancy querying or connection CRUD) are surfaced with transparent architectural status panels explaining backend infrastructure requirements rather than fake simulators.
