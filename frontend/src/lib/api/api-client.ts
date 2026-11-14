import type {
  ActivateRequest,
  AuditPage,
  DecisionRequest,
  DiscrepancyExplanation,
  DiscrepancyPage,
  DiscrepancyStatus,
  DraftRequest,
  DraftResult,
  DraftUpdateRequest,
  DryRunRequest,
  DryRunResult,
  EffectiveTypeView,
  ProposalDetail,
  ProposalResult,
  ProposalStatus,
  ReconciliationTypeView,
  RollbackRequest,
  RollbackResult,
  RunEvidencePage,
  RunListItem,
  RunPage,
  RunStatus,
  RunStatusResult,
  Severity,
  StartReconciliationResult,
  StartRunRequest,
  StatsView,
  TypeVersionView,
  McpConnectionView,
  McpToolCallResultView,
  McpResourceReadResultView,
  McpPromptGetResultView,
  McpExecutionRecordView,
  ColumnMetadata,
  ConnectionTestRequest,
  ConnectionTestResult,
  ConnectorConnectionView,
  CreateConnectorRequest,
  EntityMappingConfig,
  MappingValidationResult,
  ProviderInfo,
  SamplePreviewRequest,
  SamplePreviewResponse,
  TableMetadata,
  TargetSchemaDefinition,
  UpdateConnectorRequest,
} from './api-types.ts'
import { ApiError, NetworkError, parseHttpError } from './api-errors.ts'
import { authClient } from '../auth/auth-client.ts'

export interface ClientConfig {
  baseUrl?: string
  token?: string
  tenant?: string
}

function generateCorrelationId(): string {
  return 'req-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36)
}

export class ReconcileApiClient {
  private baseUrl: string
  private token: string | null
  public tenant: string
  private onUnauthorizedCallback?: (err: ApiError) => void
  private onForbiddenCallback?: (err: ApiError) => void

  constructor(config: ClientConfig = {}) {
    const envBase = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL
    const envToken = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_AUTH_TOKEN
    const envTenant = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_DEV_TENANT

    let localBase = typeof localStorage !== 'undefined' ? localStorage.getItem('reconcile_api_url') : null
    // Clean up legacy default localhost:8000 so requests default to integrated BFF
    if (localBase === 'http://localhost:8000' || localBase === 'http://localhost:8090') {
      localBase = ''
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('reconcile_api_url')
      }
    }
    const localTenant = typeof localStorage !== 'undefined' ? localStorage.getItem('reconcile_tenant') : null

