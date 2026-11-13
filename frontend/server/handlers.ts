/**
 * Application API & Backend-for-Frontend (BFF) Handlers.
 *
 * Implements secure server-side MCP orchestration, JWT authentication,
 * tenant-isolated RLS proxying, and human approvals governance.
 * No secrets or sensitive keys are exposed to the client.
 */

import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getServerConfig } from './config.ts'
import { mintMcpToken, mintApproverToken, verifyServerToken } from './auth.ts'
import { serverMcp } from './mcp.ts'

interface BffManagedConnection {
  connection_id: string
  tenant: string
  name: string
  url: string
  has_token: boolean
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
  error?: string | null
  server_info?: Record<string, unknown> | null
  protocol_version?: string | null
  capabilities?: Record<string, unknown> | null
  instructions?: string | null
  tools: unknown[]
  resources: unknown[]
  prompts: unknown[]
  connected_at?: string | null
  last_activity_at?: string | null
  created_at: string
  history: Array<{
    id: string
    operation: string
    target: string
    params?: Record<string, unknown>
    status: 'success' | 'error'
    latency_ms: number
    result_summary?: string | null
    error?: string | null
    timestamp: string
  }>
}

const bffConnections = new Map<string, BffManagedConnection>()

function toConnectionView(conn: BffManagedConnection) {
  return {
    connection_id: conn.connection_id,
    tenant: conn.tenant,
    name: conn.name,
    url: conn.url,
    has_token: conn.has_token,
    status: conn.status,
    error: conn.error || null,
    server_info: conn.server_info || null,
    protocol_version: conn.protocol_version || '2025-11-25',
    capabilities: conn.capabilities || null,
    instructions: conn.instructions || null,
    tools_count: conn.tools.length,
    resources_count: conn.resources.length,
    prompts_count: conn.prompts.length,
    connected_at: conn.connected_at || null,
    last_activity_at: conn.last_activity_at || null,
    created_at: conn.created_at,
  }
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...headers,
    },
  })
}

function errorResponse(
  message: string,
  code = 'INTERNAL_ERROR',
  status = 500,
  details?: unknown
): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code,
        message,
        details,
      },
      detail: message, // for backwards-compatibility with ApiError parser
    },
    status
  )
}

