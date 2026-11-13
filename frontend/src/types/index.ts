// Domain Enums and Core Types mirroring backend reconcile_mcp schemas

export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_DISCREPANCIES'
  | 'FAILED'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type DiscrepancyStatus =
  | 'OPEN'
  | 'PROPOSED'
  | 'AWAITING_APPROVAL'
  | 'RESOLVED'
  | 'DISMISSED'

export type DiscrepancyType =
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'date_mismatch'
  | 'missing_in_source_a'
  | 'missing_in_source_b'
  | 'threshold_breach'
  | 'policy_violation'
  | 'duplicate_record'
  | 'line_item_mismatch'

export type ProposalStatus =
  | 'DRAFT'
  | 'VALID'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'APPLIED'
  | 'FAILED'

export interface Difference {
  kind: string
  numeric_difference?: string | number | null
  percentage_difference?: string | number | null
  detail?: string | null
  diff?: string | number | null
}

export interface Selection {
  filter?: Record<string, string | number | boolean>
  limit?: number
}

export interface RunError {
  code: string
  message: string
  retryable: boolean
}

export interface StartReconciliationResult {
  run_id: string
  status: RunStatus
  reconciliation_type: string
  type_version: number
  discrepancy_count: number
  discrepancies_by_severity: Record<Severity, number>
  replayed: boolean
  error?: RunError | null
}

export interface RunStatusResult {
  run_id: string
  reconciliation_type: string
  type_version: number
  status: RunStatus
  execution: 'inline' | 'queued'
  source_refs: Record<string, string>
  selection: Record<string, unknown> | null
  entities_total: number
  entities_compared: number
  entities_failed: number
  attempts?: number | null
  next_retry_at?: string | null
  discrepancy_count: number
  discrepancies_by_severity: Record<Severity, number>
  requested_by: string
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  error?: RunError | null
  as_of: string
}

export interface DiscrepancySummary {
  discrepancy_id: string
  run_id: string
  entity_ref: string
  field: string
  discrepancy_type: DiscrepancyType
  source_a_value: unknown
  source_b_value: unknown
  difference: Difference
  severity: Severity
  status: DiscrepancyStatus
  reason: string
  recommended_action: string
  evidence_count: number
}

export interface DiscrepancyPage {
  run_id: string
  items: DiscrepancySummary[]
  next_cursor: string | null
}

export interface EvidenceView {
  side: 'a' | 'b'
  source_system: string
  data_source: string
  entity_type: string
  record_id: string
  record_version: string
  field_path: string
  observed_value: unknown
  document_ref?: string | null
  excerpt?: string | null
  content_hash: string
  observed_at: string
}

export interface RunEvidenceItem extends EvidenceView {
  discrepancy_id: string
  discrepancy_field: string
  discrepancy_type: DiscrepancyType
  severity: Severity
}

export interface RunEvidencePage {
  run_id: string
  items: RunEvidenceItem[]
  next_cursor: string | null
}

export interface MatchView {
  status: 'matched' | 'unmatched' | 'ambiguous'
  method?: string | null
  confidence: number
  reasons: string[]
  source_a_ref: string
  source_b_ref?: string | null
}

export interface RuleView {
  field: string
  comparator: string
  source_a_field: string
  source_b_field: string
  tolerance: Record<string, string | number>
  mandatory: boolean
  base_severity: Severity
  escalations: Array<{ condition?: string; severity?: Severity }>
}

export interface AllowedAction {
  name: string
  description: string
  parameters: Array<{
    name: string
    type: string
    description?: string
    required?: boolean
  }>
  modifies_source_system: boolean
  requires_human_approval: boolean
  recommended: boolean
}

export interface ProposalSummary {
  proposal_id: string
  action: string
  status: ProposalStatus
  proposed_by: string
  created_at: string
}

export interface DiscrepancyExplanation {
  discrepancy: DiscrepancySummary
  summary: string
  severity_rationale: string
  rule: RuleView | null
  policy?: Record<string, unknown> | null
  derivations: string[]
  match: MatchView
  evidence: EvidenceView[]
  allowed_actions: AllowedAction[]
  proposals: ProposalSummary[]
  notes: string[]
}

export interface ValidationCheck {
  name: string
  passed: boolean
  detail: string
}

export interface ApprovalView {
  decision: 'APPROVED' | 'REJECTED'
  decided_by: string
  decided_by_client: string
  comment?: string | null
  decided_at: string
}

export interface PlannedWrite {
  target: string
  changes: Record<string, unknown>
  expected_version?: string | null
}

export interface ProposalResult {
  proposal_id: string
  discrepancy_id: string
  run_id: string
  action: string
  params: Record<string, string>
  rationale: string
  status: ProposalStatus
  valid: boolean
  checks: ValidationCheck[]
  requires_approval: boolean
  approval_reason?: string | null
  approval?: ApprovalView | null
  approval_expires_at?: string | null
  planned_write?: PlannedWrite | null
  proposed_by: string
  created_at: string
  next_step: string
  replayed?: boolean
}

export interface ProposalDetail {
  proposal: ProposalResult
  version: number
  explanation: DiscrepancyExplanation
}

export interface DecisionRequest {
  decision: 'APPROVED' | 'REJECTED'
  comment?: string | null
  expected_version: number
}