    this.baseUrl = (config.baseUrl !== undefined ? config.baseUrl : (localBase || envBase || '')).replace(/\/+$/, '')
    this.token = config.token || authClient.getStoredToken() || envToken || null
    this.tenant = config.tenant || localTenant || envTenant || 'acme-india'
  }

  setOnUnauthorized(cb: (err: ApiError) => void) {
    this.onUnauthorizedCallback = cb
  }

  setOnForbidden(cb: (err: ApiError) => void) {
    this.onForbiddenCallback = cb
  }

  setToken(token: string | null) {
    this.token = token
    if (token) {
      authClient.saveToken(token, false)
    } else {
      authClient.clearToken()
    }
  }

  getToken(): string | null {
    return this.token || authClient.getStoredToken()
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '')
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reconcile_api_url', this.baseUrl)
    }
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  setTenant(tenant: string) {
    this.tenant = tenant
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reconcile_tenant', tenant)
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const correlationId = generateCorrelationId()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
    }

    if (this.tenant) {
      headers['X-Tenant-ID'] = this.tenant
    }

    const activeToken = this.getToken()
    if (activeToken) {
      headers['Authorization'] = `Bearer ${activeToken}`
    }

    const url = `${this.baseUrl}${path}`

    let res: Response
    try {
      res = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers as Record<string, string>),
        },
      })
    } catch (err) {
      throw new NetworkError(url, err instanceof Error ? err : undefined)
    }

    if (!res.ok) {
      let code = 'ERROR_' + res.status
      let message = `Request failed with status ${res.status}`
      let issues: unknown[] | undefined

      try {
        const errBody = await res.json()
        if (errBody?.detail) {
          if (typeof errBody.detail === 'string') {
            message = errBody.detail
          } else if (typeof errBody.detail === 'object') {
            code = errBody.detail.code || code
            message = errBody.detail.message || message
            issues = errBody.detail.issues
          }
        }
      } catch {
        // non-JSON response body
      }

      const apiError = parseHttpError(res.status, message, code, issues)

      if (res.status === 401 && this.onUnauthorizedCallback) {
        this.onUnauthorizedCallback(apiError)
      } else if (res.status === 403 && this.onForbiddenCallback) {
        this.onForbiddenCallback(apiError)
      }

      throw apiError
    }

    if (res.status === 204) {
      return undefined as unknown as T
    }

    return (await res.json()) as T
  }

  /**
   * Health and readiness checks
   */
  async checkHealth(): Promise<{ live: boolean; workerAge?: number | null; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`)
      if (!res.ok) {
        // Fallback to /readyz if /api/health returns error
        const fallback = await fetch(`${this.baseUrl}/readyz`)
        if (fallback.ok) {
          const d = await fallback.json()
          return { live: d.status === 'ready', workerAge: d.worker_last_seen_seconds }
        }
        return { live: false, error: `Service responded with HTTP ${res.status}` }
      }
      const data = await res.json()
      const isLive = data.live === true || data.status === 'ready' || data.data?.status === 'healthy'
      const workerAge = data.worker_last_seen_seconds ?? data.data?.upstream?.workerLastSeenSeconds ?? null
      return {
        live: isLive,
        workerAge,
      }
    } catch (err) {
      return {
        live: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }
    }
  }

  /**
   * Validates credentials against the backend by testing an authenticated read.
   */
  async verifyCredentials(token: string): Promise<{ success: boolean; error?: string; status?: number }> {
    const url = `${this.baseUrl}/api/v1/types`
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Correlation-ID': generateCorrelationId(),
        },
      })

      if (res.ok) {
        return { success: true }
      }

      let errorMsg = `HTTP ${res.status}`
      try {
        const data = await res.json()
        if (data.detail) {
          errorMsg = typeof data.detail === 'string' ? data.detail : data.detail.message || errorMsg
        }
      } catch {
        // ignore
      }

      return { success: false, error: errorMsg, status: res.status }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network connection failure',
      }
    }
  }

  /**
   * Dashboard & Operational Statistics
   */
  async getStats(): Promise<StatsView> {
    return this.request<StatsView>('/api/v1/stats')
  }

  async getReconciliationTypes(): Promise<ReconciliationTypeView[]> {
    return this.request<ReconciliationTypeView[]>('/api/v1/types')
  }

  /**
   * Reconciliation Runs
   */
  async listRuns(params?: {
    status?: RunStatus
    type?: string
    limit?: number
    cursor?: string
  }): Promise<RunPage> {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.type) q.set('type', params.type)
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.cursor) q.set('cursor', params.cursor)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return this.request<RunPage>(`/api/v1/runs${qs}`)
  }

  async startRun(req: StartRunRequest): Promise<StartReconciliationResult> {
    return this.request<StartReconciliationResult>('/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async getRun(runId: string): Promise<RunStatusResult> {
    return this.request<RunStatusResult>(`/api/v1/runs/${runId}`)
  }

  async listDiscrepancies(
    runId: string,
    params?: {
      severity?: Severity
      severities?: Severity[]
      status?: DiscrepancyStatus
      statuses?: DiscrepancyStatus[]
      limit?: number
      cursor?: string
    }
  ): Promise<DiscrepancyPage> {
    const q = new URLSearchParams()
    if (params?.severity) q.set('severity', params.severity)
    if (params?.status) q.set('status', params.status)
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.cursor) q.set('cursor', params.cursor)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return this.request<DiscrepancyPage>(`/api/v1/runs/${runId}/discrepancies${qs}`)
  }

  async listRunDiscrepancies(
    runId: string,
    params?: {
      severity?: Severity
      severities?: Severity[]
      status?: DiscrepancyStatus
      statuses?: DiscrepancyStatus[]
      limit?: number
      cursor?: string
    }
  ): Promise<DiscrepancyPage> {
    return this.listDiscrepancies(runId, params)
  }

  async getDiscrepancy(discrepancyId: string): Promise<DiscrepancyExplanation> {
    return this.request<DiscrepancyExplanation>(`/api/v1/discrepancies/${discrepancyId}`)
  }

  async explainDiscrepancy(discrepancyId: string): Promise<DiscrepancyExplanation> {
    return this.getDiscrepancy(discrepancyId)
  }

  async listEvidence(
    runId: string,
    params?: {
      side?: 'a' | 'b'
      documents_only?: boolean
      documentsOnly?: boolean
      limit?: number
      cursor?: string
    }
  ): Promise<RunEvidencePage> {
    const q = new URLSearchParams()
    if (params?.side) q.set('side', params.side)
    const docsOnly = params?.documents_only !== undefined ? params.documents_only : params?.documentsOnly
    if (docsOnly !== undefined) q.set('documents_only', String(docsOnly))
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.cursor) q.set('cursor', params.cursor)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return this.request<RunEvidencePage>(`/api/v1/runs/${runId}/evidence${qs}`)
  }

  async listRunEvidence(
    runId: string,
    params?: {
      side?: 'a' | 'b'
      documents_only?: boolean
      documentsOnly?: boolean
      limit?: number
      cursor?: string
    }
  ): Promise<RunEvidencePage> {
    return this.listEvidence(runId, params)
  }

  async listAudit(
    runId: string,
    params?: {
      limit?: number
      cursor?: string
    }
  ): Promise<AuditPage> {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.cursor) q.set('cursor', params.cursor)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return this.request<AuditPage>(`/api/v1/runs/${runId}/audit${qs}`)
  }

  async getRunAudit(
    runId: string,
    params?: {
      limit?: number
      cursor?: string
    }
  ): Promise<AuditPage> {
    return this.listAudit(runId, params)
  }

  /**
   * Approvals & Proposals
   */
  async listProposals(params?: {
    status?: ProposalStatus
    limit?: number
  }): Promise<ProposalResult[]> {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString() ? `?${q.toString()}` : ''
    return this.request<ProposalResult[]>(`/api/v1/proposals${qs}`)
  }

  async getProposal(proposalId: string): Promise<ProposalDetail> {
    return this.request<ProposalDetail>(`/api/v1/proposals/${proposalId}`)
  }

  async decideProposal(proposalId: string, req: DecisionRequest): Promise<ProposalResult> {
    return this.request<ProposalResult>(`/api/v1/proposals/${proposalId}/decision`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  /**
   * Administration & Rules
   */
  async getEffectiveType(key: string): Promise<EffectiveTypeView> {
    return this.request<EffectiveTypeView>(`/api/v1/admin/types/${key}`)
  }

  async createDraft(key: string, req: DraftRequest): Promise<DraftResult> {
    return this.request<DraftResult>(`/api/v1/admin/types/${key}/drafts`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async updateDraft(draftId: string, req: DraftUpdateRequest): Promise<DraftResult> {
    return this.request<DraftResult>(`/api/v1/admin/drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    })
  }

  async deleteDraft(draftId: string): Promise<void> {
    return this.request<void>(`/api/v1/admin/drafts/${draftId}`, {
      method: 'DELETE',
    })
  }

  async validateDraft(draftId: string): Promise<DraftResult> {
    return this.request<DraftResult>(`/api/v1/admin/drafts/${draftId}/validate`, {
      method: 'POST',
    })
  }

  async dryRunDraft(draftId: string, req: DryRunRequest): Promise<DryRunResult> {
    return this.request<DryRunResult>(`/api/v1/admin/drafts/${draftId}/dry-run`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async activateDraft(draftId: string, req: ActivateRequest): Promise<TypeVersionView> {
    return this.request<TypeVersionView>(`/api/v1/admin/drafts/${draftId}/activate`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async rollbackType(key: string, req: RollbackRequest): Promise<RollbackResult> {
    return this.request<RollbackResult>(`/api/v1/admin/types/${key}/rollback`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  /**
   * MCP Controller & BFF Specific Methods
   */
  async getDashboardOverview(): Promise<{
    stats: StatsView | null
    recentRuns: RunListItem[]
    types: ReconciliationTypeView[]
    recentAuditEvents: unknown[]
    generatedAt: string
  }> {
    const res = await this.request<{
      success: boolean
      data: {
        stats: StatsView | null
        recentRuns: RunListItem[]
        types: ReconciliationTypeView[]
        recentAuditEvents: unknown[]
        generatedAt: string
      }
    }>('/api/dashboard/overview')
    return res.data
  }

  async startMcpReconciliation(req: {
    reconciliation_type: string
    source_refs?: Record<string, string>
    selection?: Record<string, unknown>
    idempotency_key?: string
  }): Promise<StartReconciliationResult> {
    const res = await this.request<{ success: boolean; data: StartReconciliationResult }>(
      '/api/reconciliation/start',
      {
        method: 'POST',
        body: JSON.stringify(req),
      }
    )
    return res.data
  }

  async proposeResolution(req: {
    discrepancy_id: string
    action: string
    params?: Record<string, string>
    rationale: string
    idempotency_key?: string
  }): Promise<unknown> {
    const res = await this.request<{ success: boolean; data: unknown }>('/api/reconciliation/proposals', {
      method: 'POST',
      body: JSON.stringify(req),
    })
    return res.data
  }

  async validateResolution(proposalId: string): Promise<unknown> {
    const res = await this.request<{ success: boolean; data: unknown }>(
      `/api/reconciliation/proposals/${proposalId}/validate`,
      { method: 'POST' }
    )
    return res.data
  }

  async applyResolution(proposalId: string, confirmed: boolean, idempotencyKey?: string): Promise<unknown> {
    const res = await this.request<{ success: boolean; data: unknown }>(
      `/api/reconciliation/proposals/${proposalId}/apply`,
      {
        method: 'POST',
        body: JSON.stringify({ confirmed, idempotency_key: idempotencyKey }),
      }
    )
    return res.data
  }

  async getMcpCapabilities(): Promise<unknown> {
    const res = await this.request<{ success: boolean; data: unknown }>('/api/mcp/capabilities')
    return res.data
  }

  // --- Real MCP Client Connection Methods (/api/v1/mcp/*) ---

  async createMcpConnection(req: {
    url: string
    name?: string
    bearer_token?: string
    headers?: Record<string, string>
    connect_now?: boolean
  }): Promise<McpConnectionView> {
    return this.request<McpConnectionView>('/api/v1/mcp/connections', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async listMcpConnections(): Promise<McpConnectionView[]> {
    return this.request<McpConnectionView[]>('/api/v1/mcp/connections')
  }

  async getMcpConnection(connectionId: string): Promise<McpConnectionView> {
    return this.request<McpConnectionView>(`/api/v1/mcp/connections/${connectionId}`)
  }

  async connectMcpConnection(connectionId: string): Promise<McpConnectionView> {
    return this.request<McpConnectionView>(`/api/v1/mcp/connections/${connectionId}/connect`, {
      method: 'POST',
    })
  }

  async disconnectMcpConnection(connectionId: string): Promise<McpConnectionView> {
    return this.request<McpConnectionView>(`/api/v1/mcp/connections/${connectionId}/disconnect`, {
      method: 'POST',
    })
  }

  async refreshMcpConnection(connectionId: string): Promise<McpConnectionView> {
    return this.request<McpConnectionView>(`/api/v1/mcp/connections/${connectionId}/refresh`, {
      method: 'POST',
    })
  }

  async listMcpTools(connectionId: string): Promise<Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>> {
    return this.request<Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>>(
      `/api/v1/mcp/connections/${connectionId}/tools`
    )
  }

  async listMcpResources(connectionId: string): Promise<Array<{ uri: string; name?: string; description?: string; mimeType?: string }>> {
    return this.request<Array<{ uri: string; name?: string; description?: string; mimeType?: string }>>(
      `/api/v1/mcp/connections/${connectionId}/resources`
    )
  }

  async listMcpPrompts(connectionId: string): Promise<Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>> {
    return this.request<Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>>(
      `/api/v1/mcp/connections/${connectionId}/prompts`
    )
  }

  async callMcpTool(
    connectionId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResultView> {
    return this.request<McpToolCallResultView>(
      `/api/v1/mcp/connections/${connectionId}/tools/${encodeURIComponent(toolName)}/call`,
      {
        method: 'POST',
        body: JSON.stringify({ arguments: args }),
      }
    )
  }

  async readMcpResource(connectionId: string, uri: string): Promise<McpResourceReadResultView> {
    return this.request<McpResourceReadResultView>(`/api/v1/mcp/connections/${connectionId}/resources/read`, {
      method: 'POST',
      body: JSON.stringify({ uri }),
    })
  }

  async getMcpPrompt(
    connectionId: string,
    promptName: string,
    args?: Record<string, unknown>
  ): Promise<McpPromptGetResultView> {
    return this.request<McpPromptGetResultView>(`/api/v1/mcp/connections/${connectionId}/prompts/get`, {
      method: 'POST',
      body: JSON.stringify({ prompt_name: promptName, arguments: args }),
    })
  }

  async getMcpHistory(connectionId: string, limit = 50): Promise<McpExecutionRecordView[]> {
    return this.request<McpExecutionRecordView[]>(`/api/v1/mcp/connections/${connectionId}/history?limit=${limit}`)
  }

  // ------------------------------------------------------------------
  // Data Connector Manager API
  // ------------------------------------------------------------------

  async listConnectorProviders(): Promise<ProviderInfo[]> {
    return this.request<ProviderInfo[]>('/api/v1/connectors/providers')
  }

  async listTargetSchemas(): Promise<TargetSchemaDefinition[]> {
    return this.request<TargetSchemaDefinition[]>('/api/v1/connectors/target-schemas')
  }

  async testUnpersistedConnection(req: ConnectionTestRequest): Promise<ConnectionTestResult> {
    return this.request<ConnectionTestResult>('/api/v1/connectors/test', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async createConnectorConnection(req: CreateConnectorRequest): Promise<ConnectorConnectionView> {
    return this.request<ConnectorConnectionView>('/api/v1/connectors', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async listConnectorConnections(): Promise<ConnectorConnectionView[]> {
    return this.request<ConnectorConnectionView[]>('/api/v1/connectors')
  }

  async getConnectorConnection(connectionId: string): Promise<ConnectorConnectionView> {
    return this.request<ConnectorConnectionView>(`/api/v1/connectors/${connectionId}`)
  }

  async updateConnectorConnection(
    connectionId: string,
    req: UpdateConnectorRequest
  ): Promise<ConnectorConnectionView> {
    return this.request<ConnectorConnectionView>(`/api/v1/connectors/${connectionId}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    })
  }

  async deleteConnectorConnection(connectionId: string): Promise<void> {
    await this.request<void>(`/api/v1/connectors/${connectionId}`, {
      method: 'DELETE',
    })
  }

  async testSavedConnection(connectionId: string): Promise<ConnectionTestResult> {
    return this.request<ConnectionTestResult>(`/api/v1/connectors/${connectionId}/test`, {
      method: 'POST',
    })
  }

  async discoverSchemas(connectionId: string): Promise<string[]> {
    return this.request<string[]>(`/api/v1/connectors/${connectionId}/schemas`)
  }

  async discoverTables(connectionId: string, schema: string): Promise<TableMetadata[]> {
    return this.request<TableMetadata[]>(
      `/api/v1/connectors/${connectionId}/schemas/${encodeURIComponent(schema)}/tables`
    )
  }

  async discoverColumns(
    connectionId: string,
    schema: string,
    table: string
  ): Promise<ColumnMetadata[]> {
    return this.request<ColumnMetadata[]>(
      `/api/v1/connectors/${connectionId}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/columns`
    )
  }

  async previewSample(
    connectionId: string,
    req: SamplePreviewRequest
  ): Promise<SamplePreviewResponse> {
    return this.request<SamplePreviewResponse>(`/api/v1/connectors/${connectionId}/preview`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async getMappings(connectionId: string): Promise<EntityMappingConfig[]> {
    return this.request<EntityMappingConfig[]>(`/api/v1/connectors/${connectionId}/mappings`)
  }

  async saveMappings(
    connectionId: string,
    mappings: EntityMappingConfig[]
  ): Promise<EntityMappingConfig[]> {
    return this.request<EntityMappingConfig[]>(`/api/v1/connectors/${connectionId}/mappings`, {
      method: 'PUT',
      body: JSON.stringify(mappings),
    })
  }

  async validateMapping(
    connectionId: string,
    mapping: EntityMappingConfig
  ): Promise<MappingValidationResult> {
    return this.request<MappingValidationResult>(
      `/api/v1/connectors/${connectionId}/mappings/validate`,
      {
        method: 'POST',
        body: JSON.stringify(mapping),
      }
    )
  }
}

export const apiClient = new ReconcileApiClient()
