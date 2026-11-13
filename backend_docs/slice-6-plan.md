# Slice 6 — Contract-to-system reconciliation (Use Case B)

Status: **APPROVED and IMPLEMENTED 2026-11-13** (deviations in §7)
Date: 2026-11-13
Builds on: Slices 0–5 ([architecture](architecture.md))

## Why this slice

Slices 0–5 delivered the full original plan. Two things in CLAUDE.md are still open:
- **Use Case B**, contract-to-system reconciliation, which CLAUDE.md lists as a core use case.
- The **`review_contract_obligations`** prompt, one of the four suggested prompts.

It's also the use case closest to contract-intelligence companies such as LegalGraph.

What this slice must prove:
- **Reuse, a third time:** a third use case and a third agent on the **same 8 tools**.
- **Two new engine capabilities that are reusable, not contract-specific:**
  1. **Derived fields with provenance.** For example, `renewal_date = effective_date + initial_term`. Contracts rarely state a renewal date; they state a start date and a term. The derived value's evidence cites *every* line it came from.
  2. **Line-item reconciliation.** One record on each side can carry a *list* (contract milestones ↔ ERP payment schedule). Items missing on either side become discrepancies. This is CLAUDE.md's "missing obligations".

---

## 1. The demo

Contract **MSA-2026-014** with Coastal Packaging Co (synthetic):

| Fact | Contract document says | System says |
|---|---|---|
| Effective date / initial term | `Effective Date: 01-Dec-2025`, `Initial Term: 12 months` → renewal **01-Dec-2026** (derived) | CRM `renewal_date` **01-Jun-2027** (wrong) |
| Notice period | `Non-Renewal Notice: 30 days` | CRM `notice_period_days` 90 |
| Payment terms | `Payment Terms: Net 45` | ERP vendor terms `NET30` |
| Counterparty | `Coastal Packaging Co` | CRM `Coastal Packaging Company Pvt Ltd` (normalized fuzzy match → reported, not silently equal) |
| Milestones | 3 milestones (`M1 … INR 4,00,000 on 15-Jan-2026`, M2, M3) | ERP payment schedule has M1 and M2 only |

Expected findings, each with evidence:
- `date_mismatch` on `renewal_date`, CRITICAL. The evidence cites **both** the effective-date line and the term line.
- `value_mismatch` on payment terms and on notice period.
- `missing_obligation` for M3: in the contract, absent from the ERP payment schedule.
- `expiry_breach`-style policy finding: **the non-renewal notice deadline** (renewal minus notice period) is within 30 days of `as_of`, so a decision is needed now.

The **contract obligations agent** (prompt `review_contract_obligations`) explains these and proposes corrections:
- CRM renewal date := the derived contract date, which a human approves.
- A decision record to add M3 to the ERP schedule.
- `FLAG_FOR_LEGAL_REVIEW` for the notice deadline.

It stops for human approval, exactly like the other two agents.

---

## 2. New pieces

### 2.1 Simulated systems
- **`crm_sim.contracts`** (new schema): contract_id, account_name, counterparty_name, effective_date, renewal_date, auto_renew, notice_period_days, contract_value, currency, status. Writable: `renewal_date`, `notice_period_days`.
- **`erp_sim.payment_schedules`**: contract_id, milestone_code, due_date, amount, currency.
- **`erp_sim.vendors`** gains `payment_terms`.

### 2.2 Contract documents
A new document profile, `contracts`, rendered by the seed with dates relative to today:
- labels: `Contract ID`, `Counterparty`, `Effective Date`, `Initial Term`, `Non-Renewal Notice`, `Payment Terms`, `Contract Value`, `Governing Law`
- a **milestone table**: `M1 | Go-live | 15-Jan-2026 | INR 4,00,000` lines, extracted as **line items**, each with its own line, span and excerpt

The extractor stays deterministic (label and table rules). Durations (`12 months`, `30 days`) and payment terms (`Net 45` → `NET45`) get normalizing parsers. As before, anything ambiguous is reported, never guessed.

### 2.3 Engine: derived fields (generic)
```json
"derived_fields": [
  {"name": "renewal_date", "side": "b", "op": "add_period", "inputs": ["effective_date", "initial_term"]},
  {"name": "notice_deadline", "side": "b", "op": "sub_period", "inputs": ["renewal_date", "notice_period"]}
]
```
- A closed set of pure operations (`add_period`, `sub_period`), evaluated before comparison. Month arithmetic uses calendar rules (31 Jan + 1 month = 28/29 Feb) and is tested at the edges.
- Each derived value records its inputs, so the **evidence lists every input line** and the explanation shows the calculation ("01-Dec-2025 + 12 months = 01-Dec-2026").
- A derived field with a missing input is reported as `missing_field`, naming the missing input.

### 2.4 Engine: line-item reconciliation (generic)
```json
"line_items": [{
  "name": "milestones",
  "a_source": {"data_source": "erp_sim", "entity_type": "payment_schedule", "link": {"contract_id": "contract_id"}},
  "b_field": "milestones",
  "key": "milestone_code",
  "fields": [ {"name": "amount", "comparator": "money", ...}, {"name": "due_date", "comparator": "date", ...} ]
}]
```
- Items are paired by key, using the existing exact / normalized matching.
- An item only in the contract becomes `missing_obligation`; an item only in the system becomes `unexpected_obligation`. Paired items go through the normal field comparison.
- Each item-level discrepancy carries item evidence: the contract table line and the ERP row.