export interface AuditEventView {
  seq: number
  event_type: string
  subject_type: string
  subject_id: string
  actor: string
  client_id: string
  correlation_id: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AuditPage {
  run_id: string
  items: AuditEventView[]
  next_cursor: string | null
}

export interface ReconciliationTypeView {
  key: string
  version: number
  title: string
  description: string
  scope: 'platform' | 'tenant'
  source_refs_required: Record<string, string>
  compared_fields: string[]
  tenant_overrides?: string[]
}

export interface RunListItem {
  run_id: string
  reconciliation_type: string
  type_version: number
  status: RunStatus
  execution: 'inline' | 'queued'
  source_refs: Record<string, string>
  selection: Record<string, unknown> | null
  discrepancy_count: number
  discrepancies_by_severity: Record<string, number>
  requested_by: string
  client_id: string
  created_at: string
  completed_at?: string | null
}

export interface RunPage {
  items: RunListItem[]
  next_cursor: string | null
}

export interface StatsView {
  runs_total: number
  runs_by_status: Record<string, number>
  runs_last_7_days: number
  open_discrepancies: number
  open_discrepancies_by_severity: Record<string, number>
  proposals_awaiting_approval: number
  last_run_at?: string | null
  generated_at: string
}

export interface StartRunRequest {
  reconciliation_type: string
  idempotency_key: string
  source_refs?: Record<string, string>
  selection?: Selection
}

export interface ConfigIssueView {
  code: string
  path: string
  message: string
}

export interface OverrideView {
  path: string
  template_value: unknown
  value: unknown
}

export interface TypeVersionView {
  id: string
  key: string
  version: number
  scope: 'platform' | 'tenant'
  status: 'draft' | 'active' | 'retired'
  based_on_version?: number | null
  patch?: Record<string, unknown> | null
  change_note?: string | null
  created_by?: string | null
  created_at: string
  activated_by?: string | null
  activated_at?: string | null
  row_version: number
  definition_hash: string
}

export interface EffectiveTypeView {
  key: string
  effective: TypeVersionView
  overrides: OverrideView[]
  definition: Record<string, unknown>
  tunable_paths: string[]
  versions: TypeVersionView[]
}

export interface DraftRequest {
  patch: Record<string, string | number | boolean | unknown[]>
  change_note: string
}

export interface DraftUpdateRequest extends DraftRequest {
  expected_version: number
}

export interface DryRunRequest {
  selection?: Selection
}

export interface ActivateRequest {
  expected_version: number
}

export interface RollbackRequest {
  change_note: string
}

export interface DraftResult {
  draft: TypeVersionView
  valid: boolean
  issues: ConfigIssueView[]
  overrides: OverrideView[]
}

export interface DryRunResult {
  compared_with_version: number
  draft_version: number
  as_of: string
  records_examined: number
  records_changed: number
  findings_added: number
  findings_removed: number
  severity_changes: number
  truncated: boolean
  changes: Array<{
    record_id: string
    added: Array<{ field: string; discrepancy_type: DiscrepancyType; severity: Severity }>
    removed: Array<{ field: string; discrepancy_type: DiscrepancyType; severity: Severity }>
    severity_changed: Array<{
      field: string
      discrepancy_type: DiscrepancyType
      severity: Severity
      previous_severity?: Severity | null
    }>
  }>
  errors: Array<Record<string, unknown>>
}

export interface RollbackResult {
  key: string
  retired_version: number
  effective: TypeVersionView
}

// Additional UI / Connector Types
export interface DataSourceConnection {
  id: string
  name: string
  kind: 'postgres' | 'documents' | 'api'
  target_system: string
  status: 'healthy' | 'degraded' | 'disconnected'
  is_simulated: boolean
  record_count: number
  last_sync: string
  config_summary: string
}

export interface McpToolMeta {
  name: string
  title: string
  description: string
  is_read_only: boolean
  is_destructive: boolean
  required_scope: string
  parameters: Array<{
    name: string
    type: string
    description: string
    required: boolean
  }>
}

export interface McpConnectionView {
  connection_id: string
  tenant: string
  name: string
  url: string
  has_token: boolean
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
  error?: string | null
  server_info?: {
    name: string
    version: string
    title?: string
    description?: string
    [key: string]: unknown
  } | null
  protocol_version?: string | null
  capabilities?: {
    tools?: Record<string, unknown>
    resources?: Record<string, unknown>
    prompts?: Record<string, unknown>
    [key: string]: unknown
  } | null
  instructions?: string | null
  tools_count: number
  resources_count: number
  prompts_count: number
  connected_at?: string | null
  last_activity_at?: string | null
  created_at: string
}

export interface McpToolCallResultView {
  tool_name: string
  is_error: boolean
  content: Array<{ type: string; text?: string; [k: string]: unknown }>
  structured_content?: unknown
  meta?: Record<string, unknown> | null
  latency_ms: number
  timestamp: string
}

export interface McpResourceReadResultView {
  uri: string
  contents: Array<{ uri?: string; mimeType?: string; text?: string; blob?: string; [k: string]: unknown }>
  meta?: Record<string, unknown> | null
  latency_ms: number
  timestamp: string
}

export interface McpPromptGetResultView {
  prompt_name: string
  description?: string | null
  messages: Array<{ role: string; content: { type: string; text?: string; [k: string]: unknown }; [k: string]: unknown }>
  meta?: Record<string, unknown> | null
  latency_ms: number
  timestamp: string
}

export interface McpExecutionRecordView {
  id: string
  operation: string
  target: string
  params?: Record<string, unknown>
  status: 'success' | 'error'
  latency_ms: number
  result_summary?: string | null
  error?: string | null
  timestamp: string
}

