/**
 * Server-Side MCP Client Manager using the official @modelcontextprotocol/sdk.
 *
 * Manages Streamable HTTP transport, session headers, cold starts, and tool dispatching.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getServerConfig } from './config.ts'
import { mintMcpToken } from './auth.ts'

export interface McpExecutionResult<T = unknown> {
  data: T
  isError: boolean
  raw: unknown
}

class ServerMcpService {
  private client: Client | null = null
  private transport: StreamableHTTPClientTransport | null = null
  private token: string | null = null
  private tokenExpiresAt = 0
  private isConnecting = false

  /**
   * Returns a connected MCP client, refreshing tokens and sessions as needed.
   */
  public async getClient(): Promise<Client> {
    const now = Math.floor(Date.now() / 1000)

    // Check if we need to reconnect or refresh token
    if (this.client && this.transport && this.token && this.tokenExpiresAt > now + 60) {
      return this.client
    }

    // If another call is currently connecting, wait briefly
    if (this.isConnecting) {
      let attempts = 0
      while (this.isConnecting && attempts < 40) {
        await new Promise((r) => setTimeout(r, 100))
        attempts++
      }
      if (this.client) return this.client
    }

    this.isConnecting = true
    try {
      if (this.transport) {
        try {
          await this.transport.close()
        } catch {
          // ignore cleanup errors
        }
      }

      const config = getServerConfig()
      this.token = await mintMcpToken({ ttlSeconds: config.tokenTtlSeconds })
      this.tokenExpiresAt = now + config.tokenTtlSeconds

      this.transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        },
      })

      const client = new Client(
        {
          name: 'reconcile-bff-controller',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      )

      // Connect with generous timeout to handle Render cold starts
      await client.connect(this.transport)
      this.client = client
      return this.client
    } finally {
      this.isConnecting = false
    }
  }

  /**
   * Discovers all capabilities supported by the upstream MCP server.
   */
  public async getCapabilities() {
    const client = await this.getClient()
    const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
      client.listTools().catch((e) => ({ tools: [], error: e.message })),
      client.listResources().catch((e) => ({ resources: [], error: e.message })),
      client.listPrompts().catch((e) => ({ prompts: [], error: e.message })),
    ])

    return {
      serverInfo: client.getServerVersion() || { name: 'reconcile-mcp', version: '0.1.0' },
      tools: 'tools' in toolsResult ? toolsResult.tools : [],
      resources: 'resources' in resourcesResult ? resourcesResult.resources : [],
      prompts: 'prompts' in promptsResult ? promptsResult.prompts : [],
    }
  }

  /**
   * Reads an MCP resource by URI.
   */
  public async readResource<T = unknown>(uri: string): Promise<T> {
    const client = await this.getClient()
    try {
      const result = await client.readResource({ uri })
      if (!result.contents || result.contents.length === 0) {
        throw new Error(`Resource "${uri}" returned empty content`)
      }
      const item = result.contents[0]
      if ('text' in item && typeof item.text === 'string') {
        try {
          return JSON.parse(item.text) as T
        } catch {
          return item.text as unknown as T
        }
      }
      return item as unknown as T
    } catch (err: unknown) {
      // If session failed, invalidate client for next attempt
      this.invalidateClient()
      throw err
    }
  }

  /**
   * Executes an MCP tool dynamically.
   */
  public async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpExecutionResult<T>> {
    let client = await this.getClient()

    try {
      const response = await client.callTool({
        name,
        arguments: args,
      })

      let data: unknown = null
      const resContent = response.content as Array<{ type: string; text?: string }> | undefined
      if (response.structuredContent !== undefined && response.structuredContent !== null) {
        data = response.structuredContent
      } else if (resContent && Array.isArray(resContent) && resContent.length > 0) {
        const first = resContent[0]
        if (first.type === 'text' && typeof first.text === 'string') {
          try {
            data = JSON.parse(first.text)
          } catch {
            data = first.text
          }
        } else {
          data = first
        }
      }

      if (response.isError) {
        const errorMsg =
          typeof data === 'object' && data && 'message' in data
            ? String((data as { message: unknown }).message)
            : typeof data === 'string'
            ? data
            : `Tool "${name}" returned an error`
        const err = new Error(errorMsg)
        ;(err as unknown as { isToolError: boolean; toolResult: unknown }).isToolError = true
        ;(err as unknown as { toolResult: unknown }).toolResult = data
        throw err
      }

      return {
        data: data as T,
        isError: false,
        raw: response,
      }
    } catch (err: unknown) {
      // Check if connection was rejected due to stale session
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('session') || msg.includes('401') || msg.includes('Broken')) {
        this.invalidateClient()
      }
      throw err
    }
  }

  public invalidateClient() {
    this.client = null
    if (this.transport) {
      try {
        this.transport.close()
      } catch {
        // ignore
      }
      this.transport = null
    }
  }
}

export const serverMcp = new ServerMcpService()