### 2.5 Resolution
| Action | Effect | Approval |
|---|---|---|
| `CORRECT_FIELD_VALUE` (existing) | CRM `renewal_date` / `notice_period_days` := the contract value (the contract is authoritative) | human |
| `ADD_OBLIGATION_TO_SCHEDULE` | decision record (writing to the ERP schedule stays out of scope, as with credit notes) | human |
| `FLAG_FOR_LEGAL_REVIEW` | decision record, routes to legal | policy auto |

### 2.6 MCP surface
- Still **8 tools**.
- New prompt: `review_contract_obligations(contract_id)`.
- New type: `contract_to_systems` v1, with `source_refs {"contract": "MSA-2026-014"}`.
- Batches work unchanged, e.g. `selection: {"filter": {"status": "ACTIVE"}}`.

---

## 3. Schema changes (migration `0005`)
- `crm_sim` schema + `contracts` table; `erp_sim.payment_schedules`; `erp_sim.vendors.payment_terms`
- grants for `reconcile_app`
- the `contract_to_systems` v1 template

## 4. Tests to add
- **Unit:**
  - period arithmetic (month ends, leap years)
  - duration and payment-terms parsing (and refusing ambiguous text)
  - derived-field provenance
  - line-item pairing: missing, unexpected, duplicate keys → ambiguous, field mismatches
  - the notice-deadline policy at its boundaries
- **Integration:**
  - every seeded contract scenario
  - the demo end to end: detect → explain (with derivation) → correct CRM → approve → apply → verify
  - a changed contract document supersedes a pending proposal
  - batch over all active contracts
  - tenant isolation of contracts
- **Contract (API):** still 8 tools; the new prompt and type are published; a derived-field explanation over MCP includes every input line.
- **Regression:** all 168 existing tests, plus the Compose demo extended with act 4.

## 5. Order of work
1. Engine: period arithmetic, derived fields with provenance, line-item reconciliation (pure, unit-tested first).
2. Extraction: duration, payment-terms and milestone-table parsing; the contract document profile.
3. Migration 0005 (CRM sim, payment schedules), adapter profiles, the template, and seed scenarios with rendered contracts.
4. Resolution actions and policy; explanations for derived and line-item findings.
5. The `review_contract_obligations` prompt, the contract obligations agent (shared loop), the scripted walkthrough, and the demo act 4.
6. Tests, docs (tools, demo, integration), clean-room Compose run, commit.

## 6. Decisions to confirm
1. **Build both new engine capabilities** (derived fields and line items) as generic configuration, not contract-specific code. *Recommended:* that's what makes this a third reuse rather than a third special case.
2. **Contracts are authoritative** for renewal date, notice period and payment terms; corrections target the CRM only. *Recommended.*
3. **Writes to the ERP payment schedule stay out of scope** (decision record only), consistent with credit notes in Slice 2. *Recommended.*
4. **Extraction stays deterministic** (labels, tables, normalizing parsers). An LLM extractor for free-form clauses, accepted only when its value appears verbatim in the text, remains future work. *Recommended:* fully testable without an API key.
5. **The non-renewal notice deadline is a policy finding** (30-day window), reusing Slice 3's expiry rule on a derived field. *Recommended.*

---

## 7. Implementation notes (deviations from this plan)

| Area | Planned | Implemented | Why |
|---|---|---|---|
| Reconciliation types | one type, `contract_to_systems` | two types, `contract_to_crm` and `contract_to_erp`, both with `source_refs {"contract": …}` | A definition compares one system with one other source. A contract touches two systems, so two single-pair types keep the engine unchanged; the prompt runs both. |
| Payment terms | `erp_sim.vendors.payment_terms` | `erp_sim.contracts` (contract header: vendor, payment terms, currency, status) | Terms belong to a contract, not to a vendor; one vendor can hold contracts on different terms. |
| Line-item source | `a_source` with its own data source | `a_entity_type` + `a_link`, read through source A's adapter | Schedule rows live in the same system as the contract header. A separate data source per list can be added when a customer needs it. |
| Derived operations | `add_period`, `sub_period` | plus `period_days` | The CRM stores the notice period as a number of days; the document says "30 days". `period_days` refuses months (no fixed length). |
| Explanations | "shows the calculation" | new `derivations: list[str]` on `explain_discrepancy`, recomputed from the stored evidence values | Agents and reviewers see each step; the steps are rebuilt only from observed values. |
| Missing-item wording | — | `a_list_label` on a line-item rule ("ERP payment schedule") | A reason should name the list that lacks the item, not the contract header. |
| Document profile | new `contracts` profile | the existing document store profile also maps `contract_document` | One tenant document store with a manifest; the entity type decides the extraction spec. |
| Item staleness | — | at validation, side-A item rows (ERP schedule) are not re-read | Every action allowed on an item finding is a decision record; no write depends on item rows. Re-reading them is needed before item-level writes are added. |
| Adapter coercion | — | the PostgreSQL adapter converts string params to `Integer` columns | `CORRECT_FIELD_VALUE` params are strings by design (`notice_period_days := "30"`). |
| Demo dates | effective date 01-Dec-2025 | dates relative to today: renewal in 45 days, so the notice deadline is always about 15 days away | The demo stays repeatable on any day, like the certificate demo. |
| Two corrections, one record | — | the demo approves and applies one at a time | An approval pins the record version the approver reviewed (Slice 2). After the first CRM write, a second change approved against the old version is correctly `SUPERSEDED`. A test pins this behaviour. Field-level concurrency (accept a newer version when only other fields changed) is a possible follow-up, not done here. |

