# Slice 7 — Customer configuration: tenant-specific reconciliation definitions

Status: **APPROVED and IMPLEMENTED 2026-11-13** (deviations in §7)
Date: 2026-11-13
Builds on: Slices 0–6 ([architecture](architecture.md))

## Why this slice

The interview context describes the forward-deployed engineering (FDE) loop:
1. Configure an existing template for a customer.
2. Evaluate it.
3. Fix weaknesses through configuration rather than code.

Reconcile MCP already has the data model for this. `reconciliation_types` rows can be tenant-specific, and a tenant's row overrides the platform template. But today the only way to create one is to write SQL by hand. That isn't a product.

This slice makes **onboarding a customer a configuration task**:
- A customer admin (or an FDE acting for them) derives a tenant version from a platform template, changing only what the customer needs.
- Every change is validated, previewed against the customer's real data, activated, audited, and reversible.
- Agents need no changes. They see the effective rules through MCP.

What this slice must prove:
- **Configuration, not code:** onboarding Globex with different tolerances, windows and approval rules needs no deploy.
- **Safe changes:**
  - a definition that refers to unknown fields, unwritable fields or unknown actions is refused before it can run
  - a dry run shows how findings would change before activation
- **Explainable history:** every run stays tied to the exact definition version it used. Old runs remain explainable after a change, and a rollback is one call.
- **Agents can't change the rules:** configuration is REST-only, under a new `recon:admin` scope, like approvals.

---

## 1. The demo ("onboarding Globex", act 5)

Globex's finance team asks for three changes:
1. Invoices within **1%** of the PO are acceptable. The platform default is 0.5% and INR 100.
2. Certificate expiry warnings start at **45 days**, not 30.
3. A PO amendment may change the PO by at most **5%**. The platform cap is 10%; larger differences must go through a credit note.

Script:
1. `GET /api/v1/admin/types/invoice_to_po` returns the effective definition (the platform v2) and its source.
2. `POST /api/v1/admin/types/invoice_to_po/drafts` with a **patch**, not a full copy:
   `{"fields.total_amount.tolerance.percent": "1.0", …}`. This creates draft **globex v3**.
3. `POST …/drafts/{id}/validate` passes. Suppose the first attempt used a field `"grand_total"` that doesn't exist: it fails with `UNKNOWN_FIELD: source A 'invoice' has no field 'grand_total' (known: …)`.
4. `POST …/drafts/{id}/dry-run` with `{"selection": {"filter": {}}, "limit": 50}` returns a **diff** against the active version, e.g. "3 findings disappear (variance 0.6–0.9%), 0 new, 1 severity change". Nothing is persisted.
5. `POST …/drafts/{id}/activate` makes v3 effective for Globex only. Acme still gets platform v2.
6. An agent calls `start_reconciliation` with the same tool and arguments, and the run reports `type_version 3`. `reconciliation://types` shows the tolerance the agent is now judged by.
7. `POST …/types/invoice_to_po/rollback` reactivates the previous version. Runs made under v3 still explain themselves with v3.

---

## 2. Design

### 2.1 Versions and lifecycle
```text
draft ──validate──▶ validated ──activate──▶ active ──(newer activated / rollback)──▶ retired
  └─ any edit returns to draft
```
- **A draft is mutable; an activated version is immutable.** These columns are added to `reconciliation_types` (migration `0006`): `status`, `based_on_id`, `patch`, `created_by`, `activated_by`, `activated_at`, `change_note`.
- **One active version per (tenant, key)**, enforced by a partial unique index.
- **Runs already pin `type_id` + `type_version`**, so explanations and resolution validation always use the version the run used.
- Platform templates stay `tenant_id NULL` and can't be edited through this API. They change only through code and seed.

### 2.2 Patches, not copies
- A tenant draft stores `based_on` (the platform template version) plus a **patch**: a small list of path → value overrides on an allowlist of tunable paths.
- The effective definition is the template with the patch applied, then fully re-validated by the existing Pydantic `ReconciliationDefinition`.
- **Why a patch:**
  - the customer's real differences stay visible ("Globex differs from platform in 3 settings")
  - a new platform template version can be offered as a rebase, which shows the same patch against the new template
