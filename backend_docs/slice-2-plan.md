# Slice 2 — Resolve with approval

Status: **APPROVED and IMPLEMENTED 2026-11-12** (deviations in §11)
Date: 2026-11-12
Builds on: Slice 0 + Slice 1 (see [architecture.md](architecture.md))

## Goal

Finish the finance demo from CLAUDE.md §13, end to end:

```text
start_reconciliation → list_discrepancies → explain_discrepancy
   → propose_resolution → validate_resolution → [human approves via REST]
   → apply_resolution → get_reconciliation_audit
```

What this slice must prove:
- The agent can **propose** but never **approve**.
- Nothing high-impact reaches a source system without a recorded human approval.
- A correction is applied **at most once**, even across retries and crashes.
- A correction is applied only if the source record is **still in the state that was reviewed**.
- Every step lands in the append-only audit trail.

---

## 1. Proposal lifecycle

```text
                propose_resolution (runs validation immediately)
                              │
                ┌─────────────┴─────────────┐
              INVALID                     VALID
             (terminal)                     │
                         policy: approval needed?
                         ┌──────────┴──────────┐
                        yes                    no (e.g. HOLD_PAYMENT)
                         │                     │
                 AWAITING_APPROVAL         APPROVED (approved_by = "policy:auto")
                  │          │                 │
            REJECTED     APPROVED ─────────────┤
           (terminal)        │                 │
                       apply_resolution        │
                             │◄────────────────┘
                          APPLYING ──(crash)──► recovered from the APPLYING state
                       ┌─────┴──────┐
                    APPLIED     APPLY_FAILED / SUPERSEDED
                  (terminal)    (source changed → propose again)
```

The discrepancy and the run follow along:
- Discrepancy: `OPEN → PROPOSED → AWAITING_APPROVAL → RESOLVED`. It goes back to `OPEN` on reject, INVALID or SUPERSEDED.
- Run: `COMPLETED_WITH_DISCREPANCIES ⇄ AWAITING_APPROVAL → RESOLVED`. It becomes RESOLVED once every discrepancy is RESOLVED or DISMISSED. These transitions already exist in `domain/runs.py`.

**Rule: one active proposal per discrepancy.** A partial unique index enforces it:
`UNIQUE (discrepancy_id) WHERE status IN ('VALID','AWAITING_APPROVAL','APPROVED','APPLYING')`.
*Why:* two competing corrections for the same discrepancy is exactly the confusion reconciliation exists to remove. The database refuses it, not just the service code.

---

## 2. Validation is deterministic and runs three times

| When | Why |
|---|---|
| Inside `propose_resolution` | The agent gets immediate, actionable feedback; an INVALID proposal never reaches a human. |
| `validate_resolution` (on demand) | Re-checks before asking for approval, or after time has passed. Read-only toward sources. |
| Inside `apply_resolution`, right before the write | Closes the time-of-check/time-of-use gap: the world may have changed between approval and apply. |

Common checks, for every action:
1. The discrepancy belongs to the tenant, is not resolved, and has no other active proposal.
2. The action is in `definition.allowed_actions[discrepancy_type]`.
3. The parameters match the action's schema. Money arrives as **decimal strings**: JSON numbers are rejected, so an LLM float can't silently become 124999.99999.
4. **Staleness:** re-fetch the source records through the adapter. If `content_hash` or `row_version` differs from the stored evidence, the proposal is invalid ("source changed since detection; re-run reconciliation").

Action-specific checks (first version):

| Action | Writes to source | Approval | Deterministic checks |
|---|---|---|---|
| `HOLD_PAYMENT` | invoice.status → `ON_HOLD` | **auto** (protective and reversible) | invoice status is `RECEIVED` (not already paid or on hold) |
| `AMEND_PO_AMOUNT` | purchase_order.total_amount | **required** | `new_amount` == invoice amount exactly; currency == PO currency; PO status `OPEN`; increase ≤ policy cap (default 10%) |
| `REQUEST_CREDIT_NOTE` | none (decision record) | **required** | `amount` == invoice − PO exactly, > 0; currency matches |
| `ACCEPT_VARIANCE` | none (decision record) | **required** | variance ≤ policy cap (default 5%); justification ≥ 20 characters |
| `CORRECT_FIELD_VALUE` | the named field on the target side | **required** | `new_value` must equal the other system's observed value (only "align to the other source"); field must be writable |
| `MANUAL_REVIEW` | none | none | — |

