/**
 * Model Context Protocol (MCP) TypeScript definitions according to MCP specification (2026-07-28 / 2024-11-05).
 */

export type McpTransportType = 'streamable-http' | 'sse'

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpConnectionConfig {
  serverUrl: string
  token?: string
  transport?: McpTransportType
  timeoutMs?: number
}

// JSON-RPC 2.0 Base Protocol
export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: T
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0'
  method: string
  params?: T
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// MCP Initialize
export interface McpClientInfo {
  name: string
  version: string
}

export interface McpServerInfo {
  name: string
  version: string
}

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
  logging?: Record<string, unknown>
}

export interface McpInitializeResult {
  protocolVersion: string
  capabilities: McpServerCapabilities
  serverInfo: McpServerInfo
  instructions?: string
}

// MCP Tools
export interface McpToolInputSchema {
  type: string
  properties?: Record<
    string,
    {
      type?: string
      description?: string
      default?: unknown
      enum?: unknown[]
      items?: Record<string, unknown>
      properties?: Record<string, unknown>
      required?: string[]
    }
  >
  required?: string[]
  description?: string
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema: McpToolInputSchema
  annotations?: McpToolAnnotations
}

export interface McpToolContentItem {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
}

export interface McpToolCallResult {
  content: McpToolContentItem[]
  structured_content?: Record<string, unknown>
  isError?: boolean
}

// MCP Resources
export interface McpResource {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export interface McpResourceReadResult {
  contents: McpResourceContent[]
}

// MCP Prompts
export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgument[]
}

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: {
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }
}

export interface McpPromptGetResult {
  description?: string
  messages: McpPromptMessage[]
}

// Tool Execution History Record
export interface McpExecutionHistoryItem {
  id: string
  toolName: string
  timestamp: Date
  durationMs: number
  status: 'success' | 'error'
  arguments: Record<string, unknown>
  result?: McpToolCallResult
  error?: string
  rawRequest: JsonRpcRequest
  rawResponse?: JsonRpcResponse
}