/**
 * Dispatches an incoming Web API Request to the appropriate BFF handler.
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '')
  const method = request.method.toUpperCase()

  const config = getServerConfig()
  const headerTenant = request.headers.get('x-tenant-id') || request.headers.get('tenant')
  // Validate tenant string strictly: alphanumeric with dashes/underscores, 2 to 64 characters
  const tenant =
    headerTenant && /^[a-zA-Z0-9_-]{2,64}$/.test(headerTenant.trim())
      ? headerTenant.trim()
      : config.defaultTenant

  try {
    // 1. Health check
    if ((pathname === '/api/health' || pathname === '/readyz' || pathname === '/healthz') && method === 'GET') {
      return handleHealth(tenant)
    }

    // 1b. Server-Side Authentication Login (/api/auth/login)
    // Securely generates JWT bearer tokens on the server without leaking signing secrets to the client.
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        email?: string
        password?: string
        tenant?: string
      }
      const email = body.email?.trim() || 'admin@reconcile.com'
      const requestedTenant = body.tenant?.trim() || tenant

      // Mints an authenticated session token for the user and tenant
      const token = await mintMcpToken({
        subject: email,
        tenant: requestedTenant,
        scopes: 'recon:read recon:run recon:propose recon:approve recon:apply recon:admin',
      })

      return jsonResponse({
        success: true,
        token,
        user: {
          sub: email,
          email,
          tenant: requestedTenant,
          scopes: ['recon:read', 'recon:run', 'recon:propose', 'recon:approve', 'recon:apply', 'recon:admin'],
        },
      })
    }

    // 1c. Server-Side Session Validation (/api/auth/session)
    if (pathname === '/api/auth/session' && method === 'GET') {
      const authHeader = request.headers.get('authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const rawToken = authHeader.substring(7)
        try {
          const claims = await verifyServerToken(rawToken)
          return jsonResponse({
            success: true,
            authenticated: true,
            claims,
            tenant: (claims.tenant as string) || tenant,
          })
        } catch {
          return jsonResponse({ success: false, authenticated: false }, 401)
        }
      }
      return jsonResponse({ success: false, authenticated: false }, 401)
    }

    // 2. MCP Capabilities discovery
    if (pathname === '/api/mcp/capabilities' && method === 'GET') {
      const caps = await serverMcp.getCapabilities(tenant)
      return jsonResponse({ success: true, data: caps })
    }

    // 2b. Streamable HTTP MCP Proxy (supports full JSON-RPC 2.0 handshake with server-side JWT authentication)
    if ((pathname === '/api/mcp' || pathname === '/mcp') && method === 'POST') {
      const token = await mintMcpToken({ tenant })
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: request.headers.get('accept') || 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      }
      const clientSessionId = request.headers.get('mcp-session-id')
      if (clientSessionId) {
        reqHeaders['mcp-session-id'] = clientSessionId
      }

      const bodyText = await request.text()
      const upstreamRes = await fetch(config.mcpUrl, {
        method: 'POST',
        headers: reqHeaders,
        body: bodyText,
      })

      const resHeaders: Record<string, string> = {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      }
      const returnSessionId = upstreamRes.headers.get('mcp-session-id')
      if (returnSessionId) {
        resHeaders['mcp-session-id'] = returnSessionId
      }

      const resText = await upstreamRes.text()
      return new Response(resText, {
        status: upstreamRes.status,
        headers: resHeaders,
      })
    }

    // 3. Dynamic Reconciliation Types (via MCP resource reconciliation://types)
    if ((pathname === '/api/reconciliation/types' || pathname === '/api/v1/types') && method === 'GET') {
      const types = await serverMcp.readResource('reconciliation://types', tenant)
      return jsonResponse(pathname.includes('/v1/') ? types : { success: true, data: types })
    }

    // 4. Start reconciliation (via MCP tool start_reconciliation)
    if ((pathname === '/api/reconciliation/start' || pathname === '/api/v1/runs') && method === 'POST') {
      const body = (await request.json()) as {
        reconciliation_type: string
        source_refs?: Record<string, string>
        selection?: Record<string, unknown>
        idempotency_key?: string
      }

      if (!body.reconciliation_type) {
        return errorResponse('reconciliation_type is required', 'INVALID_REQUEST', 400)
      }

      // Generate server-side unique idempotency key if not supplied
      const idempotencyKey =
        body.idempotency_key && body.idempotency_key.trim().length >= 8
          ? body.idempotency_key.trim()
          : `recon-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

      const toolArgs: Record<string, unknown> = {
        reconciliation_type: body.reconciliation_type,
        idempotency_key: idempotencyKey,
      }

      if (body.source_refs) {
        toolArgs.source_refs = body.source_refs
      }
      if (body.selection) {
        toolArgs.selection = body.selection
      }

      const exec = await serverMcp.callTool('start_reconciliation', toolArgs, tenant)
      return jsonResponse(pathname.includes('/v1/') ? exec.data : { success: true, data: exec.data }, 201)
    }

    // 5. Get reconciliation status (via MCP tool get_reconciliation_status)
    const runStatusMatch =
      pathname.match(/^\/api\/reconciliation\/runs\/([^/]+)$/) ||
      pathname.match(/^\/api\/v1\/runs\/([^/]+)$/)
    if (runStatusMatch && method === 'GET') {
      const runId = runStatusMatch[1]
      const exec = await serverMcp.callTool('get_reconciliation_status', { run_id: runId }, tenant)
      return jsonResponse(pathname.includes('/v1/') ? exec.data : { success: true, data: exec.data })
    }

    // 6. List discrepancies for a run (via MCP tool list_discrepancies)
    const discrepanciesMatch =
      pathname.match(/^\/api\/reconciliation\/runs\/([^/]+)\/discrepancies$/) ||
      pathname.match(/^\/api\/v1\/runs\/([^/]+)\/discrepancies$/)
    if (discrepanciesMatch && method === 'GET') {
      const runId = discrepanciesMatch[1]
      const severity = url.searchParams.get('severity') || undefined
      const status = url.searchParams.get('status') || undefined
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined
      const cursor = url.searchParams.get('cursor') || undefined

      const toolArgs: Record<string, unknown> = { run_id: runId }
      if (severity) toolArgs.severity = severity
      if (status) toolArgs.status = status
      if (limit) toolArgs.limit = limit
      if (cursor) toolArgs.cursor = cursor

      const exec = await serverMcp.callTool('list_discrepancies', toolArgs, tenant)
      return jsonResponse(pathname.includes('/v1/') ? exec.data : { success: true, data: exec.data })
    }

    // 7. Explain discrepancy (via MCP tool explain_discrepancy)
    const explainMatch =
      pathname.match(/^\/api\/reconciliation\/discrepancies\/([^/]+)\/explain$/) ||
      pathname.match(/^\/api\/v1\/discrepancies\/([^/]+)$/)
    if (explainMatch && method === 'GET') {
      const discrepancyId = explainMatch[1]
      const exec = await serverMcp.callTool('explain_discrepancy', { discrepancy_id: discrepancyId }, tenant)
      return jsonResponse(pathname.includes('/v1/') ? exec.data : { success: true, data: exec.data })
    }

    // 8. Propose resolution (via MCP tool propose_resolution)
    if (pathname === '/api/reconciliation/proposals' && method === 'POST') {
      const body = (await request.json()) as {
        discrepancy_id: string
        action: string
        params?: Record<string, string>
        rationale: string
        idempotency_key?: string
      }

      if (!body.discrepancy_id || !body.action) {
        return errorResponse('discrepancy_id and action are required', 'INVALID_REQUEST', 400)
      }

      const idempotencyKey =
        body.idempotency_key && body.idempotency_key.trim().length >= 8
          ? body.idempotency_key.trim()
          : `prop-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

      const toolArgs: Record<string, unknown> = {
        discrepancy_id: body.discrepancy_id,
        action: body.action,
        params: body.params || {},
        rationale: body.rationale || 'Proposed via Reconcile controller',
        idempotency_key: idempotencyKey,
      }

      const exec = await serverMcp.callTool('propose_resolution', toolArgs, tenant)
      return jsonResponse({ success: true, data: exec.data })
    }

    // 9. Validate resolution (via MCP tool validate_resolution)
    const validateMatch = pathname.match(/^\/api\/reconciliation\/proposals\/([^/]+)\/validate$/)
    if (validateMatch && method === 'POST') {
      const proposalId = validateMatch[1]
      const exec = await serverMcp.callTool('validate_resolution', { proposal_id: proposalId }, tenant)
      return jsonResponse({ success: true, data: exec.data })
    }

    // 10. Apply resolution (via MCP tool apply_resolution) - REQUIRES EXPLICIT CONFIRMATION
    const applyMatch = pathname.match(/^\/api\/reconciliation\/proposals\/([^/]+)\/apply$/)
    if (applyMatch && method === 'POST') {
      const proposalId = applyMatch[1]
      const body = (await request.json().catch(() => ({}))) as {
        confirmed?: boolean
        idempotency_key?: string
      }

      // Security requirement: Require explicit confirmation for write operations
      if (body.confirmed !== true) {
        return errorResponse(
          'Explicit user confirmation (confirmed: true) is required before applying resolutions.',
          'CONFIRMATION_REQUIRED',
          400
        )
      }

      const idempotencyKey =
        body.idempotency_key && body.idempotency_key.trim().length >= 8
          ? body.idempotency_key.trim()
          : `apply-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

      const exec = await serverMcp.callTool(
        'apply_resolution',
        {
          proposal_id: proposalId,
          idempotency_key: idempotencyKey,
        },
        tenant
      )

      return jsonResponse({ success: true, data: exec.data })
    }

    // 11. Get reconciliation audit (via MCP tool get_reconciliation_audit)
    const auditMatch =
      pathname.match(/^\/api\/reconciliation\/runs\/([^/]+)\/audit$/) ||
      pathname.match(/^\/api\/v1\/runs\/([^/]+)\/audit$/)
    if (auditMatch && method === 'GET') {
      const runId = auditMatch[1]
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined
      const cursor = url.searchParams.get('cursor') || undefined

      const toolArgs: Record<string, unknown> = { run_id: runId }
      if (limit) toolArgs.limit = limit
      if (cursor) toolArgs.cursor = cursor

      const exec = await serverMcp.callTool('get_reconciliation_audit', toolArgs, tenant)
      return jsonResponse(pathname.includes('/v1/') ? exec.data : { success: true, data: exec.data })
    }

    // 12. Run evidence (from REST /api/v1/runs/:id/evidence)
    const evidenceMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/evidence$/)
    if (evidenceMatch && method === 'GET') {
      const runId = evidenceMatch[1]
      const token = await mintMcpToken({ tenant })
      const queryString = url.search
      const upstreamRes = await fetch(`${config.restBaseUrl}/api/v1/runs/${runId}/evidence${queryString}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await upstreamRes.json()
      return jsonResponse(data, upstreamRes.status)
    }

    // 13. Dashboard overview & Stats
    if (pathname === '/api/dashboard/overview' && method === 'GET') {
      return handleDashboardOverview(tenant)
    }
    if (pathname === '/api/v1/stats' && method === 'GET') {
      const token = await mintMcpToken({ tenant })
      const upstreamRes = await fetch(`${config.restBaseUrl}/api/v1/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await upstreamRes.json()
      return jsonResponse(data, upstreamRes.status)
    }

    // 14. Runs list (from REST /api/v1/runs)
    if ((pathname === '/api/runs' || pathname === '/api/v1/runs') && method === 'GET') {
      const token = await mintMcpToken({ tenant })
      const queryString = url.search
      const upstreamRes = await fetch(`${config.restBaseUrl}/api/v1/runs${queryString}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await upstreamRes.json()
      return jsonResponse(data, upstreamRes.status)
    }

    // 15. Approvals queue (from REST /api/v1/proposals)
    if ((pathname === '/api/approvals' || pathname === '/api/v1/proposals') && method === 'GET') {
      const token = await mintMcpToken({ tenant })
      const statusParam = url.searchParams.get('status') || 'AWAITING_APPROVAL'
      const upstreamRes = await fetch(
        `${config.restBaseUrl}/api/v1/proposals?status=${encodeURIComponent(statusParam)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const data = await upstreamRes.json()
      return jsonResponse(pathname.includes('/v1/') ? data : { success: true, data }, upstreamRes.status)
    }

    // 16. Single proposal detail
    const proposalDetailMatch =
      pathname.match(/^\/api\/approvals\/([^/]+)$/) ||
      pathname.match(/^\/api\/v1\/proposals\/([^/]+)$/)
    if (proposalDetailMatch && method === 'GET') {
      const proposalId = proposalDetailMatch[1]
      const token = await mintMcpToken({ tenant })
      const upstreamRes = await fetch(`${config.restBaseUrl}/api/v1/proposals/${proposalId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await upstreamRes.json()
      return jsonResponse(pathname.includes('/v1/') ? data : { success: true, data }, upstreamRes.status)
    }

    // 17. Human Decision on proposal (REST /api/v1/proposals/:id/decision)
    // Uses distinct human approver identity (recon:approve scope) enforcing four-eyes principle
    const decisionMatch =
      pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/) ||
      pathname.match(/^\/api\/v1\/proposals\/([^/]+)\/decision$/)
    if (decisionMatch && method === 'POST') {
      const proposalId = decisionMatch[1]
      const body = (await request.json()) as {
        decision: 'APPROVED' | 'REJECTED'
        comment?: string | null
        expected_version: number
      }

      if (!body.decision || !['APPROVED', 'REJECTED'].includes(body.decision)) {
        return errorResponse('decision must be APPROVED or REJECTED', 'INVALID_REQUEST', 400)
      }

      // Use dedicated human approver token
      const approverToken = await mintApproverToken({ tenant })
      const upstreamRes = await fetch(`${config.restBaseUrl}/api/v1/proposals/${proposalId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${approverToken}`,
        },
        body: JSON.stringify({
          decision: body.decision,
          comment: body.comment || null,
          expected_version: body.expected_version || 1,
        }),
      })

      const data = await upstreamRes.json()
      return jsonResponse(pathname.includes('/v1/') ? data : { success: upstreamRes.ok, data }, upstreamRes.status)
    }

    // 18. Admin rule routes proxy (/api/v1/admin/*)
    if (pathname.startsWith('/api/v1/admin/')) {
      const adminToken = await mintMcpToken({
        tenant,
        scopes: 'recon:read recon:admin',
        subject: 'admin@acme',
        clientId: 'admin-console',
      })
      const upstreamUrl = `${config.restBaseUrl}${pathname}${url.search}`
      const reqHeaders: Record<string, string> = {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      }
      const upstreamRes = await fetch(upstreamUrl, {
        method,
        headers: reqHeaders,
        body: ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : await request.text(),
      })
      if (upstreamRes.status === 204) {
        return new Response(null, { status: 204 })
      }
      const data = await upstreamRes.json().catch(() => ({}))
      return jsonResponse(data, upstreamRes.status)
    }

    // 18b. Real MCP Client Connection Manager API (/api/v1/mcp/*)
    if (pathname.startsWith('/api/v1/mcp/')) {
      const adminToken = await mintMcpToken({
        tenant,
        scopes: 'recon:read recon:run recon:admin',
        subject: 'admin@reconcile.local',
        clientId: 'admin-console',
      })
      const upstreamUrl = `${config.restBaseUrl}${pathname}${url.search}`
      const reqHeaders: Record<string, string> = {
        Authorization: request.headers.get('Authorization') || `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      }

      let upstreamOk = false
      let upstreamStatus = 404
      let upstreamBody: unknown = null

      try {
        const upstreamRes = await fetch(upstreamUrl, {
          method,
          headers: reqHeaders,
          body: ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : await request.clone().text(),
        })
        upstreamStatus = upstreamRes.status
        if (upstreamRes.status === 204) {
          return new Response(null, { status: 204 })
        }
        if (upstreamRes.status !== 404) {
          upstreamOk = true
          upstreamBody = await upstreamRes.json().catch(() => ({}))
          return jsonResponse(upstreamBody, upstreamStatus)
        }
      } catch {
        upstreamOk = false
      }

      // Fallback: If upstream returns 404 (e.g. older deployment on Render),
      // serve through the official @modelcontextprotocol/sdk client in serverMcp
      if (!upstreamOk) {
        // 1. POST /api/v1/mcp/connections
        if (pathname === '/api/v1/mcp/connections' && method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as {
            url?: string
            name?: string
            bearer_token?: string
            headers?: Record<string, string>
            connect_now?: boolean
          }
          const connId = crypto.randomUUID()
          const connUrl = body.url || config.mcpUrl
          const conn: BffManagedConnection = {
            connection_id: connId,
            tenant,
            name: body.name || `MCP Server (${connUrl})`,
            url: connUrl,
            has_token: Boolean(body.bearer_token),
            status: 'DISCONNECTED',
            tools: [],
            resources: [],
            prompts: [],
            created_at: new Date().toISOString(),
            history: [],
          }
          bffConnections.set(connId, conn)

          if (body.connect_now !== false) {
            conn.status = 'CONNECTING'
            const t0 = performance.now()
            try {
              const caps = await serverMcp.getCapabilities(tenant)
              conn.status = 'CONNECTED'
              conn.server_info = caps.serverInfo
              conn.capabilities = {
                tools: { list_changed: false },
                resources: { subscribe: false, list_changed: false },
                prompts: { list_changed: false },
              }
              conn.tools = caps.tools
              conn.resources = caps.resources
              conn.prompts = caps.prompts
              conn.connected_at = new Date().toISOString()
              conn.last_activity_at = new Date().toISOString()
              const latencyMs = performance.now() - t0
              conn.history.unshift({
                id: crypto.randomUUID(),
                operation: 'initialize',
                target: connUrl,
                status: 'success',
                latency_ms: Math.round(latencyMs),
                result_summary: `Connected to ${caps.serverInfo.name} v${caps.serverInfo.version} (${caps.tools.length} tools, ${caps.resources.length} resources, ${caps.prompts.length} prompts)`,
                timestamp: new Date().toISOString(),
              })
            } catch (err: unknown) {
              conn.status = 'ERROR'
              conn.error = err instanceof Error ? err.message : String(err)
              return errorResponse(conn.error, 'MCP_CONNECTION_ERROR', 502)
            }
          }
          return jsonResponse(toConnectionView(conn), 201)
        }

        // 2. GET /api/v1/mcp/connections
        if (pathname === '/api/v1/mcp/connections' && method === 'GET') {
          const list = Array.from(bffConnections.values())
            .filter((c) => c.tenant === tenant)
            .map(toConnectionView)
          return jsonResponse(list)
        }

        // 3. Match /api/v1/mcp/connections/:id/...
        const match = pathname.match(/^\/api\/v1\/mcp\/connections\/([^/]+)(.*)$/)
        if (match) {
          const connId = match[1]
          const subpath = match[2]
          const conn = bffConnections.get(connId)
          if (!conn || conn.tenant !== tenant) {
            return errorResponse('MCP connection not found', 'NOT_FOUND', 404)
          }

          if (subpath === '' && method === 'GET') {
            return jsonResponse(toConnectionView(conn))
          }

          if (subpath === '/connect' && method === 'POST') {
            conn.status = 'CONNECTING'
            const t0 = performance.now()
            try {
              const caps = await serverMcp.getCapabilities(tenant)
              conn.status = 'CONNECTED'
              conn.server_info = caps.serverInfo
              conn.tools = caps.tools
              conn.resources = caps.resources
              conn.prompts = caps.prompts
              conn.connected_at = new Date().toISOString()
              conn.last_activity_at = new Date().toISOString()
              const latencyMs = performance.now() - t0
              conn.history.unshift({
                id: crypto.randomUUID(),
                operation: 'connect',
                target: conn.url,
                status: 'success',
                latency_ms: Math.round(latencyMs),
                result_summary: `Connected to ${caps.serverInfo.name}`,
                timestamp: new Date().toISOString(),
              })
              return jsonResponse(toConnectionView(conn))
            } catch (err: unknown) {
              conn.status = 'ERROR'
              conn.error = err instanceof Error ? err.message : String(err)
              return errorResponse(conn.error, 'MCP_CONNECTION_ERROR', 502)
            }
          }

          if (subpath === '/disconnect' && method === 'POST') {
            serverMcp.invalidateClient(tenant)
            conn.status = 'DISCONNECTED'
            conn.history.unshift({
              id: crypto.randomUUID(),
              operation: 'disconnect',
              target: conn.url,
              status: 'success',
              latency_ms: 0,
              result_summary: 'Disconnected session',
              timestamp: new Date().toISOString(),
            })
            return jsonResponse(toConnectionView(conn))
          }

          if (subpath === '/refresh' && method === 'POST') {
            const caps = await serverMcp.getCapabilities(tenant)
            conn.tools = caps.tools
            conn.resources = caps.resources
            conn.prompts = caps.prompts
            return jsonResponse(toConnectionView(conn))
          }

          if (subpath === '/tools' && method === 'GET') {
            if (conn.status !== 'CONNECTED' || conn.tools.length === 0) {
              const caps = await serverMcp.getCapabilities(tenant)
              conn.tools = caps.tools
            }
            return jsonResponse(conn.tools)
          }

          if (subpath === '/resources' && method === 'GET') {
            if (conn.status !== 'CONNECTED' || conn.resources.length === 0) {
              const caps = await serverMcp.getCapabilities(tenant)
              conn.resources = caps.resources
            }
            return jsonResponse(conn.resources)
          }

          if (subpath === '/prompts' && method === 'GET') {
            if (conn.status !== 'CONNECTED' || conn.prompts.length === 0) {
              const caps = await serverMcp.getCapabilities(tenant)
              conn.prompts = caps.prompts
            }
            return jsonResponse(conn.prompts)
          }

          const toolMatch = subpath.match(/^\/tools\/([^/]+)\/call$/)
          if (toolMatch && method === 'POST') {
            const toolName = decodeURIComponent(toolMatch[1])
            const body = (await request.json().catch(() => ({}))) as { arguments?: Record<string, unknown> }
            const t0 = performance.now()
            try {
              const exec = await serverMcp.callTool(toolName, body.arguments || {}, tenant)
              const latencyMs = performance.now() - t0
              conn.history.unshift({
                id: crypto.randomUUID(),
                operation: 'call_tool',
                target: toolName,
                params: body.arguments,
                status: exec.isError ? 'error' : 'success',
                latency_ms: Math.round(latencyMs),
                result_summary: `Tool ${toolName} executed`,
                timestamp: new Date().toISOString(),
              })
              const content = Array.isArray(exec.data) ? exec.data : [{ type: 'text', text: typeof exec.data === 'string' ? exec.data : JSON.stringify(exec.data) }]
              return jsonResponse({
                tool_name: toolName,
                is_error: exec.isError,
                content,
                structured_content: exec.data,
                latency_ms: latencyMs,
                timestamp: new Date().toISOString(),
              })
            } catch (err: unknown) {
              const latencyMs = performance.now() - t0
              const errMsg = err instanceof Error ? err.message : String(err)
              conn.history.unshift({
                id: crypto.randomUUID(),
                operation: 'call_tool',
                target: toolName,
                params: body.arguments,
                status: 'error',
                latency_ms: Math.round(latencyMs),
                error: errMsg,
                timestamp: new Date().toISOString(),
              })
              return errorResponse(errMsg, 'TOOL_ERROR', 500)
            }
          }

          if (subpath === '/resources/read' && method === 'POST') {
            const body = (await request.json().catch(() => ({}))) as { uri?: string }
            if (!body.uri) return errorResponse('uri is required', 'INVALID_REQUEST', 400)
            const t0 = performance.now()
            try {
              const data = await serverMcp.readResource(body.uri, tenant)
              const latencyMs = performance.now() - t0
              conn.history.unshift({
                id: crypto.randomUUID(),
                operation: 'read_resource',
                target: body.uri,
                status: 'success',
                latency_ms: Math.round(latencyMs),
                result_summary: `Read resource ${body.uri}`,
                timestamp: new Date().toISOString(),
              })
              const textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
              return jsonResponse({
                uri: body.uri,
                contents: [{ uri: body.uri, mimeType: 'application/json', text: textContent }],
                latency_ms: latencyMs,
                timestamp: new Date().toISOString(),
              })
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err)
              return errorResponse(errMsg, 'RESOURCE_ERROR', 500)
            }
          }

          if (subpath === '/history' && method === 'GET') {
            return jsonResponse(conn.history)
          }
        }
      }
    }

    // 19. Generic MCP Tool Call (for Developer Playground)
    if (pathname === '/api/mcp/call' && method === 'POST') {
      const body = (await request.json()) as {
        name: string
        arguments?: Record<string, unknown>
      }

      if (!body.name) {
        return errorResponse('name is required', 'INVALID_REQUEST', 400)
      }

      const exec = await serverMcp.callTool(body.name, body.arguments || {}, tenant)
      return jsonResponse({ success: true, data: exec.data, raw: exec.raw })
    }

    // 20. Generic MCP Resource Read
    if (pathname === '/api/mcp/resource' && method === 'GET') {
      const uri = url.searchParams.get('uri')
      if (!uri) {
        return errorResponse('uri parameter is required', 'INVALID_REQUEST', 400)
      }
      const data = await serverMcp.readResource(uri, tenant)
      return jsonResponse({ success: true, data })
    }

    return errorResponse(`Route not found: ${method} ${pathname}`, 'NOT_FOUND', 404)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const isToolError = Boolean((err as { isToolError?: boolean })?.isToolError)
    const toolResult = (err as { toolResult?: unknown })?.toolResult

    return errorResponse(message, isToolError ? 'TOOL_ERROR' : 'INTERNAL_ERROR', 500, toolResult)
  }
}

/**
 * Health check handler verifying both BFF and upstream Render MCP endpoint.
 */
