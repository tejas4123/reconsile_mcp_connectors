# Reconcile MCP — Interface Reference

Endpoint: `POST /mcp` (Streamable HTTP, `Authorization: Bearer <JWT>`), or stdio for local development.
Tenant and permissions come only from the token. No tool takes a tenant, user or role argument.

## Scopes

| Scope | Grants | Typical holder |
|---|---|---|
| `recon:read` | status, discrepancies, explanations, audit, resources, approval queue | agents, humans |
| `recon:run` | `start_reconciliation` | agents |
| `recon:propose` | `propose_resolution`, `validate_resolution` | agents |
| `recon:apply` | `apply_resolution` (only for APPROVED proposals) | agents |
| `recon:approve` | `POST /api/v1/proposals/{id}/decision` | **humans only** (configure in the IdP) |
| `recon:admin` | `/api/v1/admin/…` customer configuration (Slice 7) | customer admins / FDEs only; never agents, and preferably not the same people as approvers |

## Tools

| Tool | Scope | Hints | Returns |
|---|---|---|---|
| `start_reconciliation(reconciliation_type, idempotency_key, source_refs? \| selection?)` | run | idempotent | one record: final `status`; a batch: `PENDING` + `run_id` (queued for a worker) |
| `get_reconciliation_status(run_id)` | read | read-only | status, `execution`, progress (`entities_total` / `entities_compared` / `entities_failed`), `attempts`, `next_retry_at`, counts, typed `error` |
| `list_discrepancies(run_id, severity?, status?, limit?, cursor?)` | read | read-only | paged discrepancies with values and the computed difference |
| `explain_discrepancy(discrepancy_id)` | read | read-only | deterministic summary, severity rationale, rule, match, evidence, `allowed_actions`, `proposals` |
| `propose_resolution(discrepancy_id, action, params, rationale, idempotency_key)` | propose | idempotent | proposal with every check, `requires_approval`, `planned_write`, `next_step` |
| `validate_resolution(proposal_id)` | propose | idempotent | re-checked proposal (SUPERSEDED if the source changed) |
| `apply_resolution(proposal_id, idempotency_key)` | apply | **destructive**, idempotent | `outcome` (written / recorded / already_applied / superseded / expired / pending_retry), `verification`, discrepancy and run status |
| `get_reconciliation_audit(run_id, limit?, cursor?)` | read | read-only | ordered, append-only events with actor, client and correlation id |

`selection` example: `{"filter": {"vendor_id": "V-1001"}, "limit": 100}`. The filter is an equality match on the declared source-A fields; `{}` selects all records. The limit is at most 1,000 per run. A record that can't be processed is counted in `entities_failed` (with an `entity.failed` audit event) and doesn't fail the batch.

`params` values are **strings** (`{"new_amount": "125000.00", "currency": "INR"}`). JSON numbers are rejected by the schema, so an LLM float can never become money.

## Resources and prompts

- `reconciliation://types` (each type shows its `scope`, platform or tenant, and `tenant_overrides`)
- `reconciliation://rules/{key}`: the effective rules for your tenant (tolerances, severities, policies, allowed actions, which actions need a human approver, tenant overrides)
- `reconciliation://runs/{run_id}`
- `reconciliation://discrepancies/{run_id}`
- `reconciliation://audit/{run_id}`
- `reconciliation://proposals/{proposal_id}`
- Prompts: `reconcile_financial_records(invoice_number)`, `investigate_vendor_compliance(vendor_id)`, `review_contract_obligations(contract_id)`, `resolve_reconciliation_exceptions(run_id)`

## Reconciliation types

| Type | Sources | `source_refs` |
|---|---|---|
| `invoice_to_po` (v2) | SIMULATED ERP invoice ↔ purchase order | `{"invoice": "INV-2026-0042"}` |
| `vendor_certificate_compliance` (v1) | SIMULATED VMS insurance record ↔ certificate **document**, plus policies: expiry window 30 days, minimum coverage INR 5,000,000 | `{"vendor": "V-1003"}` |
| `contract_to_crm` (v1) | SIMULATED CRM contract ↔ contract **document**: counterparty, renewal date (**derived**: effective date + initial term), notice period, value; policy: non-renewal notice deadline (**derived**: renewal − notice) within 30 days | `{"contract": "MSA-2026-014"}` |
| `contract_to_erp` (v1) | SIMULATED ERP contract ↔ contract **document**: payment terms, currency, and every payment milestone (**line items**) against the ERP payment schedule | `{"contract": "MSA-2026-014"}` |

