/**
 * Reconcile MCP Client Implementation
 *
 * Provides a standards-compliant Streamable HTTP / JSON-RPC 2.0 client for
 * communicating with the Python Reconcile MCP server or any compliant MCP host.
 *
 * Implements:
 * - Dynamic initialize handshake and notifications
 * - Session tracking via `mcp-session-id` header
 * - Dynamic discovery: tools/list, resources/list, prompts/list
 * - Dynamic execution: tools/call, resources/read, prompts/get
 * - Execution duration profiling and wire payload capture
 * - Resilient response parsing (application/json and text/event-stream)
 * - Enterprise error diagnostics and CORS limitation detection
 */

import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  McpConnectionConfig,
  McpConnectionState,
  McpExecutionHistoryItem,
  McpInitializeResult,
  McpPrompt,
  McpPromptGetResult,
  McpResource,
  McpResourceReadResult,
  McpServerInfo,
  McpTool,
  McpToolCallResult,
} from './mcp-types.ts'

export class McpError extends Error {
  public readonly code: number
  public readonly data?: unknown
  public readonly isCorsOrNetwork?: boolean

  constructor(message: string, code: number = -32000, data?: unknown, isCorsOrNetwork = false) {
    super(message)
    this.name = 'McpError'
    this.code = code
    this.data = data
    this.isCorsOrNetwork = isCorsOrNetwork
  }
}

export class McpClient {
  private config: McpConnectionConfig
  private state: McpConnectionState = 'disconnected'
  private sessionId: string | null = null
  private serverInfo: McpServerInfo | null = null
  private protocolVersion: string | null = null
  private instructions: string | null = null
  private capabilities: McpInitializeResult['capabilities'] | null = null
  private nextRequestId = 1
  private executionHistory: McpExecutionHistoryItem[] = []

  constructor(config: Partial<McpConnectionConfig> = {}) {
    this.config = {
      serverUrl: config.serverUrl || 'http://localhost:8000/mcp',
      token: config.token,
      transport: config.transport || 'streamable-http',
      timeoutMs: config.timeoutMs || 30000,
    }
  }

  public getConfig(): McpConnectionConfig {
    return { ...this.config }
  }

  public updateConfig(config: Partial<McpConnectionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  public getState(): McpConnectionState {
    return this.state
  }

  public getSessionId(): string | null {
    return this.sessionId
  }

  public getServerInfo(): McpServerInfo | null {
    return this.serverInfo
  }

  public getProtocolVersion(): string | null {
    return this.protocolVersion
  }

  public getInstructions(): string | null {
    return this.instructions
  }

  public getCapabilities(): McpInitializeResult['capabilities'] | null {
    return this.capabilities
  }

  public getHistory(): McpExecutionHistoryItem[] {
    return [...this.executionHistory]
  }

  public clearHistory(): void {
    this.executionHistory = []
  }

  /**
   * Performs the MCP connection handshake (`initialize` followed by `notifications/initialized`).
   */
  public async connect(overrideConfig?: Partial<McpConnectionConfig>): Promise<McpInitializeResult> {
    if (overrideConfig) {
      this.updateConfig(overrideConfig)
    }

    this.state = 'connecting'

    try {
      const initRequest: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this.generateId(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: {
            name: 'reconcile-mcp-controller',
            version: '1.0.0',
          },
          capabilities: {
            roots: { listChanged: true },
            sampling: {},
          },
        },
      }

      const response = await this.sendJsonRpc<McpInitializeResult>(initRequest)

      if (!response.result) {
        throw new McpError('Initialize failed: server did not return result object', -32603)
      }

      const initResult = response.result
      this.protocolVersion = initResult.protocolVersion
      this.serverInfo = initResult.serverInfo
      this.instructions = initResult.instructions || null
      this.capabilities = initResult.capabilities

      // Follow up with initialized notification as per MCP protocol
      await this.sendNotification({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      })

      this.state = 'connected'
      return initResult
    } catch (err) {
      this.state = 'error'
      if (err instanceof McpError) {
        throw err
      }
      throw new McpError(err instanceof Error ? err.message : String(err), -32000)
    }
  }

