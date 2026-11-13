import React, { useState, useMemo, useRef } from 'react'
import {
  Radio,
  Layers,
  BookOpen,
  Terminal,
  History,
  Activity,
  AlertCircle,
  Clock,
  RefreshCw,
  Power,
  Key,
  Globe,
  ChevronDown,
  ChevronUp,
  Search,
  Copy,
  Check,
  Send,
  FileText,
  Sliders,
  ShieldAlert,
  Server,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import { apiClient } from '../lib/api/api-client.ts'
import { McpClient, McpError } from '../lib/mcp/mcp-client.ts'
import type {
  McpConnectionState,
  McpExecutionHistoryItem,
  McpInitializeResult,
  McpPrompt,
  McpPromptGetResult,
  McpResource,
  McpResourceContent,
  McpTool,
  McpToolCallResult,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../lib/mcp/mcp-types.ts'
import { DynamicSchemaForm } from '../components/mcp/DynamicSchemaForm.tsx'
import { JsonViewer } from '../components/common/JsonViewer.tsx'

export const DeveloperPage: React.FC = () => {
  const { backendUrl, addToast } = useApi()

  // Connection settings
  const [serverUrl, setServerUrl] = useState<string>('/mcp')
  const [token, setToken] = useState<string>('')
  const [showToken, setShowToken] = useState<boolean>(false)
  const [connectionState, setConnectionState] = useState<McpConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState<boolean>(false)

  // Server metadata from initialize
  const [serverInfo, setServerInfo] = useState<McpInitializeResult['serverInfo'] | null>(null)
  const [protocolVersion, setProtocolVersion] = useState<string | null>(null)
  const [instructions, setInstructions] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showInstructions, setShowInstructions] = useState<boolean>(false)

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'tools' | 'resources' | 'prompts' | 'history' | 'architecture'>('tools')

  // Discovered MCP capabilities
  const [tools, setTools] = useState<McpTool[]>([])
  const [resources, setResources] = useState<McpResource[]>([])
  const [prompts, setPrompts] = useState<McpPrompt[]>([])

  // Tools state
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null)
  const [toolSearch, setToolSearch] = useState<string>('')
  const [isExecutingTool, setIsExecutingTool] = useState<boolean>(false)
  const [lastExecutionResult, setLastExecutionResult] = useState<{
    result: McpToolCallResult
    durationMs: number
    rawRequest: JsonRpcRequest
    rawResponse: JsonRpcResponse
  } | null>(null)
  const [toolExecutionError, setToolExecutionError] = useState<string | null>(null)
  const [resultInspectTab, setResultInspectTab] = useState<'content' | 'structured' | 'wire'>('content')

  // Resources state
  const [customResourceUri, setCustomResourceUri] = useState<string>('reconciliation://types')
  const [isReadingResource, setIsReadingResource] = useState<boolean>(false)
  const [resourceContent, setResourceContent] = useState<McpResourceContent[] | null>(null)
  const [resourceError, setResourceError] = useState<string | null>(null)

  // Prompts state
  const [selectedPrompt, setSelectedPrompt] = useState<McpPrompt | null>(null)
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({})
  const [isFetchingPrompt, setIsFetchingPrompt] = useState<boolean>(false)
  const [promptResult, setPromptResult] = useState<McpPromptGetResult | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)

  // History state
  const [historyItems, setHistoryItems] = useState<McpExecutionHistoryItem[]>([])
  const [inspectHistoryItem, setInspectHistoryItem] = useState<McpExecutionHistoryItem | null>(null)
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null)

  // Singleton McpClient ref
  const clientRef = useRef<McpClient>(new McpClient({ serverUrl: '/mcp' }))
  const activeConnectionIdRef = useRef<string | null>(null)

  const mapHistoryItems = (
    items: Array<{
      id: string
      operation: string
      target: string
      params?: Record<string, unknown>
      status: string
      latency_ms: number
      result_summary?: string | null
      error?: string | null
      timestamp: string
    }>
  ): McpExecutionHistoryItem[] => {
    return items.map((h) => ({
      id: h.id,
      toolName: h.target,
      timestamp: new Date(h.timestamp),
      durationMs: Math.round(h.latency_ms),
      status: h.status === 'success' ? 'success' : 'error',
      arguments: h.params || {},
      error: h.error || undefined,
      rawRequest: {
        jsonrpc: '2.0',
        id: h.id,
        method: h.operation,
        params: h.params,
      },
      rawResponse: {
        jsonrpc: '2.0',
        id: h.id,
        result: h.result_summary,
      },
    }))
  }

  // Refresh dynamic discovery from backend
  const refreshCapabilitiesFromBackend = async (connectionId: string) => {
    try {
      const [fetchedTools, fetchedResources, fetchedPrompts, history] = await Promise.all([
        apiClient.listMcpTools(connectionId).catch(() => []),
        apiClient.listMcpResources(connectionId).catch(() => []),
        apiClient.listMcpPrompts(connectionId).catch(() => []),
        apiClient.getMcpHistory(connectionId).catch(() => []),
      ])

      const mappedTools: McpTool[] = fetchedTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema as unknown as McpTool['inputSchema']) || { type: 'object' },
      }))

      const mappedResources: McpResource[] = fetchedResources.map((r) => ({
        uri: r.uri,
        name: r.name || r.uri,
        description: r.description,
        mimeType: r.mimeType,
      }))

      const mappedPrompts: McpPrompt[] = fetchedPrompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      }))

      setTools(mappedTools)
      setResources(mappedResources)
      setPrompts(mappedPrompts)

      if (history && history.length > 0) {
        setHistoryItems(mapHistoryItems(history))
      }

      if (mappedTools.length > 0 && (!selectedTool || !mappedTools.some((t) => t.name === selectedTool.name))) {
        setSelectedTool(mappedTools[0])
      }
      if (mappedPrompts.length > 0 && !selectedPrompt) {
        setSelectedPrompt(mappedPrompts[0])
      }
      if (mappedResources.length > 0 && !customResourceUri) {
        setCustomResourceUri(mappedResources[0].uri)
      }
    } catch (err) {
      console.error('Error refreshing backend capabilities:', err)
    }
  }

  // Connect handler
  const handleConnect = async (targetUrl?: string | React.MouseEvent) => {
    const urlToUse = (typeof targetUrl === 'string' ? targetUrl : serverUrl).trim()
    if (typeof targetUrl === 'string') {
      setServerUrl(targetUrl)
    }
    setIsConnecting(true)
    setConnectionError(null)

    try {
      // 1. Primary path: Connect through real backend MCP Client Manager
      try {
        const conn = await apiClient.createMcpConnection({
          url: urlToUse,
          bearer_token: token.trim() || undefined,
          connect_now: true,
        })

        activeConnectionIdRef.current = conn.connection_id
        setConnectionState('connected')
        setServerInfo(
          (conn.server_info as McpInitializeResult['serverInfo']) || {
            name: 'reconcile-mcp',
            version: '0.1.0',
          }
        )
        setProtocolVersion(conn.protocol_version || '2025-11-25')
        setInstructions(conn.instructions || null)
        setSessionId(conn.connection_id)

        addToast(
          'MCP Connected',
          `Established real MCP session with ${conn.server_info?.name || 'reconcile-mcp'} (${conn.tools_count} tools, ${conn.resources_count} resources)`,
          'success'
        )

        await refreshCapabilitiesFromBackend(conn.connection_id)
        return
      } catch (backendErr: unknown) {
        const backendMsg = backendErr instanceof Error ? backendErr.message : String(backendErr)
        // If the backend endpoint failed with a connection error to the target MCP server, report it directly
        if (backendMsg.includes('connection to MCP server failed') || backendMsg.includes('502') || backendMsg.includes('SSRF') || backendMsg.includes('Forbidden')) {
          throw backendErr
        }
        console.warn('Backend MCP endpoint unreachable, trying client fallback:', backendErr)
      }

      // 2. Direct browser McpClient fallback
      const client = clientRef.current
      const initResult = await client.connect({
        serverUrl: urlToUse,
        token: token.trim() || undefined,
      })

      activeConnectionIdRef.current = null
      setConnectionState('connected')
      setServerInfo(initResult.serverInfo)
      setProtocolVersion(initResult.protocolVersion)
      setInstructions(initResult.instructions || null)
      setSessionId(client.getSessionId())

      addToast('MCP Connected', `Established connection with ${initResult.serverInfo.name} v${initResult.serverInfo.version}`, 'success')
      await refreshCapabilities(client)
    } catch (err: unknown) {
      setConnectionState('error')
      let message = err instanceof Error ? err.message : String(err)
      if (err instanceof McpError && err.isCorsOrNetwork) {
        message = `CORS or Network Failure: The browser could not reach ${serverUrl}. If the MCP server is hosted on another origin or requires local stdio, use an MCP Connection Gateway or configure CORS.`
      }
      setConnectionError(message)
      addToast('Connection Failed', message, 'error')
    } finally {
      setIsConnecting(false)
    }
  }

  // Disconnect handler
  const handleDisconnect = async () => {
    if (activeConnectionIdRef.current) {
      try {
        await apiClient.disconnectMcpConnection(activeConnectionIdRef.current)
      } catch (e) {
        console.warn('Error disconnecting backend session:', e)
      }
      activeConnectionIdRef.current = null
    }
    clientRef.current.disconnect()
    setConnectionState('disconnected')
    setServerInfo(null)
    setProtocolVersion(null)
    setInstructions(null)
    setSessionId(null)
    setTools([])
    setResources([])
    setPrompts([])
    setSelectedTool(null)
    setLastExecutionResult(null)
    setToolExecutionError(null)
    addToast('MCP Disconnected', 'Session closed safely', 'info')
  }

  // Refresh dynamic discovery
  const refreshCapabilities = async (clientInstance?: McpClient) => {
    if (activeConnectionIdRef.current) {
      await refreshCapabilitiesFromBackend(activeConnectionIdRef.current)
      return
    }

    const client = clientInstance || clientRef.current
    try {
      const [fetchedTools, fetchedResources, fetchedPrompts] = await Promise.all([
        client.listTools().catch((e) => {
          console.warn('Failed to list tools:', e)
          return []
        }),
        client.listResources().catch((e) => {
          console.warn('Failed to list resources:', e)
          return []
        }),
        client.listPrompts().catch((e) => {
          console.warn('Failed to list prompts:', e)
          return []
        }),
      ])

      setTools(fetchedTools)
      setResources(fetchedResources)
      setPrompts(fetchedPrompts)

      if (fetchedTools.length > 0 && (!selectedTool || !fetchedTools.some((t) => t.name === selectedTool.name))) {
        setSelectedTool(fetchedTools[0])
      }
      if (fetchedPrompts.length > 0 && !selectedPrompt) {
        setSelectedPrompt(fetchedPrompts[0])
      }
      if (fetchedResources.length > 0 && !customResourceUri) {
        setCustomResourceUri(fetchedResources[0].uri)
      }
    } catch (err) {
      console.error('Error refreshing capabilities:', err)
    }
  }

  // Execute tool handler
  const handleExecuteTool = async (args: Record<string, unknown>) => {
    if (!selectedTool) return

    setIsExecutingTool(true)
    setToolExecutionError(null)
    setLastExecutionResult(null)

    // Primary: Backend execution
    if (activeConnectionIdRef.current) {
      try {
        const res = await apiClient.callMcpTool(activeConnectionIdRef.current, selectedTool.name, args)
        const callResult: McpToolCallResult = {
          content: (res.content as unknown as McpToolCallResult['content']) || [],
          structured_content: res.structured_content as Record<string, unknown> | undefined,
          isError: res.is_error,
        }

        setLastExecutionResult({
          result: callResult,
          durationMs: Math.round(res.latency_ms),
          rawRequest: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: selectedTool.name, arguments: args } },
          rawResponse: { jsonrpc: '2.0', id: Date.now(), result: res },
        })

        const hist = await apiClient.getMcpHistory(activeConnectionIdRef.current).catch(() => [])
        if (hist.length > 0) {
          setHistoryItems(mapHistoryItems(hist))
        }

        if (res.is_error) {
          setToolExecutionError('Tool executed but reported an application error.')
          addToast('Tool Execution Warning', `Execution reported an error`, 'warning')
        } else {
          addToast('Tool Executed', `Finished in ${Math.round(res.latency_ms)}ms`, 'success')
        }
        return
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setToolExecutionError(msg)
        addToast('Tool Execution Failed', msg, 'error')
        return
      } finally {
        setIsExecutingTool(false)
      }
    }

    try {
      const response = await clientRef.current.callTool(selectedTool.name, args)
      setLastExecutionResult(response)
      setHistoryItems(clientRef.current.getHistory())

      if (response.result.isError) {
        setToolExecutionError('Tool executed but reported an application error.')
        addToast('Tool Execution Warning', `Execution reported an error`, 'warning')
      } else {
        addToast('Tool Executed', `Finished in ${response.durationMs}ms`, 'success')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setToolExecutionError(msg)
      setHistoryItems(clientRef.current.getHistory())
      addToast('Tool Execution Failed', msg, 'error')
    } finally {
      setIsExecutingTool(false)
    }
  }

  // Read resource handler
  const handleReadResource = async (uri: string) => {
    setIsReadingResource(true)
    setResourceError(null)
    setResourceContent(null)

    if (activeConnectionIdRef.current) {
      try {
        const result = await apiClient.readMcpResource(activeConnectionIdRef.current, uri)
        setResourceContent(result.contents as McpResourceContent[])
        addToast('Resource Retrieved', `Loaded ${result.contents.length} content item(s)`, 'success')

        const hist = await apiClient.getMcpHistory(activeConnectionIdRef.current).catch(() => [])
        if (hist.length > 0) {
          setHistoryItems(mapHistoryItems(hist))
        }
        return
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setResourceError(msg)
        addToast('Resource Read Failed', msg, 'error')
        return
      } finally {
        setIsReadingResource(false)
      }
    }

    try {
      const result = await clientRef.current.readResource(uri)
      setResourceContent(result.contents)
      addToast('Resource Retrieved', `Loaded ${result.contents.length} content item(s)`, 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setResourceError(msg)
      addToast('Resource Read Failed', msg, 'error')
    } finally {
      setIsReadingResource(false)
    }
  }

  // Fetch prompt handler
  const handleFetchPrompt = async () => {
    if (!selectedPrompt) return

    setIsFetchingPrompt(true)
    setPromptError(null)
    setPromptResult(null)

    if (activeConnectionIdRef.current) {
      try {
        const result = await apiClient.getMcpPrompt(activeConnectionIdRef.current, selectedPrompt.name, promptArgs)
        setPromptResult({
          description: result.description || undefined,
          messages: result.messages as McpPromptGetResult['messages'],
        })
        addToast('Prompt Retrieved', `Fetched ${result.messages.length} message template(s)`, 'success')

        const hist = await apiClient.getMcpHistory(activeConnectionIdRef.current).catch(() => [])
        if (hist.length > 0) {
          setHistoryItems(mapHistoryItems(hist))
        }
        return
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setPromptError(msg)
        addToast('Prompt Fetch Failed', msg, 'error')
        return
      } finally {
        setIsFetchingPrompt(false)
      }
    }

    try {
      const result = await clientRef.current.getPrompt(selectedPrompt.name, promptArgs)
      setPromptResult(result)
      addToast('Prompt Retrieved', `Fetched ${result.messages.length} message template(s)`, 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setPromptError(msg)
      addToast('Prompt Fetch Failed', msg, 'error')
    } finally {
      setIsFetchingPrompt(false)
    }
  }

  // Filtered tools
  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return tools
    const q = toolSearch.toLowerCase()
    return tools.filter((t) => t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q)))
  }, [tools, toolSearch])

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSnippet(label)
    addToast('Copied to Clipboard', label, 'info')
    setTimeout(() => setCopiedSnippet(null), 2000)
  }

  // Quick switch between direct backend and relative proxy
  const setQuickUrl = (url: string) => {
    setServerUrl(url)
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Connection Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Visual MCP Controller
              </h1>
              <span className="rounded bg-sky-100 text-sky-800 px-2 py-0.5 text-xs font-mono font-bold">
                Streamable HTTP / JSON-RPC 2.0
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase ${
                  connectionState === 'connected'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : connectionState === 'connecting'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : connectionState === 'error'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    connectionState === 'connected'
                      ? 'bg-emerald-500 animate-pulse'
                      : connectionState === 'connecting'
                      ? 'bg-amber-500 animate-ping'
                      : connectionState === 'error'
                      ? 'bg-rose-500'
                      : 'bg-slate-400'
                  }`}
                />
                {connectionState}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Independent visual control plane for the Reconcile MCP server. Discovers schemas, reads tenant resources, and executes protocol tools in real time.
            </p>
          </div>

          {/* Quick status details when connected */}
          {connectionState === 'connected' && serverInfo && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-slate-700">
                Server: <strong className="text-slate-900">{serverInfo.name}</strong> (v{serverInfo.version})
              </span>
              <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-slate-700">
                Protocol: <strong className="text-slate-900">{protocolVersion}</strong>
              </span>
              {sessionId && (
                <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-slate-700" title={sessionId}>
                  Session: <strong className="text-slate-900">{sessionId.slice(0, 8)}…</strong>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Server Connection Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-100">
          {/* Server URL */}
          <div className="md:col-span-5 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-700 flex items-center gap-1">
                <Globe className="h-3.5 w-3.5 text-slate-400" /> MCP Server URL
              </label>
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setQuickUrl('/mcp')}
                  className={`hover:underline ${serverUrl === '/mcp' ? 'font-bold text-emerald-700' : 'text-sky-600'}`}
                >
                  Local (/mcp)
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setQuickUrl('https://reconcile-mcp.onrender.com/mcp')}
                  className={`hover:underline ${serverUrl.includes('onrender.com') ? 'font-bold text-emerald-700' : 'text-sky-600'}`}
                >
                  Render Production
                </button>
              </div>
            </div>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={connectionState === 'connected'}
              placeholder="http://localhost:8000/mcp"
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:opacity-60"
            />
          </div>

          {/* Bearer Token */}
          <div className="md:col-span-4 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-700 flex items-center gap-1">
                <Key className="h-3.5 w-3.5 text-slate-400" /> Bearer Token
                <span className="text-[10px] text-slate-400 font-normal">(Optional for /mcp)</span>
              </label>
              {token && (
                <button
                  type="button"
                  onClick={() => setToken('')}
                  className="text-[10px] text-rose-600 hover:underline font-mono"
                >
                  Clear Token
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={connectionState === 'connected'}
                placeholder="Optional (Proxy authenticates automatically)..."
                className="w-full px-3 py-1.5 pr-14 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:opacity-60"
              />
              {token && (
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1.5 text-[10px] text-slate-400 hover:text-slate-700 font-mono"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="md:col-span-3 flex items-end gap-2">
            {connectionState === 'connected' ? (
              <>
                <button
                  type="button"
                  onClick={() => refreshCapabilities()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-semibold transition-colors"
                >
                  <Power className="h-3.5 w-3.5" />
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isConnecting || !serverUrl.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded text-xs font-bold transition-all shadow-xs"
              >
                {isConnecting ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <Activity className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Connect & Handshake</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Error Callout */}
        {connectionError && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-xs text-rose-800 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <div>
                <p className="font-bold text-sm text-rose-900">Connection Failure</p>
                <p className="text-xs font-mono leading-relaxed mt-1 text-rose-800">{connectionError}</p>
              </div>

              {serverUrl !== '/mcp' && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => handleConnect('/mcp')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-900 hover:bg-rose-950 text-white rounded text-xs font-bold transition-all shadow-xs cursor-pointer"
                  >
                    <span>Switch to Integrated Proxy (/mcp) & Connect Now</span>
                  </button>
                  <p className="text-[11px] text-rose-700 mt-1">
                    Direct browser requests to remote servers are blocked by browser CORS policies. The integrated BFF proxy at <code className="font-mono bg-rose-100 px-1 py-0.5 rounded">/mcp</code> terminates CORS and authenticates securely on the server.
                  </p>
                </div>
              )}

              <div className="pt-1 flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('architecture')}
                  className="underline text-[11px] font-medium text-rose-700 hover:text-rose-950 cursor-pointer"
                >
                  View MCP Connection Gateway Documentation & Solutions →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Server Instructions Accordion */}
        {instructions && (
          <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold transition-colors"
            >
              <span className="flex items-center gap-1.5 text-xs font-mono">
                <FileText className="h-3.5 w-3.5 text-sky-600" />
                Server Instructions (MCP Handshake Rules)
              </span>
              {showInstructions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showInstructions && (
              <pre className="p-3 bg-slate-950 text-slate-200 font-mono text-[11px] whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-48 border-t border-slate-200">
                {instructions}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 text-xs font-medium">
          <button
            onClick={() => setActiveTab('tools')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
              activeTab === 'tools'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <Radio className="h-4 w-4" />
            <span>Tools ({tools.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('resources')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
              activeTab === 'resources'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Resources ({resources.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('prompts')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
              activeTab === 'prompts'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <BookOpen className="h-4 w-4" />
            <span>Prompts ({prompts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <History className="h-4 w-4" />
            <span>Execution History ({historyItems.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
              activeTab === 'architecture'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <Server className="h-4 w-4" />
            <span>Gateway & Architecture</span>
          </button>
        </nav>
      </div>

      {/* =========================================================================
          TAB 1: TOOLS CONTROLLER & RUNNER
         ========================================================================= */}
      {activeTab === 'tools' && (
        <div className="space-y-6">
          {connectionState !== 'connected' && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-3">
              <Radio className="h-8 w-8 text-slate-400 mx-auto" />
              <h3 className="font-bold text-slate-800 text-sm">MCP Server Not Connected</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Connect to an MCP server above to dynamically discover available tools, inspect input schemas, and execute protocol calls.
              </p>
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors"
              >
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
                <span>Connect Now</span>
              </button>
            </div>
          )}

          {connectionState === 'connected' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Tool Discovery List */}
              <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3 shadow-xs space-y-3">
                <div className="flex items-center justify-between px-2 pt-1">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Discovered Tools ({tools.length})
                  </span>
                  <button
                    onClick={() => refreshCapabilities()}
                    className="text-[11px] text-sky-600 hover:underline font-mono inline-flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" /> Rescan
                  </button>
                </div>

                {/* Search Filter */}
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-slate-400" />
                  <input
                    type="text"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="Filter tools..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                {/* Tool List */}
                <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                  {filteredTools.map((tool) => {
                    const isSelected = selectedTool?.name === tool.name
                    const isReadOnly = tool.annotations?.readOnlyHint ?? false
                    const isDestructive = tool.annotations?.destructiveHint ?? false

                    return (
                      <button
                        key={tool.name}
                        onClick={() => {
                          setSelectedTool(tool)
                          setLastExecutionResult(null)
                          setToolExecutionError(null)
                        }}
                        className={`w-full text-left rounded-lg p-3 transition-colors ${
                          isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold truncate">{tool.name}</span>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.2 rounded uppercase shrink-0 ${
                              isSelected
                                ? 'bg-slate-800 text-slate-200'
                                : isDestructive
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : isReadOnly
                                ? 'bg-sky-50 text-sky-800'
                                : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {isDestructive ? 'Destructive' : isReadOnly ? 'Read' : 'Mutate'}
                          </span>
                        </div>
                        <p
                          className={`mt-1 text-[11px] line-clamp-2 leading-relaxed ${
                            isSelected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {tool.description || 'No description provided'}
                        </p>
                      </button>
                    )
                  })}
                  {filteredTools.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-400 font-mono">
                      No tools matching "{toolSearch}"
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Tool Controller & Runner */}
              <div className="lg:col-span-8 space-y-5">
                {selectedTool ? (
                  <>
                    {/* Tool Header & Annotations */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                      <div className="flex items-start justify-between pb-3 border-b border-slate-100">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="font-mono text-base font-bold text-slate-900">
                              {selectedTool.name}
                            </h2>
                            {selectedTool.title && (
                              <span className="text-xs text-slate-500">({selectedTool.title})</span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                            {selectedTool.description}
                          </p>
                        </div>
                      </div>

                      {/* Annotations */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100 font-mono text-[11px]">
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase">Read Only</span>
                          <span className="font-semibold text-slate-900">
                            {selectedTool.annotations?.readOnlyHint ? 'True' : 'False'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase">Idempotent</span>
                          <span className="font-semibold text-slate-900">
                            {selectedTool.annotations?.idempotentHint ? 'True' : 'False'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase">Destructive</span>
                          <span className="font-semibold text-slate-900">
                            {selectedTool.annotations?.destructiveHint ? 'True' : 'False'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase">Open World</span>
                          <span className="font-semibold text-slate-900">
                            {selectedTool.annotations?.openWorldHint ? 'True' : 'False'}
                          </span>
                        </div>
                      </div>

                      {/* Dynamic Input Form */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                            <Sliders className="h-3.5 w-3.5 text-slate-700" />
                            Input Parameters & Schema Form
                          </h3>
                        </div>
                        <DynamicSchemaForm
                          tool={selectedTool}
                          onSubmit={handleExecuteTool}
                          isExecuting={isExecutingTool}
                        />
                      </div>
                    </div>

                    {/* Execution Result Box */}
                    {(lastExecutionResult || toolExecutionError) && (
                      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                              MCP Execution Response
                            </h3>
                            {lastExecutionResult && (
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                                  lastExecutionResult.result.isError
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {lastExecutionResult.result.isError ? 'Error Output' : 'Success'}
                              </span>
                            )}
                          </div>

                          {lastExecutionResult && (
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded">
                              <Clock className="h-3 w-3 text-amber-500" />
                              <span>{lastExecutionResult.durationMs}ms</span>
                            </span>
                          )}
                        </div>

                        {/* Error Message */}
                        {toolExecutionError && (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 font-mono">
                            {toolExecutionError}
                          </div>
                        )}

                        {/* Result View Tabs */}
                        {lastExecutionResult && (
                          <div className="space-y-3">
                            <div className="flex items-center space-x-4 border-b border-slate-200 text-xs font-mono">
                              <button
                                onClick={() => setResultInspectTab('content')}
                                className={`pb-2 border-b-2 font-semibold ${
                                  resultInspectTab === 'content'
                                    ? 'border-slate-900 text-slate-900'
                                    : 'border-transparent text-slate-500 hover:text-slate-700'
                                }`}
                              >
                                Text Content ({lastExecutionResult.result.content.length})
                              </button>
                              {lastExecutionResult.result.structured_content && (
                                <button
                                  onClick={() => setResultInspectTab('structured')}
                                  className={`pb-2 border-b-2 font-semibold ${
                                    resultInspectTab === 'structured'
                                      ? 'border-slate-900 text-slate-900'
                                      : 'border-transparent text-slate-500 hover:text-slate-700'
                                  }`}
                                >
                                  Structured Content
                                </button>
                              )}
                              <button
                                onClick={() => setResultInspectTab('wire')}
                                className={`pb-2 border-b-2 font-semibold ${
                                  resultInspectTab === 'wire'
                                    ? 'border-slate-900 text-slate-900'
                                    : 'border-transparent text-slate-500 hover:text-slate-700'
                                }`}
                              >
                                Wire Payloads (JSON-RPC)
                              </button>
                            </div>

                            {/* View 1: Text Content */}
                            {resultInspectTab === 'content' && (
                              <div className="space-y-2">
                                {lastExecutionResult.result.content.map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="p-3 bg-slate-950 text-slate-100 rounded-lg font-mono text-xs whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-96"
                                  >
                                    {item.text || JSON.stringify(item, null, 2)}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* View 2: Structured Content */}
                            {resultInspectTab === 'structured' && lastExecutionResult.result.structured_content && (
                              <JsonViewer
                                data={lastExecutionResult.result.structured_content}
                                title={`${selectedTool.name}.structured_content.json`}
                              />
                            )}

                            {/* View 3: Wire Payload */}
                            {resultInspectTab === 'wire' && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <JsonViewer
                                  data={lastExecutionResult.rawRequest}
                                  title="JSON-RPC Request Wire Frame"
                                />
                                <JsonViewer
                                  data={lastExecutionResult.rawResponse}
                                  title="JSON-RPC Response Wire Frame"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-xs">
                    Select a tool from the left to inspect its schema and execute calls.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 2: RESOURCES VIEWER
         ========================================================================= */}
      {activeTab === 'resources' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div>
              <h2 className="font-bold text-slate-900 text-sm">Tenant-Scoped Resource Reader</h2>
              <p className="mt-1 text-xs text-slate-500">
                Resources provide direct read-only access to reconciliation types, configuration rules, and run data via <code className="font-mono text-slate-800">reconciliation://...</code> URIs.
              </p>
            </div>

            {/* URI Input Bar */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={customResourceUri}
                  onChange={(e) => setCustomResourceUri(e.target.value)}
                  placeholder="reconciliation://types"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={() => handleReadResource(customResourceUri)}
                disabled={isReadingResource || !customResourceUri.trim() || connectionState !== 'connected'}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-lg text-xs font-bold transition-colors"
              >
                {isReadingResource ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Reading URI...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Read Resource</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick URI presets */}
            <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
              <span className="text-slate-400">Quick URIs:</span>
              <button
                onClick={() => {
                  setCustomResourceUri('reconciliation://types')
                  handleReadResource('reconciliation://types')
                }}
                className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
              >
                reconciliation://types
              </button>
              <button
                onClick={() => {
                  setCustomResourceUri('reconciliation://rules/invoice_to_po')
                  handleReadResource('reconciliation://rules/invoice_to_po')
                }}
                className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
              >
                reconciliation://rules/invoice_to_po
              </button>
              <button
                onClick={() => {
                  setCustomResourceUri('reconciliation://rules/vendor_certificate_compliance')
                  handleReadResource('reconciliation://rules/vendor_certificate_compliance')
                }}
                className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
              >
                reconciliation://rules/vendor_certificate_compliance
              </button>
            </div>

            {/* Error Message */}
            {resourceError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 font-mono">
                {resourceError}
              </div>
            )}

            {/* Resource Output Display */}
            {resourceContent && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                  <span className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                    Resource Contents ({resourceContent.length} segment{resourceContent.length === 1 ? '' : 's'})
                  </span>
                </div>
                {resourceContent.map((item, index) => {
                  let parsedJson: unknown = null
                  if (item.text) {
                    try {
                      parsedJson = JSON.parse(item.text)
                    } catch {
                      // plain text
                    }
                  }

                  return (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono text-slate-500 bg-slate-50 p-2 rounded border border-slate-100">
                        <span>URI: <strong className="text-slate-800">{item.uri}</strong></span>
                        {item.mimeType && (
                          <span className="bg-slate-200/80 px-1.5 py-0.5 rounded text-[10px]">
                            {item.mimeType}
                          </span>
                        )}
                      </div>

                      {parsedJson ? (
                        <JsonViewer data={parsedJson} title={item.uri} />
                      ) : (
                        <pre className="p-4 bg-slate-950 text-slate-100 rounded-lg font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96">
                          {item.text || item.blob || 'No textual content'}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Discovered Server Resources Catalog */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
              Discovered Server Resources ({resources.length})
            </h3>
            <div className="divide-y divide-slate-100 text-xs">
              {resources.map((res) => (
                <div key={res.uri} className="py-3 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900">{res.uri}</span>
                      <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-mono">
                        {res.mimeType || 'application/json'}
                      </span>
                    </div>
                    {res.title && <p className="font-medium text-slate-700">{res.title}</p>}
                    {res.description && <p className="text-slate-500 text-[11px]">{res.description}</p>}
                  </div>
                  <button
                    onClick={() => {
                      setCustomResourceUri(res.uri)
                      handleReadResource(res.uri)
                    }}
                    className="shrink-0 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium transition-colors"
                  >
                    Read
                  </button>
                </div>
              ))}
              {resources.length === 0 && (
                <p className="py-4 text-slate-400 font-mono text-xs">No resources discovered yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: PROMPTS CONTROLLER
         ========================================================================= */}
      {activeTab === 'prompts' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Prompt List */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3 shadow-xs space-y-2">
              <div className="px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Discovered Workflow Prompts ({prompts.length})
              </div>
              <div className="space-y-1">
                {prompts.map((p) => {
                  const isSelected = selectedPrompt?.name === p.name
                  return (
                    <button
                      key={p.name}
                      onClick={() => {
                        setSelectedPrompt(p)
                        setPromptResult(null)
                        setPromptError(null)
                        const initial: Record<string, string> = {}
                        if (p.arguments) {
                          for (const arg of p.arguments) {
                            initial[arg.name] = ''
                          }
                        }
                        setPromptArgs(initial)
                      }}
                      className={`w-full text-left rounded-lg p-3 transition-colors ${
                        isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="font-mono text-xs font-bold">{p.name}</div>
                      {p.title && <div className="text-[11px] font-medium mt-0.5 opacity-90">{p.title}</div>}
                      <p className={`text-[11px] mt-1 line-clamp-2 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {p.description}
                      </p>
                    </button>
                  )
                })}
                {prompts.length === 0 && (
                  <p className="p-4 text-slate-400 text-xs font-mono">No prompts discovered.</p>
                )}
              </div>
            </div>

            {/* Prompt Runner & Messages */}
            <div className="lg:col-span-8 space-y-5">
              {selectedPrompt ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                  <div className="pb-3 border-b border-slate-100">
                    <h2 className="font-mono text-base font-bold text-slate-900">{selectedPrompt.name}</h2>
                    {selectedPrompt.description && (
                      <p className="mt-1 text-xs text-slate-600">{selectedPrompt.description}</p>
                    )}
                  </div>

                  {/* Arguments Form */}
                  {selectedPrompt.arguments && selectedPrompt.arguments.length > 0 ? (
                    <div className="space-y-3">
                      <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wider block">
                        Prompt Arguments
                      </span>
                      {selectedPrompt.arguments.map((arg) => (
                        <div key={arg.name} className="space-y-1">
                          <label className="font-mono text-xs font-bold text-slate-800 flex items-center justify-between">
                            <span>{arg.name}</span>
                            {arg.required && <span className="text-[10px] text-rose-500">required</span>}
                          </label>
                          {arg.description && (
                            <p className="text-[11px] text-slate-500">{arg.description}</p>
                          )}
                          <input
                            type="text"
                            value={promptArgs[arg.name] || ''}
                            onChange={(e) =>
                              setPromptArgs((prev) => ({ ...prev, [arg.name]: e.target.value }))
                            }
                            placeholder={`Enter ${arg.name}...`}
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 font-mono">This prompt takes no arguments.</p>
                  )}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleFetchPrompt}
                      disabled={isFetchingPrompt || connectionState !== 'connected'}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-lg text-xs font-bold transition-colors"
                    >
                      {isFetchingPrompt ? (
                        <>
                          <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Fetching Prompt...</span>
                        </>
                      ) : (
                        <>
                          <BookOpen className="h-3.5 w-3.5 text-amber-400" />
                          <span>Retrieve Prompt ({selectedPrompt.name})</span>
                        </>
                      )}
                    </button>
                  </div>

                  {promptError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 font-mono">
                      {promptError}
                    </div>
                  )}

                  {promptResult && (
                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                        Prompt Messages & Instructions ({promptResult.messages.length})
                      </h4>
                      <div className="space-y-3">
                        {promptResult.messages.map((msg, index) => (
                          <div
                            key={index}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs"
                          >
                            <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase font-bold bg-slate-200 text-slate-800">
                              Role: {msg.role}
                            </span>
                            <pre className="p-3 bg-slate-950 text-slate-100 rounded font-mono text-[11px] whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-72">
                              {msg.content.text}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-xs font-mono">
                  Select a workflow prompt to view and retrieve instructions.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: EXECUTION HISTORY & AUDIT LOG
         ========================================================================= */}
      {activeTab === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="font-bold text-slate-900 text-sm">Session Execution History</h2>
              <p className="text-xs text-slate-500">
                Chronological log of MCP protocol calls made during this session with wall-clock timing and payloads.
              </p>
            </div>
            {historyItems.length > 0 && (
              <button
                onClick={() => {
                  clientRef.current.clearHistory()
                  setHistoryItems([])
                  addToast('History Cleared', 'All execution records reset', 'info')
                }}
                className="text-xs text-rose-600 hover:underline font-mono"
              >
                Clear History
              </button>
            )}
          </div>

          {historyItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Timestamp</th>
                    <th className="px-3 py-2">Tool Name</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Arguments</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {historyItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-900">{item.toolName}</td>
                      <td className="px-3 py-2 text-amber-700">{item.durationMs}ms</td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                            item.status === 'success'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 max-w-xs truncate" title={JSON.stringify(item.arguments)}>
                        {JSON.stringify(item.arguments)}
                      </td>
                      <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => setInspectHistoryItem(item)}
                          className="text-sky-600 hover:underline"
                        >
                          Inspect Payloads
                        </button>
                        <button
                          onClick={() => {
                            const foundTool = tools.find((t) => t.name === item.toolName)
                            if (foundTool) {
                              setSelectedTool(foundTool)
                              setActiveTab('tools')
                            }
                          }}
                          className="text-slate-700 hover:underline"
                        >
                          Re-run
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 font-mono text-xs">
              No executions logged yet in this session. Execute tools to view live profiling.
            </div>
          )}

          {/* Inspection Drawer / Modal for History Item */}
          {inspectHistoryItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
              <div className="w-full max-w-3xl bg-white rounded-xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm font-mono">
                      Payload Capture: {inspectHistoryItem.toolName}
                    </h3>
                    <span className="font-mono text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                      {inspectHistoryItem.durationMs}ms
                    </span>
                  </div>
                  <button
                    onClick={() => setInspectHistoryItem(null)}
                    className="text-slate-400 hover:text-slate-700 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  <JsonViewer data={inspectHistoryItem.rawRequest} title="Sent JSON-RPC Request" />
                  {inspectHistoryItem.rawResponse ? (
                    <JsonViewer data={inspectHistoryItem.rawResponse} title="Received JSON-RPC Response" />
                  ) : inspectHistoryItem.error ? (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 font-mono">
                      Error: {inspectHistoryItem.error}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 5: GATEWAY & ARCHITECTURE GUIDE
         ========================================================================= */}
      {activeTab === 'architecture' && (
        <div className="space-y-6 text-xs text-slate-700">
          {/* Architecture Overview */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Server className="h-5 w-5 text-sky-600" />
              Independent MCP Controller Architecture
            </h2>
            <p className="leading-relaxed text-slate-600">
              The <strong>Reconcile MCP Visual Controller</strong> operates as an independent, decoupled frontend application.
              It communicates with the Python MCP Server via the standard Model Context Protocol (Streamable HTTP / JSON-RPC 2.0).
            </p>

            <div className="rounded-lg bg-slate-950 p-4 font-mono text-emerald-400 text-[11px] leading-relaxed overflow-x-auto">
{`+-------------------------------------------------------------+
|         Independent Visual MCP Controller (Browser)         |
|  - Dynamic Schema Forms        - JSON-RPC 2.0 Client        |
|  - Live Protocol Profiling     - Session & Token Handling   |
+------------------------------+------------------------------+
                               |
                               | Streamable HTTP POST / SSE
                               | Authorization: Bearer <JWT>
                               | Accept: application/json, text/event-stream
                               v
+-------------------------------------------------------------+
|               Reconcile MCP Server (Python)                 |
|  - Route: /mcp (FastAPI / Starlette)                        |
|  - Handshake: initialize & notifications/initialized        |
|  - Tools: tools/list & tools/call                           |
|  - Resources: resources/list & resources/read               |
|  - Prompts: prompts/list & prompts/get                      |
+-------------------------------------------------------------+`}
            </div>
          </div>

          {/* Browser Direct Access vs Connection Gateway */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Direct Browser Access & Connection Gateway Guidelines
            </h3>
            <p className="leading-relaxed text-slate-600">
              Standard web browsers enforce the <strong>Same-Origin Policy</strong> and Cross-Origin Resource Sharing (CORS).
              When deploying across different environments, note the following connectivity patterns:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-900 text-xs block">
                  1. Local Development (Direct or Dev-Proxy)
                </span>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  In local development, the MCP server allows requests from <code className="font-mono text-slate-800">http://localhost:*</code>.
                  You can connect directly to <code className="font-mono text-slate-800">http://localhost:8000/mcp</code> or use Vite's built-in proxy at <code className="font-mono text-slate-800">/mcp</code>.
                </p>
              </div>

              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-900 text-xs block">
                  2. Remote Production & Stdio Bridge (Gateway)
                </span>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  For servers without CORS or behind private networks, deploy an <strong>MCP Connection Gateway</strong> (e.g. an edge reverse-proxy or Node.js bridge) to terminate CORS and forward JSON-RPC frames to the Python server.
                </p>
              </div>
            </div>
          </div>

          {/* Client Setup Snippets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Streamable HTTP Config */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-sky-500" />
                  <h3 className="font-bold text-slate-900">Claude Desktop / Cursor Config</h3>
                </div>
                <button
                  onClick={() =>
                    copyToClipboard(
                      JSON.stringify(
                        {
                          mcpServers: {
                            'reconcile-mcp': {
                              url: `${backendUrl}/mcp`,
                              headers: {
                                Authorization: 'Bearer <RECONCILE_BEARER_TOKEN>',
                              },
                            },
                          },
                        },
                        null,
                        2
                      ),
                      'Desktop Config'
                    )
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900"
                >
                  {copiedSnippet === 'Desktop Config' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  <span>Copy</span>
                </button>
              </div>
              <pre className="rounded-lg bg-slate-950 p-3 text-slate-100 font-mono text-[11px] overflow-x-auto">
{JSON.stringify(
  {
    mcpServers: {
      'reconcile-mcp': {
        url: `${backendUrl}/mcp`,
        headers: {
          Authorization: 'Bearer <RECONCILE_BEARER_TOKEN>',
        },
      },
    },
  },
  null,
  2
)}
              </pre>
            </div>

            {/* Stdio Local CLI Config */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-slate-700" />
                  <h3 className="font-bold text-slate-900">Python Stdio Process Config</h3>
                </div>
                <button
                  onClick={() =>
                    copyToClipboard(
                      JSON.stringify(
                        {
                          mcpServers: {
                            'reconcile-mcp': {
                              command: 'uv',
                              args: ['run', 'python', '-m', 'reconcile_mcp.cli', 'serve-stdio'],
                              env: {
                                RECONCILE_ENV: 'dev',
                                RECONCILE_JWT_SECRET: 'dev-secret-change-in-prod',
                                DATABASE_URL: 'postgresql+asyncpg://reconcile:password@localhost:5432/reconcile_db',
                              },
                            },
                          },
                        },
                        null,
                        2
                      ),
                      'Stdio Config'
                    )
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900"
                >
                  {copiedSnippet === 'Stdio Config' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  <span>Copy</span>
                </button>
              </div>
              <pre className="rounded-lg bg-slate-950 p-3 text-slate-100 font-mono text-[11px] overflow-x-auto">
{JSON.stringify(
  {
    mcpServers: {
      'reconcile-mcp': {
        command: 'uv',
        args: ['run', 'python', '-m', 'reconcile_mcp.cli', 'serve-stdio'],
        env: {
          RECONCILE_ENV: 'dev',
          RECONCILE_JWT_SECRET: 'dev-secret-change-in-prod',
          DATABASE_URL: 'postgresql+asyncpg://reconcile:password@localhost:5432/reconcile_db',
        },
      },
    },
  },
  null,
  2
)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