### Policy lives in the versioned definition

The definition gains a `resolution_policy` block: which actions need approval, the caps, and the approval expiry. This ships as **`invoice_to_po` v2**. Runs already recorded keep pointing at v1.
*Why:* policy is customer configuration (the FDE "configure the template" model), and versioning proves an old decision can always be explained by the rules in force at the time.

---

## 3. Human approval (REST, outside the agent's tool surface)

New FastAPI routes, authenticated by the same JWT verifier as `/mcp`:

| Endpoint | Scope | Purpose |
|---|---|---|
| `GET /api/v1/proposals?status=AWAITING_APPROVAL` | `recon:read` | Queue for an approver UI, ITSM or Teams bot |
| `GET /api/v1/proposals/{id}` | `recon:read` | Proposal + validation result + discrepancy explanation + evidence |
| `POST /api/v1/proposals/{id}/decision` | `recon:approve` | `{decision: APPROVED\|REJECTED, comment, expected_version}` |

Enforced by the service:
- The approver's token has `recon:approve`.
- **Four eyes:** the approver's `subject` is not the subject that proposed it.
- The proposal is `AWAITING_APPROVAL` and the `expected_version` matches (two approvers can't race).
- Validation is re-run first: a proposal that went stale while waiting can't be approved.
- An approval expires after a policy TTL (default 72h). After that `apply_resolution` refuses.

**Why not MCP elicitation for approval?** An elicitation answer travels back through the agent's own client connection, so the server can't prove that a different human answered. A separate authenticated endpoint can. The identity provider should never grant `recon:approve` to agent client IDs; I'll document this in the integration guide.

---

## 4. Applying a correction safely across two systems

The source system (ERP) and our database can't share one transaction. The design is an **intent record plus idempotent write**:

```text
txn A: lock proposal (SELECT … FOR UPDATE), check APPROVED and not expired,
       re-validate, set status APPLYING, store change_id                       → commit
write: adapter.apply_update(ref, changes, expected_version, change_id)
       → UPDATE erp_sim.<table> SET …, row_version = row_version+1, last_change_id = :change_id
         WHERE tenant_id = :t AND id = :id AND row_version = :expected
txn B: proposal APPLIED, discrepancy RESOLVED, run status recomputed,
       post-apply verification result, audit events, idempotency response     → commit
```

- **Optimistic concurrency:** if someone edited the record after approval, `row_version` doesn't match. The proposal becomes `SUPERSEDED` and nothing is written.
- **Exactly-once effect:** if the process dies after the write but before txn B, the next `apply_resolution` (or a recovery job) finds `APPLYING`. It reads the source; if `last_change_id == change_id`, the write already happened, so it completes txn B without writing again.
- **Post-apply verification:** after an `AMEND_PO_AMOUNT`, re-run the field comparison on fresh records and record that the discrepancy is gone. "Applied" then means "applied and confirmed", not just "the UPDATE returned".
- Decision-only actions (`REQUEST_CREDIT_NOTE`, `ACCEPT_VARIANCE`, `MANUAL_REVIEW`) skip the write. They resolve the discrepancy with a recorded outcome. Sending a real credit-note request to a vendor is out of scope; the docs will label it a recorded decision only.

### Adapter contract additions

```python
class Capability(StrEnum):
    READ = "read"; EVIDENCE = "evidence"; WRITE = "write"

class VersionConflict(AdapterError): code = "VERSION_CONFLICT"
class UnsupportedOperation(AdapterError): code = "UNSUPPORTED_OPERATION"

async def apply_update(self, ctx, ref, changes: Mapping[str, Any],
                       expected_version: str, change_id: uuid.UUID) -> SourceRecord: ...
async def find_change(self, ctx, ref, change_id: uuid.UUID) -> SourceRecord | None: ...
```

`EntityMapping` gets `writable_fields`: only `invoice.status` and `purchase_order.total_amount` in the simulated ERP. The adapter refuses everything else, whatever a proposal says.

---

## 5. MCP surface after Slice 2

| Tool | Scope | Annotations | Notes |
|---|---|---|---|
| `propose_resolution` | `recon:propose` | not read-only, idempotent (key) | records + validates; returns `status`, `checks`, `requires_approval`, `approval_reason` |
| `validate_resolution` | `recon:propose` | read-only | re-validates; also returns current status / approval |
| `apply_resolution` | `recon:apply` | **destructive**, idempotent (key) | refuses unless APPROVED; returns outcome + verification |
| `get_reconciliation_audit` | `recon:read` | read-only | paged events by `seq` for a run (or a proposal) |

Also:
- `explain_discrepancy` gains an `active_proposal` field, so agents see where a discrepancy stands without a new tool.
- New resources: `reconciliation://discrepancies/{run_id}`, `reconciliation://audit/{run_id}`, `reconciliation://proposals/{proposal_id}`.
- Prompts: `reconcile_financial_records` and `resolve_reconciliation_exceptions`. They describe the workflow and tell the agent to **stop and report** when approval is required. They guide behaviour; enforcement stays in the server.

New error codes: `PROPOSAL_INVALID`, `APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, `SELF_APPROVAL_FORBIDDEN`, `SOURCE_CHANGED`, `VERSION_CONFLICT`, `ACTIVE_PROPOSAL_EXISTS`.

**Security note:** the agent's `rationale` is free text written by an LLM. It is stored and shown to approvers as untrusted data (escaped, length-capped) and is never interpreted or used in any decision.

---

## 6. Schema changes (migration `0002`)

```text
resolution_proposals
  id, tenant_id, discrepancy_id → (tenant_id, discrepancies.id), run_id → (tenant_id, runs.id)
  action, params JSONB, rationale TEXT (≤2000)
  proposed_by, proposed_by_client, correlation_id
  status CHECK (...), validation JSONB, requires_approval BOOL, approval_reason TEXT
  target_ref JSONB, target_version TEXT, evidence_hash TEXT     -- what was reviewed
  change_id UUID NULL, applied_at, verification JSONB
  approval_expires_at TIMESTAMPTZ NULL, version INT, created_at
  partial UNIQUE (discrepancy_id) WHERE status is active
  INDEX (tenant_id, status, created_at)

approvals
  id, tenant_id, proposal_id → (tenant_id, proposals.id) UNIQUE
  decision CHECK (APPROVED|REJECTED), decided_by, decided_by_client, comment, decided_at
  CHECK (decided_by <> proposer) via trigger                    -- four eyes, enforced by the DB too

erp_sim.invoices / erp_sim.purchase_orders
  + last_change_id UUID NULL                                    -- idempotent write marker (simulated ERP)
```

Plus a `reconciliation_types` row for `invoice_to_po` v2 with `resolution_policy`.

---

## 7. Finance agent example

`examples/finance_agent/` contains a real LLM agent built on the **Claude API**. It uses the official `anthropic` SDK and `mcp.Client`, with no agent framework.
- It lists the MCP tools, passes them to Claude as tool definitions, and runs the tool-use loop **locally**.
  *Why not the Claude API's built-in MCP connector?* That connector calls the MCP server from Anthropic's infrastructure, which can't reach `localhost`. A local loop works for the demo and for private-network deployments.
- The agent follows the `reconcile_financial_records` prompt. It stops at `AWAITING_APPROVAL` and prints the proposal id.
- `examples/finance_agent/approve.py` is the human step. It calls the REST decision endpoint with an **approver token** (a different subject, with `recon:approve`).
- The agent is then re-run, or continues with `apply_resolution`, and finishes by reading the audit trail.
- Requires `ANTHROPIC_API_KEY`. The automated test suite never calls an LLM; the agent is a demo, not a test dependency.

---

## 8. Tests to add

- **Unit:** each action validator (exact amount, currency, caps, status preconditions, decimal-string-only money); policy evaluation; the proposal state machine.
- **Integration (real Postgres):**
  - propose → INVALID for a disallowed action or wrong amount
  - only one active proposal per discrepancy, including under concurrent proposes
  - auto-approval for HOLD_PAYMENT only
  - apply without approval → APPROVAL_REQUIRED
  - self-approval refused (service **and** database trigger)
  - approval expiry
  - stale source between approval and apply → SUPERSEDED, no write
  - version conflict → no write
  - duplicate `apply_resolution` with the same key → one write
  - crash recovery: simulate a failure after the adapter write, then retry → completes without a second write
  - the write allowlist blocks non-writable fields
  - run → AWAITING_APPROVAL → RESOLVED
  - a complete, ordered audit trail for the whole flow
  - cross-tenant: tenant B can't see, approve or apply tenant A's proposals
- **Contract:** the 8-tool catalog with annotations (`apply_resolution` destructive); the error codes; REST decision endpoint auth (401 without a token, 403 without `recon:approve`, 403 self-approval) over the real ASGI app.

---

## 9. Order of work

1. Migration 0002 + models + `invoice_to_po` v2 policy, with domain models for proposals and policy.
2. Action validators and policy engine (pure, unit tested).
3. `ResolutionService`: propose, validate, decide (approve/reject), with locking, four eyes and expiry.
4. Adapter write path: `apply_update`, `find_change`, writable allowlist, version check.
5. Apply flow: APPLYING intent, write, completion, verification, recovery.
6. REST approval routes; MCP tools, resources and prompts; audit tool.
7. Tests (written alongside each step); finance agent example and approver script.
8. Docs: README, `docs/tools.md` (full tool reference), architecture notes; live demo run.

---

## 10. Decisions to confirm

1. **`propose_resolution` validates immediately** (and `validate_resolution` re-validates). *Recommended:* agents can't skip validation.
2. **`HOLD_PAYMENT` is auto-approved by policy**, since it's protective and reversible; all other source-changing actions need a human. *Recommended.*
3. **Decision-only actions** (`REQUEST_CREDIT_NOTE`, `ACCEPT_VARIANCE`) resolve the discrepancy with a recorded outcome; no vendor email or ticket integration in this slice. *Recommended.*
4. **Approval expiry of 72h**, configurable per definition. *Recommended.*
5. **Who may call `apply_resolution`:** any principal with `recon:apply`, the agent included, because the human approval is the gate. The alternative is humans only. *Recommended:* agent allowed, approval required.
6. **The finance agent runs its tool loop locally with the Claude API** and needs your `ANTHROPIC_API_KEY` to run the demo. *Recommended.*

---

## 11. Implementation notes (deviations from this plan)

| Area | Planned | Implemented | Why |
|---|---|---|---|
| Proposal states | PROPOSED, VALID, APPLY_FAILED | INVALID, AWAITING_APPROVAL, APPROVED, REJECTED, APPLYING, APPLIED, SUPERSEDED, EXPIRED | Proposals are validated inside `propose_resolution`, so PROPOSED/VALID never persist. A write the adapter definitively refuses becomes SUPERSEDED ("re-propose"); one with an unknown outcome stays APPLYING. |
| Containment actions | — | `resolves_discrepancy` per action | `HOLD_PAYMENT` and `MANUAL_REVIEW` contain or route; the discrepancy stays OPEN and the run doesn't resolve. Found by tests: verification wrongly expected a payment hold to remove an amount mismatch. |
| Staleness | compare content hash | compare the **evidence fields** to fresh values; the write itself still needs the exact `row_version` | A payment hold changes the invoice's status; it mustn't invalidate an amount fix. Any concurrent edit of the record being written still causes VERSION_CONFLICT. |
| Reviewed version | captured at proposal | re-captured at **approval** | The approver approves the source as it is when they decide; apply must find exactly that version. |
| Evidence | — | `evidence_records.field_name` | Staleness needs normalized field names; evidence without them is treated as untrustworthy. |
| Audit actor | caller | caller, or `policy:auto` for automatic approvals | The audit must say *who decided*; the agent didn't approve its own hold, the policy did. |
| Same-key retry after success | — | replays the stored response | Found by tests: the "already applied" shortcut ran before the idempotency lookup. |
| Seed | insert-only | resets simulated ERP rows to the demo state | Makes the demo repeatable after an amendment; Reconcile's own runs and audit history are kept. |
| Wiring | in app and CLI | `reconcile_mcp/wiring.py` | One composition root for HTTP, stdio and tests. |
| Agent loop | — | manual loop, not `anthropic.lib.tools.mcp` | The SDK's MCP helpers wrap the older `ClientSession`; this project uses MCP SDK v2's `Client`. A manual loop also prints every call for the demo. |