- **Tunable paths (allowlist):**
  - field tolerances, severities and escalations
  - `mandatory` fields
  - policy windows and thresholds
  - `allowed_actions` (only a subset of the template's actions)
  - `resolution_policy` (approval requirement, caps, approval TTL)
  - `missing_*_severity`
- **Not tunable:** sources, match strategies, derived fields, line-item keys. Changing those creates a new reconciliation type, which is a platform change.

### 2.3 Validation (deterministic, before anything runs)
- **Schema:** the existing definition validators.
- **Against the adapter profile:**
  - every referenced field exists for the entity type
  - writable fields in `CORRECT_FIELD_VALUE` targets are on the write allowlist
- **Against the action catalog:**
  - actions exist
  - `requires_approval: false` is refused for actions whose catalog entry says `requires_human_approval`. A tenant can **tighten** approval but never loosen what the platform marks as human-only.
- **Sanity:** non-negative tolerances, escalation thresholds increasing, windows > 0.
- Errors are typed and list every problem at once, with the path and the allowed values.

### 2.4 Dry run
- Runs the **pure engine** over up to N records with the draft and with the active version, side by side.
- No run, discrepancy or audit rows for the comparisons; one `type.dry_run` audit event records who ran it and the counts.
- Returns:
  - per-record differences: findings added or removed, severity changes
  - summary counts
  - capped at `limit`, with a note when truncated
- It reuses the batch selection, so the same filter syntax works.

### 2.5 Surfaces
| Surface | Who | What |
|---|---|---|
| REST `/api/v1/admin/types…` | `recon:admin` (customer admin / FDE identity) | get effective, list versions, create/edit draft, validate, dry-run, activate, rollback |
| MCP `reconciliation://types` (existing) | agents | effective definition per key, now including `type_version`, `scope: tenant`, and the tunable values |
| MCP `reconciliation://rules/{key}` (new; listed in CLAUDE.md §6) | agents | the effective rules in readable form: comparators, tolerances, windows, which actions need approval |
| MCP tools | — | **unchanged (still 8)**; no tool can change configuration |

`recon:admin` is separate from `recon:approve`. Configuring rules and approving corrections are different duties, and the docs recommend never giving both to one identity.

### 2.6 Audit
New events: `type.draft_created`, `type.draft_updated`, `type.validated`, `type.dry_run`, `type.activated`, `type.rolled_back`. Each records the actor, the patch, the change note, and the before/after effective-definition hashes. They go into the existing append-only audit table, with `run_id NULL`.

---

## 3. Schema changes (migration `0006`)
- `reconciliation_types` gains the lifecycle columns (§2.1), plus a partial unique index on active versions.
- Existing rows are backfilled as `active`.
- RLS stays as it is: tenants see their own rows plus platform rows.
- The trigger that makes non-draft rows immutable is updated: a database trigger refuses updates to `definition`/`patch` once `status <> 'draft'`.

## 4. Tests to add
- **Unit:**
  - patch application and the tunable-path allowlist
  - every validation error, including "cannot loosen a human-only action"
  - dry-run diffing over fixed records
- **Integration:**
  - draft → validate → dry-run → activate changes Globex's results and leaves Acme's unchanged
  - runs pin their version
  - explaining an old run after activation uses the old rules
  - rollback
  - one active version per (tenant, key)
  - an activated version can't be edited (database trigger)
  - tenant isolation of drafts
  - audit events for every lifecycle step
- **Contract:**
  - `recon:admin` is required (agent and approver tokens get 403)
  - still 8 tools
  - `reconciliation://rules/{key}` shows the tenant's effective tolerance
- **Regression:** all 229 existing tests; Compose demo act 5.

## 5. Order of work
1. Migration 0006, the lifecycle model and the immutability trigger.
2. Pure pieces: patch application, validation against profiles and the catalog, dry-run diffing (unit-tested first).
3. `ConfigurationService` with audit, and the REST admin routes with `recon:admin`.
4. MCP: version info in `reconciliation://types`, the new `reconciliation://rules/{key}` resource.
5. The onboarding walkthrough (`examples/onboard_customer_walkthrough.py`), demo act 5, smoke assertions.
6. Tests and docs: integration guide §5 rewritten around the API, tools.md, operations (who gets `recon:admin`), README, deviations.

## 6. Decisions to confirm
1. **This slice next** (customer configuration), rather than the alternatives below. *Recommended:* it is the FDE story in the interview context, and it turns "add a reconciliation type" from an SQL insert into a product feature.
2. **Patches over full copies**, with an allowlist of tunable paths. *Recommended:* the differences stay small, reviewable and rebasable onto new platform templates.
3. **Tenants can tighten approval but never loosen** what the action catalog marks as human-only. *Recommended:* that rule can never be configured away.
4. **REST-only, under a new `recon:admin` scope**, separate from `recon:approve`. *Recommended:* agents can read the rules but never change them.
5. **Defer multi-approver / amount-tiered approvals** to a later slice. *Recommended:* that needs schema changes to approvals; this slice only changes which actions need one approver.

**Alternatives considered for Slice 7:**
- **Agent evaluation harness.** Scenario suites run the Claude agents against the server and are graded deterministically from the MCP trace: stopped at approval? quoted evidence? never invented a value? This is a strong fit for the "evaluate the baseline agent" step, but every run calls the Claude API, which costs money and needs credentials. It's a good Slice 8.
- **Reliability gaps:** durable single-record runs (today a crash mid-run leaves that run `RUNNING`), and field-level concurrency for several approved changes to one record.
- **Multi-approver and amount-tiered approvals.**
- **LLM-assisted extraction of free-form contract clauses**, accepted only when the value appears verbatim in the text.

---

## 7. Implementation notes (deviations from this plan)

| Area | Planned | Implemented | Why |
|---|---|---|---|
| Lifecycle states | draft → validated → active → retired | draft → active → retired; `validate` reports, and **activate always re-validates** | A stored "validated" flag can go stale; re-validating at activation means an invalid version can never become active. |
| Rollback target | "the previous version" | `replaced_id`, recorded at activation; rollback restores exactly that version (or the platform template) | Found in the live demo: choosing "the most recently activated earlier version" brought back a version that had itself been rolled back. A test now pins rollback-twice behaviour. |
| Validation against adapter profiles | check referenced fields and writable targets against the adapter profile | the path allowlist is checked against the **template** (unknown field rules, policies, actions and discrepancy types are named) | Sources, field mappings and correction targets aren't tunable, so a patch can't introduce a field the adapter lacks. The demo's "unknown field" is `UNKNOWN_PATH … (known: amount, currency, vendor)`. |
| Approval tightening | tenants can't loosen what the **catalog** marks human-only | tenants can't loosen what the catalog **or the platform template** requires | Stricter: a template author's decision to require approval can't be undone by tenant configuration either. |
| Demo settings | 1% tolerance (platform "0.5% and INR 100"); 45-day expiry window; amendment cap | 1% invoice tolerance (platform: exact, 0); amendment cap 5% (platform 10%) | The platform template is actually exact-match on amount. The expiry window is tunable and unit-tested, but kept out of the demo to keep it short. |
| Demo data | — | three synthetic Globex invoices with +0.8%, +0.4% and +1.5% variances | So the dry run shows a real change (two findings disappear, one remains). |
| Dry-run size | separate `limit` | the batch `selection` (its `limit`, max 1000) | One selection syntax everywhere. |
| Extra endpoint | — | `DELETE /api/v1/admin/drafts/{id}` (drafts only; the trigger refuses others) | Abandoned drafts shouldn't pile up in the version history. |
| Version numbers | — | shared per key across platform and tenant rows (next = max + 1) | "Globex v3" can't be confused with a future platform v3 of the same key. |
| Rebase onto a new platform template | "can be offered as a rebase" | not implemented; a tenant version stays pinned to the template version it patched, and a new draft adopts the newer template | Documented in integration.md §5; a rebase endpoint is a small follow-up. |
| Configuration review | — | one `recon:admin` user can draft and activate | A second-person sign-off on activation (like four-eyes on approvals) is listed in the production-readiness checklist. |

