import { describe, it } from 'node:test'
import assert from 'node:assert'
import { McpClient, McpError } from '../mcp-client.ts'
import type { JsonRpcResponse, McpInitializeResult, McpToolCallResult } from '../mcp-types.ts'

describe('McpClient - Protocol and Communication Tests', () => {
  it('connect() performs initialization handshake and sends notifications/initialized', async () => {
    const calls: { url: string; headers: Headers; body: any }[] = []

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const headers = new Headers(init?.headers as Record<string, string>)
      calls.push({ url, headers, body })

      if (body.method === 'initialize') {
        const result: McpInitializeResult = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'reconcile-mcp', version: '0.1.0' },
          instructions: 'Enterprise reconciliation platform instructions',
        }
        const resp: JsonRpcResponse<McpInitializeResult> = {
          jsonrpc: '2.0',
          id: body.id,
          result,
        }
        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'mcp-session-id': 'session-xyz-123',
          },
        })
      }

      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }

      return new Response(JSON.stringify({ error: { code: -32601, message: 'Not found' } }), { status: 404 })
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as any

    try {
      const client = new McpClient({
        serverUrl: 'http://localhost:8000/mcp',
        token: 'test-token-value',
      })

      assert.strictEqual(client.getState(), 'disconnected')
      const result = await client.connect()

      assert.strictEqual(client.getState(), 'connected')
      assert.strictEqual(result.serverInfo.name, 'reconcile-mcp')
      assert.strictEqual(client.getSessionId(), 'session-xyz-123')
      assert.strictEqual(client.getProtocolVersion(), '2024-11-05')
      assert.strictEqual(client.getInstructions(), 'Enterprise reconciliation platform instructions')

      // Verify handshake requests
      assert.strictEqual(calls.length, 2)
      assert.strictEqual(calls[0].body.method, 'initialize')
      assert.strictEqual(calls[0].headers.get('Authorization'), 'Bearer test-token-value')
      assert.strictEqual(calls[1].body.method, 'notifications/initialized')
      assert.strictEqual(calls[1].headers.get('mcp-session-id'), 'session-xyz-123')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('listTools() calls tools/list over active connection', async () => {
    const mockFetch = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              serverInfo: { name: 'test', version: '1.0' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'tools/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [
                {
                  name: 'start_reconciliation',
                  description: 'Start a reconciliation run.',
                  inputSchema: { type: 'object', properties: { reconciliation_type: { type: 'string' } } },
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(null, { status: 400 })
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as any

    try {
      const client = new McpClient()
      await client.connect()
      const tools = await client.listTools()

      assert.strictEqual(tools.length, 1)
      assert.strictEqual(tools[0].name, 'start_reconciliation')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('callTool() profiles execution duration, logs history and captures payloads', async () => {
    const mockFetch = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test', version: '1.0' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'tools/call') {
        const toolResult: McpToolCallResult = {
          content: [{ type: 'text', text: 'Run initiated with status PENDING' }],
          structured_content: { run_id: 'run-9988', status: 'PENDING' },
          isError: false,
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: toolResult,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(null, { status: 400 })
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as any

    try {
      const client = new McpClient()
      await client.connect()

      const response = await client.callTool('start_reconciliation', {
        reconciliation_type: 'invoice_to_po',
        idempotency_key: 'test-key-12345',
      })

      assert.strictEqual(response.result.isError, false)
      assert.strictEqual(response.result.structured_content?.run_id, 'run-9988')
      assert(typeof response.durationMs === 'number')
      assert(response.durationMs >= 0)

      const history = client.getHistory()
      assert.strictEqual(history.length, 1)
      assert.strictEqual(history[0].toolName, 'start_reconciliation')
      assert.strictEqual(history[0].status, 'success')
      assert.strictEqual(history[0].rawRequest.method, 'tools/call')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('readResource() and listPrompts() communicate with endpoints', async () => {
    const mockFetch = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test', version: '1.0' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 204 })

      if (body.method === 'resources/read') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              contents: [{ uri: 'reconciliation://types', text: '[{"key":"invoice_to_po"}]' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (body.method === 'prompts/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              prompts: [{ name: 'reconcile_financial_records', description: 'Reconcile invoice vs PO' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(null, { status: 400 })
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as any

    try {
      const client = new McpClient()
      await client.connect()

      const res = await client.readResource('reconciliation://types')
      assert.strictEqual(res.contents.length, 1)
      assert.strictEqual(res.contents[0].uri, 'reconciliation://types')

      const prompts = await client.listPrompts()
      assert.strictEqual(prompts.length, 1)
      assert.strictEqual(prompts[0].name, 'reconcile_financial_records')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('handles SSE stream responses correctly', async () => {
    const mockFetch = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        const sseBody = `event: message\ndata: {"jsonrpc":"2.0","id":${body.id},"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"stream-server","version":"2.0"}}}\n\n`
        return new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 204 })
      return new Response(null, { status: 400 })
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mockFetch as any

    try {
      const client = new McpClient()
      const init = await client.connect()
      assert.strictEqual(init.serverInfo.name, 'stream-server')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('detects and classifies 401 Unauthorized and network/CORS errors', async () => {
    const mockAuthFail = async (): Promise<Response> => {
      return new Response('Invalid bearer token', { status: 401 })
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = mockAuthFail as any

    try {
      const client = new McpClient()
      await assert.rejects(async () => client.connect(), (err: unknown) => {
        assert(err instanceof McpError)
        assert.strictEqual(err.code, 401)
        assert(err.message.includes('401 Unauthorized'))
        return true
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    const mockCorsFail = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch')
    }

    globalThis.fetch = mockCorsFail as any

    try {
      const client = new McpClient()
      await assert.rejects(async () => client.connect(), (err: unknown) => {
        assert(err instanceof McpError)
        assert.strictEqual(err.isCorsOrNetwork, true)
        assert(err.message.includes('CORS'))
        return true
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
