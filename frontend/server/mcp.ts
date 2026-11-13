/**
 * Server-Side MCP Client Manager using the official @modelcontextprotocol/sdk.
 *
 * Manages Streamable HTTP transport, tenant-isolated sessions, session headers,
 * cold starts, and tool dispatching.
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

interface TenantSession {
  client: Client
  transport: StreamableHTTPClientTransport
  token: string
  tokenExpiresAt: number
  isConnecting: boolean
}

class ServerMcpService {
  private sessions = new Map<string, TenantSession>()

  /**
   * Returns a connected MCP client for the specified tenant, refreshing tokens and sessions as needed.
   */
  public async getClient(tenant?: string): Promise<Client> {
    const config = getServerConfig()
    const activeTenant = tenant || config.defaultTenant
    const now = Math.floor(Date.now() / 1000)

    let session = this.sessions.get(activeTenant)

    // Check if we already have an active, valid session for this tenant
    if (session && session.client && session.transport && session.token && session.tokenExpiresAt > now + 60) {
      return session.client
    }

    // If another call is currently connecting for this tenant, wait briefly
    if (session?.isConnecting) {
      let attempts = 0
      while (session?.isConnecting && attempts < 40) {
        await new Promise((r) => setTimeout(r, 100))
        attempts++
        session = this.sessions.get(activeTenant)
      }
      if (session?.client) return session.client
    }

    // Initialize or mark connecting
    if (!session) {
      session = {
        client: null as unknown as Client,
        transport: null as unknown as StreamableHTTPClientTransport,
        token: '',
        tokenExpiresAt: 0,
        isConnecting: true,
      }
      this.sessions.set(activeTenant, session)
    } else {
      session.isConnecting = true
    }

    try {
      if (session.transport) {
        try {
          await session.transport.close()
        } catch {
          // ignore cleanup errors
        }
      }

      const token = await mintMcpToken({
        tenant: activeTenant,
        ttlSeconds: config.tokenTtlSeconds,
      })
      const tokenExpiresAt = now + config.tokenTtlSeconds

      const transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      })

      const client = new Client(
        {
          name: `reconcile-bff-controller-${activeTenant}`,
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      )

      // Connect with generous timeout to handle Render cold starts
      await client.connect(transport)

      session.client = client
      session.transport = transport
      session.token = token
      session.tokenExpiresAt = tokenExpiresAt
      return client
    } finally {
      if (session) {
        session.isConnecting = false
      }
    }
  }

  /**
   * Discovers all capabilities supported by the upstream MCP server.
   */
  public async getCapabilities(tenant?: string) {
    const client = await this.getClient(tenant)
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
   * Reads an MCP resource by URI for the specified tenant.
   */
  public async readResource<T = unknown>(uri: string, tenant?: string): Promise<T> {
    const client = await this.getClient(tenant)
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
      // Invalidate tenant session for retry on next attempt
      this.invalidateClient(tenant)
      throw err
    }
  }

  /**
   * Executes an MCP tool dynamically for the specified tenant.
   */
  public async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    tenant?: string
  ): Promise<McpExecutionResult<T>> {
    const client = await this.getClient(tenant)

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
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('session') || msg.includes('401') || msg.includes('Broken')) {
        this.invalidateClient(tenant)
      }
      throw err
    }
  }

  public invalidateClient(tenant?: string) {
    if (tenant) {
      const session = this.sessions.get(tenant)
      if (session) {
        if (session.transport) {
          try {
            session.transport.close()
          } catch {
            // ignore
          }
        }
        this.sessions.delete(tenant)
      }
    } else {
      for (const [, session] of this.sessions) {
        if (session.transport) {
          try {
            session.transport.close()
          } catch {
            // ignore
          }
        }
      }
      this.sessions.clear()
    }
  }
}

export const serverMcp = new ServerMcpService()