async function handleHealth(tenant?: string): Promise<Response> {
  const config = getServerConfig()
  const activeTenant = tenant || config.defaultTenant
  let upstreamLive = false
  let workerAge: number | null = null

  try {
    const readyRes = await fetch(`${config.restBaseUrl}/readyz`, {
      signal: AbortSignal.timeout(5000),
    })
    if (readyRes.ok) {
      const readyData = (await readyRes.json()) as { status: string; worker_last_seen_seconds?: number }
      upstreamLive = readyData.status === 'ready'
      workerAge = readyData.worker_last_seen_seconds ?? null
    }
  } catch {
    upstreamLive = false
  }

  return jsonResponse({
    status: upstreamLive ? 'ready' : 'degraded',
    live: upstreamLive,
    worker_last_seen_seconds: workerAge,
    bff: 'online',
    upstream: {
      live: upstreamLive,
      mcpUrl: config.mcpUrl,
      restBaseUrl: config.restBaseUrl,
      workerLastSeenSeconds: workerAge,
    },
    tenant: activeTenant,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Aggregates statistics, recent runs, and operational overview data from live backend.
 */
async function handleDashboardOverview(tenant?: string): Promise<Response> {
  const config = getServerConfig()
  const activeTenant = tenant || config.defaultTenant
  const token = await mintMcpToken({ tenant: activeTenant })

  // 1. Fetch stats and recent runs in parallel from backend for the specified tenant
  const [statsRes, runsRes, types] = await Promise.all([
    fetch(`${config.restBaseUrl}/api/v1/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null)),
    fetch(`${config.restBaseUrl}/api/v1/runs?limit=8`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) =>
      r.ok
        ? (r.json() as Promise<{ items?: Array<{ run_id?: string; [k: string]: unknown }> }>)
        : { items: [] }
    ),
    serverMcp.readResource('reconciliation://types', activeTenant).catch(() => []),
  ])

  // 2. Fetch latest audit events if there is a recent run for this tenant
  let recentAuditEvents: unknown[] = []
  const latestRun = runsRes?.items?.[0]
  if (latestRun?.run_id) {
    try {
      const auditExec = await serverMcp.callTool(
        'get_reconciliation_audit',
        {
          run_id: latestRun.run_id,
          limit: 10,
        },
        activeTenant
      )
      const auditData = auditExec.data as { items?: unknown[] }
      recentAuditEvents = auditData?.items || []
    } catch {
      // Audit fetch failure shouldn't fail whole overview
    }
  }

  return jsonResponse({
    success: true,
    data: {
      stats: statsRes,
      recentRuns: runsRes?.items || [],
      types,
      recentAuditEvents,
      tenant: activeTenant,
      generatedAt: new Date().toISOString(),
    },
  })
}

/**
 * Node.js HTTP Server Adapter (for local development Vite middleware and standard Node servers).
 */
export async function handleNodeApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const host = req.headers.host || 'localhost:5173'
  const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  const fullUrl = new URL(req.url || '/', `${protocol}://${host}`)

  // Gather body chunks if applicable
  const chunks: Uint8Array[] = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const bodyBuffer = Buffer.concat(chunks)

  // Construct standard Fetch API Request
  const webRequest = new Request(fullUrl.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ['GET', 'HEAD'].includes(req.method?.toUpperCase() || '') ? undefined : bodyBuffer,
  })

  // Execute handler
  const webResponse = await handleApiRequest(webRequest)

  // Send back to ServerResponse
  res.statusCode = webResponse.status
  webResponse.headers.forEach((val, key) => {
    res.setHeader(key, val)
  })

  const resBody = await webResponse.arrayBuffer()
  res.end(Buffer.from(resBody))
}