Batches work for every type, e.g. `selection: {"filter": {"status": "ACTIVE"}}` for contracts.

**Derived values.** A definition can compute a field from others with a closed set of pure operations (`add_period`, `sub_period`, `period_days`; calendar month arithmetic, so 31 Jan + 1 month = 28/29 Feb). Evidence for a finding on a derived value cites **every input line**, and `explain_discrepancy` returns the calculation in `derivations`, e.g. `renewal_date = effective_date 2025-12-27 + initial_term 12 months = 2026-12-27`. A missing or unreadable input is reported as `missing_field`, never guessed.

**Line items.** A definition can pair a list on each side by key (contract milestones ↔ ERP payment schedule rows). Findings are named `milestones[M3]` or `milestones[M2].amount`:
- `missing_obligation`: in the document, absent from the system
- `unexpected_obligation`: in the system, with no basis in the document (evidence is the system row)
- `ambiguous_match`: a key appears twice on one side
- paired items go through the normal comparators
- if any table row in the document is unreadable, the whole table is reported as `missing_field` rather than partially trusted

Runs record `as_of`, the date expiry windows are evaluated against. It comes from the server clock and can't be set by a caller. Document evidence carries the verbatim `excerpt` and a `document_ref` such as `doc://acme-india/COI-V1003-2026#L15`.

## Resolution actions (`invoice_to_po` v2 policy)

| Action | Source change | Approval | Resolves | Key checks |
|---|---|---|---|---|
| `HOLD_PAYMENT` | invoice.status → ON_HOLD | policy auto | no (containment) | invoice is RECEIVED |
| `AMEND_PO_AMOUNT` | PO.total_amount | human | yes | equals invoice amount; same currency; PO OPEN; change ≤ 10% |
| `REQUEST_CREDIT_NOTE` | none (decision record) | human | yes | amount equals the over-billed difference |
| `ACCEPT_VARIANCE` | none (decision record) | human | yes | variance ≤ 5%; justification ≥ 20 chars |
| `CORRECT_FIELD_VALUE` | the field, if writable | human | yes | new value equals the other system's value; field writable |
| `MANUAL_REVIEW` | none | policy auto | no | — |

Vendor compliance (`vendor_certificate_compliance` v1 policy):

| Action | Source change | Approval | Resolves | Key checks |
|---|---|---|---|---|
| `COMPLIANCE_HOLD` | VMS status → ON_HOLD | policy auto | no (containment) | VMS record is VALID |
| `CORRECT_FIELD_VALUE` | VMS `expiry_date` | human | yes | value equals the document's; the document side is authoritative and never writable |
| `REQUEST_UPDATED_CERTIFICATE` | none (decision record) | none | no | — |
| `MANUAL_REVIEW` | none | none | no | — |

Contracts (`contract_to_crm` / `contract_to_erp` v1 policy; the signed contract document is authoritative):

| Action | Source change | Approval | Resolves | Key checks |
|---|---|---|---|---|
| `CORRECT_FIELD_VALUE` | CRM `renewal_date` / `notice_period_days`; ERP `payment_terms` | human | yes | value equals the document's (derived) value; field on the write allowlist (counterparty is not) |
| `ADD_OBLIGATION_TO_SCHEDULE` | none (decision record; the ERP schedule is not written) | human | yes | only for `missing_obligation` |
| `FLAG_FOR_LEGAL_REVIEW` | none (decision record) | policy auto | no | — |
| `MANUAL_REVIEW` | none | policy auto | no | — |

An approval pins the record version the approver reviewed. If two corrections to the same record are approved and the first is applied, the second becomes `SUPERSEDED` (nothing is written); approve and apply them one at a time, or re-propose after the first.

For every action, the server also checks that the action is allowed for the discrepancy type and that the evidence values still match the source.

## Human approval API

| Endpoint | Scope | Notes |
|---|---|---|
| `GET /api/v1/proposals?status=AWAITING_APPROVAL` | read | the approval queue |
| `GET /api/v1/proposals/{id}` | read | proposal, `version` and full explanation with evidence |
| `POST /api/v1/proposals/{id}/decision` | approve | body `{decision, comment?, expected_version}`; 403 for self-approval; 409 if the proposal changed or the source moved |

## Customer configuration API (`recon:admin`, REST only)

A tenant version of a reconciliation type is a **platform template plus a small patch**. Only these settings can be tuned (field rules and policies are addressed by name):

