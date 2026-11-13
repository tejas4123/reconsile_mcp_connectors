import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  Check,
  Copy,
  Database,
  ExternalLink,
  FileCode,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Terminal,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import { useAuth } from '../lib/auth/use-auth.ts'
import { inspectJwt } from '../lib/auth/auth-client.ts'

export const SettingsPage: React.FC = () => {
  const {
    isBackendLive,
    backendUrl,
    activeTenant,
    token,
    setTenant,
    setBaseUrl,
    addToast,
    refreshHealth,
  } = useApi()
  const { loginWithToken, logout, user } = useAuth()

  const [activeTab, setActiveTab] = useState<
    'workspace' | 'connections' | 'rules' | 'approvals' | 'developer'
  >('workspace')

  const [apiUrl, setApiUrl] = useState(backendUrl)
  const [jwtToken, setJwtToken] = useState(token || '')
  const [copiedCli, setCopiedCli] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)

  const handleSaveApiUrl = (e: React.FormEvent) => {
    e.preventDefault()
    setBaseUrl(apiUrl.trim())
    refreshHealth()
    addToast('API Endpoint Updated', `Bound to ${apiUrl.trim()}`, 'success')
  }

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (jwtToken.trim()) {
      const res = await loginWithToken(jwtToken.trim(), false)
      if (res.success) {
        addToast('Token Registered', 'Authenticated with validated JWT token claims', 'success')
      } else {
        addToast('Invalid Token', res.error || 'Token validation failed', 'error')
      }
    } else {
      logout('User cleared token in settings')
      addToast('Token Cleared', 'Session cleared', 'info')
    }
  }

  const handleTestHealth = async () => {
    setTestingConnection(true)
    try {
      await refreshHealth()
      addToast(
        'Health Check Executed',
        `Backend service status: ${isBackendLive ? 'Online' : 'Offline'}`,
        isBackendLive ? 'success' : 'warning'
      )
    } finally {
      setTestingConnection(false)
    }
  }

  const mintDevTokenCommand = `uv run python -m reconcile_mcp.cli token --tenant "${activeTenant}" --scope "recon:read recon:run recon:propose recon:approve recon:apply recon:admin" --sub "user_ops_lead"`

  const copyCliCommand = () => {
    navigator.clipboard.writeText(mintDevTokenCommand)
    setCopiedCli(true)
    addToast('CLI Command Copied', 'Paste into your terminal to mint an HS256 JWT bearer token', 'info')
    setTimeout(() => setCopiedCli(false), 2000)
  }

  const inspection = token ? inspectJwt(token) : null
  const decodedClaims = inspection?.claims?.rawClaims || null

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Title */}
      <div className="pb-2 border-b border-slate-200/80">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Platform Settings & Tools
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Configure customer workspaces, connected ERP/CRM databases, reconciliation policies, and developer MCP tools.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 text-xs font-medium">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'workspace'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span>Workspace & Organization</span>
          </button>

          <button
            onClick={() => setActiveTab('connections')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'connections'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="h-4 w-4" />
            <span>Connected Systems</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'rules'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="h-4 w-4" />
            <span>Matching Rules</span>
          </button>

          <button
            onClick={() => setActiveTab('approvals')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'approvals'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Approvals & Governance</span>
          </button>

          <button
            onClick={() => setActiveTab('developer')}
            className={`flex items-center gap-2 pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'developer'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Terminal className="h-4 w-4 text-sky-600" />
            <span>Developer Console (MCP)</span>
          </button>
        </nav>
      </div>

      {/* TAB 1: WORKSPACE & ORGANIZATION */}
      {activeTab === 'workspace' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">
                Customer Workspace & Tenant Isolation
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Switch organizational boundaries. Database rows are strictly partitioned by tenant context.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Active Customer Workspace
                </label>
                <select
                  value={activeTenant}
                  onChange={(e) => setTenant(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none cursor-pointer"
                >
                  <option value="acme-india">Acme Manufacturing (India) — acme-india</option>
                  <option value="globex">Globex Trading International — globex</option>
                </select>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold">
                  Active Operator
                </span>
                <p className="font-mono text-xs font-bold text-slate-900">
                  {user?.sub || 'reconcile-bff-operator'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Status: {isBackendLive ? 'Live Verified' : 'Connecting'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CONNECTED SYSTEMS */}
      {activeTab === 'connections' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Connected Enterprise Systems</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live data sources queried dynamically during reconciliation pipelines.
                </p>
              </div>
              <Link
                to="/connections"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 self-start sm:self-auto"
              >
                <span>Manage All Connections</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">ERP / Neon Postgres</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-slate-500 text-[11px]">
                  Stores Purchase Orders, General Ledger accounts, and payment schedules.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Invoicing Service</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-slate-500 text-[11px]">
                  Supplier invoices, OCR line item records, and tax filings.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">CRM & Contracts</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <p className="text-slate-500 text-[11px]">
                  Master service agreements, deal contracts, and customer obligations.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MATCHING RULES */}
      {activeTab === 'rules' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Reconciliation Policies & Rules</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deterministic thresholds governing match criteria and automated resolutions.
                </p>
              </div>
              <Link
                to="/rules"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 self-start sm:self-auto"
              >
                <span>View Full Ruleset</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50 space-y-1">
                <span className="font-bold text-slate-900">PO Amendment Cap Policy</span>
                <p className="text-slate-600">
                  Variances up to <strong>10.0%</strong> may be amended via proposal. Variances exceeding 10% are blocked from automated correction and require executive override.
                </p>
              </div>

              <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50 space-y-1">
                <span className="font-bold text-slate-900">Amount Equality Requirement</span>
                <p className="text-slate-600">
                  Amendments must set the revised purchase order amount exactly equal to the validated supplier invoice amount.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: APPROVALS & GOVERNANCE */}
      {activeTab === 'approvals' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Four-Eyes Separation of Duties</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enterprise governance model separating automated reconciliation from financial approval.
                </p>
              </div>
              <Link
                to="/approvals"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 self-start sm:self-auto"
              >
                <span>Open Approvals Queue</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center gap-2 text-slate-900 font-bold">
                  <Terminal className="h-4 w-4 text-slate-600" />
                  <span>Automated System Operator</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Permitted to run reconciliations, detect variances, propose solutions, and apply approved resolutions. <strong>Explicitly denied approval authority.</strong>
                </p>
              </div>

              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>Senior Human Controller</span>
                </div>
                <p className="text-emerald-800 leading-relaxed">
                  Holds exclusive <code className="font-mono">recon:approve</code> scope to review proposals, verify evidence, and authorize financial writes.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: DEVELOPER & MCP CONSOLE */}
      {activeTab === 'developer' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Developer & Model Context Protocol (MCP)</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Technical control panel for engineering teams, protocol inspection, and tool execution.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/developer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors"
                >
                  <Radio className="h-3.5 w-3.5 text-sky-400" />
                  <span>Open MCP Console</span>
                </Link>
                <Link
                  to="/api-docs"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FileCode className="h-3.5 w-3.5" />
                  <span>API Docs</span>
                </Link>
              </div>
            </div>

            {/* MCP Endpoint Status */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">Upstream MCP Server</span>
                <span className="font-mono text-emerald-600 font-bold">Streamable HTTP (Active)</span>
              </div>
              <div className="font-mono text-[11px] text-slate-600 bg-white p-2.5 rounded border border-slate-200 break-all">
                https://reconcile-mcp.onrender.com/mcp
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestHealth}
                  disabled={testingConnection}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testingConnection ? 'animate-spin' : ''}`} />
                  <span>Test Connection</span>
                </button>
                <span className="text-[11px] text-slate-500">
                  Backend status: <strong>{isBackendLive ? 'Online' : 'Offline'}</strong>
                </span>
              </div>
            </div>

            {/* API URL Binding */}
            <form onSubmit={handleSaveApiUrl} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
              <span className="font-bold text-slate-900">API Host Binding</span>
              <p className="text-slate-500 text-[11px]">
                Base URL for backend REST and BFF routes:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://reconcile-mcp.onrender.com"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  Save URL
                </button>
              </div>
            </form>

            {/* Manual JWT Token Registration */}
            <form onSubmit={handleSaveToken} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
              <span className="font-bold text-slate-900">Manual Operator JWT Token</span>
              <p className="text-slate-500 text-[11px]">
                Supply a pre-minted HS256 JWT Bearer token to authenticate locally:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={jwtToken}
                  onChange={(e) => setJwtToken(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  Set Token
                </button>
              </div>
            </form>

            {/* CLI Token Minter */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
              <span className="font-bold text-slate-900">CLI Token Minting Helper</span>
              <p className="text-slate-500 text-[11px]">
                Generate HS256 tokens directly from the terminal for local testing:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-[10px] bg-slate-900 text-slate-100 p-2.5 rounded-lg truncate">
                  {mintDevTokenCommand}
                </code>
                <button
                  type="button"
                  onClick={copyCliCommand}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
                >
                  {copiedCli ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedCli ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Decoded Claims Preview */}
            {decodedClaims && (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                <span className="font-bold text-slate-900">Active Token Claims</span>
                <pre className="font-mono text-[11px] bg-white p-3 rounded-lg border border-slate-200 overflow-x-auto text-slate-800">
                  {JSON.stringify(decodedClaims, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