  /**
   * Safely disconnects the client and clears session state.
   */
  public disconnect(): void {
    this.state = 'disconnected'
    this.sessionId = null
    this.serverInfo = null
    this.protocolVersion = null
    this.instructions = null
    this.capabilities = null
  }

  /**
   * Dynamically lists available tools from the server via `tools/list`.
   */
  public async listTools(): Promise<McpTool[]> {
    this.assertConnected()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'tools/list',
      params: {},
    }

    const response = await this.sendJsonRpc<{ tools: McpTool[] }>(request)
    return response.result?.tools || []
  }

  /**
   * Executes a tool via `tools/call`, recording execution duration and history.
   */
  public async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{
    result: McpToolCallResult
    durationMs: number
    rawRequest: JsonRpcRequest
    rawResponse: JsonRpcResponse
  }> {
    this.assertConnected()

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }

    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let rawResponse: JsonRpcResponse<McpToolCallResult> | undefined
    let callError: string | undefined

    try {
      rawResponse = await this.sendJsonRpc<McpToolCallResult>(request)
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const durationMs = Math.round((endTime - startTime) * 10) / 10

      const result = rawResponse.result || {
        content: [{ type: 'text', text: 'No content returned by tool' }],
      }

      const historyItem: McpExecutionHistoryItem = {
        id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolName: name,
        timestamp: new Date(),
        durationMs,
        status: result.isError ? 'error' : 'success',
        arguments: args,
        result,
        rawRequest: request,
        rawResponse,
      }
      this.executionHistory.unshift(historyItem)

      return {
        result,
        durationMs,
        rawRequest: request,
        rawResponse,
      }
    } catch (err) {
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const durationMs = Math.round((endTime - startTime) * 10) / 10
      callError = err instanceof Error ? err.message : String(err)

      const historyItem: McpExecutionHistoryItem = {
        id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolName: name,
        timestamp: new Date(),
        durationMs,
        status: 'error',
        arguments: args,
        error: callError,
        rawRequest: request,
        rawResponse,
      }
      this.executionHistory.unshift(historyItem)

      throw err
    }
  }

  /**
   * Dynamically lists resources via `resources/list`.
   */
  public async listResources(): Promise<McpResource[]> {
    this.assertConnected()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'resources/list',
      params: {},
    }

    const response = await this.sendJsonRpc<{ resources: McpResource[] }>(request)
    return response.result?.resources || []
  }

  /**
   * Reads a resource by URI via `resources/read`.
   */
  public async readResource(uri: string): Promise<McpResourceReadResult> {
    this.assertConnected()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'resources/read',
      params: { uri },
    }

    const response = await this.sendJsonRpc<McpResourceReadResult>(request)
    return response.result || { contents: [] }
  }

  /**
   * Dynamically lists prompts via `prompts/list`.
   */
  public async listPrompts(): Promise<McpPrompt[]> {
    this.assertConnected()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'prompts/list',
      params: {},
    }

    const response = await this.sendJsonRpc<{ prompts: McpPrompt[] }>(request)
    return response.result?.prompts || []
  }

  /**
   * Retrieves prompt template and messages via `prompts/get`.
   */
  public async getPrompt(name: string, args: Record<string, string> = {}): Promise<McpPromptGetResult> {
    this.assertConnected()
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.generateId(),
      method: 'prompts/get',
      params: {
        name,
        arguments: args,
      },
    }

    const response = await this.sendJsonRpc<McpPromptGetResult>(request)
    return response.result || { messages: [] }
  }

  // ==========================================
  // Internal Protocol & Transport Handlers
  // ==========================================

  private assertConnected(): void {
    if (this.state !== 'connected') {
      throw new McpError('MCP client is not connected. Call connect() first.', -32000)
    }
  }

  private generateId(): number {
    return this.nextRequestId++
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token.trim()}`
    }

    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId
    }

    return headers
  }

  /**
   * Transmits a JSON-RPC 2.0 Request over Streamable HTTP and parses response.
   */
  public async sendJsonRpc<T = unknown>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs || 30000)

    try {
      const response = await fetch(this.config.serverUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      // Capture mcp-session-id header if supplied by server
      const returnedSessionId = response.headers.get('mcp-session-id')
      if (returnedSessionId) {
        this.sessionId = returnedSessionId
      }

      if (!response.ok) {
        const errorText = await response.text()
        let parsedErrorJson: { error?: { message?: string; code?: number; data?: unknown } } | null = null
        try {
          parsedErrorJson = JSON.parse(errorText)
        } catch {
          // not JSON
        }

        if (response.status === 401) {
          throw new McpError(
            `Authentication failed (401 Unauthorized): Bearer token is missing or expired. ${errorText}`,
            401
          )
        }
        if (response.status === 403) {
          throw new McpError(
            `Access denied (403 Forbidden): Token lacks required reconciliation scopes. ${errorText}`,
            403
          )
        }

        const msg = parsedErrorJson?.error?.message || `HTTP ${response.status} ${response.statusText}: ${errorText}`
        const code = parsedErrorJson?.error?.code || response.status
        throw new McpError(msg, code, parsedErrorJson?.error?.data)
      }

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('text/event-stream')) {
        const text = await response.text()
        return this.parseSseJsonRpcResponse<T>(text, request.id)
      }

      const data = (await response.json()) as JsonRpcResponse<T>

      if (data.error) {
        throw new McpError(data.error.message, data.error.code, data.error.data)
      }

      return data
    } catch (err: unknown) {
      if (err instanceof McpError) {
        throw err
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throw new McpError(`Request timed out after ${this.config.timeoutMs}ms`, -32000)
      }

      // Check for browser CORS / Network Failure
      const isNetworkOrCors =
        err instanceof TypeError &&
        (err.message.includes('fetch') || err.message.includes('Network') || err.message.includes('Failed to fetch'))

      if (isNetworkOrCors) {
        throw new McpError(
          `Unable to connect to MCP server at "${this.config.serverUrl}". ` +
            `This is typically caused by CORS restrictions, firewall blocking, or the server being offline. ` +
            `For remote MCP servers, deploy an MCP Connection Gateway or route via proxy.`,
          -32000,
          undefined,
          true
        )
      }

      throw new McpError(err instanceof Error ? err.message : String(err), -32000)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Transmits a JSON-RPC 2.0 Notification (fire-and-forget).
   */
  public async sendNotification(notification: JsonRpcNotification): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      await fetch(this.config.serverUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(notification),
        signal: controller.signal,
      })
    } catch (err) {
      // Notification errors are non-blocking as per JSON-RPC spec
      console.warn('MCP Notification error:', err)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Parses an SSE stream payload containing JSON-RPC 2.0 messages.
   */
  private parseSseJsonRpcResponse<T>(sseText: string, requestId: string | number): JsonRpcResponse<T> {
    const lines = sseText.split('\n')
    let foundData = ''

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const payload = line.replace(/^data:\s*/, '').trim()
        if (payload) {
          foundData = payload
          try {
            const parsed = JSON.parse(payload) as JsonRpcResponse<T>
            if (parsed.id === requestId || (parsed.result !== undefined || parsed.error !== undefined)) {
              if (parsed.error) {
                throw new McpError(parsed.error.message, parsed.error.code, parsed.error.data)
              }
              return parsed
            }
          } catch (e) {
            if (e instanceof McpError) throw e
            // Keep looking through lines
          }
        }
      }
    }

    if (foundData) {
      try {
        const parsed = JSON.parse(foundData) as JsonRpcResponse<T>
        if (parsed.error) {
          throw new McpError(parsed.error.message, parsed.error.code, parsed.error.data)
        }
        return parsed
      } catch (e) {
        if (e instanceof McpError) throw e
      }
    }

    throw new McpError('Received SSE stream without valid JSON-RPC 2.0 response data', -32700)
  }
}