| Path | Example |
|---|---|
| `fields.<name>.tolerance.absolute` / `.percent` / `.days` | `"fields.amount.tolerance.percent": "1.0"` |
| `fields.<name>.severity` / `.mandatory` / `.escalations` | `"fields.vendor.severity": "CRITICAL"` |
| `policies.<name>.days` / `.value` / `.severity` / `.expired_severity` | `"policies.certificate_not_expiring.days": 45` |
| `allowed_actions.<discrepancy_type>` | a **subset** of the template's list |
| `resolution_policy.approval_ttl_hours` | `24` |
| `resolution_policy.actions.<ACTION>.requires_approval` / `.max_percent` | `"…AMEND_PO_AMOUNT.max_percent": "5"` |
| `missing_field_severity`, `missing_counterpart_severity`, `ambiguous_match_severity` | `"HIGH"` |

Sources, matching, derived fields and line items are not tunable; changing them is a new reconciliation type. Decimal values are strings; JSON floats are refused.

| Method and path | Does |
|---|---|
| `GET /api/v1/admin/types/{key}` | effective version for your tenant, its overrides, the full definition, tunable paths, your version history |
| `POST /api/v1/admin/types/{key}/drafts` `{patch, change_note}` | new draft on the newest platform template; returns `valid` and **every** issue |
| `PUT /api/v1/admin/drafts/{id}` `{patch, change_note, expected_version}` | edit a draft (optimistic concurrency on `row_version`) |
| `DELETE /api/v1/admin/drafts/{id}` | discard a draft (only drafts) |
| `POST /api/v1/admin/drafts/{id}/validate` | re-validate |
| `POST /api/v1/admin/drafts/{id}/dry-run` `{selection}` | compare the draft with the active version over live records: findings added, removed, severity changes. **Nothing is persisted** |
| `POST /api/v1/admin/drafts/{id}/activate` `{expected_version}` | re-validate, retire the current tenant version, activate. Activated versions are immutable (database trigger) |
| `POST /api/v1/admin/types/{key}/rollback` `{change_note}` | retire the active tenant version and restore exactly the version it replaced (or the platform template) |

Validation issue codes:
- `NOT_TUNABLE`: the setting can't be changed by a tenant
- `UNKNOWN_PATH`: no such field rule, policy, discrepancy type or action; the message lists what exists
- `NOT_A_SUBSET`: `allowed_actions` may only narrow the template's list
- `LOOSENS_APPROVAL`: a tenant can require approval for more actions, but can never remove it where the template or the action catalog requires it
- `ESCALATION_ORDER`: escalations must climb in severity, with thresholds that never decrease
- `INVALID_VALUE`: a schema error, reported with the path

Activating or dry-running an invalid draft returns HTTP 422 `INVALID_CONFIGURATION` with `detail.issues`.

Runs pin the version they used (`type_version`), so explanations and resolution checks for old runs keep using the rules those runs were judged by. Every step is audited (`type.draft_created`, `type.validated`, `type.dry_run`, `type.activated`, `type.rolled_back`, `type.draft_discarded`), with the actor, the patch and the before/after definition hashes.

## Errors

Tool errors start with a stable code:

| Code | Meaning |
|---|---|
| `NOT_FOUND` | the record doesn't exist or belongs to another tenant (deliberately indistinguishable) |
| `FORBIDDEN` | missing scope |
| `SELF_APPROVAL_FORBIDDEN` | the proposer tried to decide their own proposal |
| `INVALID_REQUEST` | malformed input |
| `IDEMPOTENCY_KEY_REUSED` | the key was used for a different request |
| `REQUEST_IN_PROGRESS` | retryable |
| `APPROVAL_REQUIRED` | the proposal hasn't been approved yet |
| `ACTIVE_PROPOSAL_EXISTS` | another proposal is already active for this discrepancy |
| `PROPOSAL_NOT_APPLICABLE` | the proposal's state doesn't allow this operation |
| `CONCURRENCY_CONFLICT` | retryable |
| `INTERNAL_ERROR` | carries a correlation id |

A failed run or apply is not a tool error. It returns a typed `error` (`RECORD_NOT_FOUND`, `ADAPTER_UNAVAILABLE`, `VERSION_CONFLICT`, `MISSING_EVIDENCE`, `INVALID_DOCUMENT`, `RUN_DEADLINE_EXCEEDED`, `MAX_ATTEMPTS_EXCEEDED`, `ALL_RECORDS_FAILED`, …) with `retryable`.
