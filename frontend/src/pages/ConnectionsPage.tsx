import React, { useEffect, useState } from 'react'
import {
  Database,
  FileText,
  Info,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type { ReconciliationTypeView } from '../types/index.ts'

export const ConnectionsPage: React.FC = () => {
  const { client, isBackendLive, workerAge, backendUrl, refreshHealth, addToast } = useApi()
  const [types, setTypes] = useState<ReconciliationTypeView[]>([])
  const [pinging, setPinging] = useState(false)

  const loadTypes = async () => {
    try {
      const res = await client.getReconciliationTypes()
      setTypes(res || [])
    } catch {
      // Backend may be offline
    }
  }

  useEffect(() => {
    loadTypes()
  }, [client])

  const handleTestHealth = async () => {
    setPinging(true)
    try {
      const health = await client.checkHealth()
      await refreshHealth()
      if (health.live) {
        addToast(
          'Backend Infrastructure Verified',
          `Service is ready. Worker heartbeat age: ${health.workerAge !== null && health.workerAge !== undefined ? `${health.workerAge}s` : 'active'}`,
          'success'
        )
      } else {
        addToast('Health Check Failed', health.error || 'Connection refused', 'error')
      }
    } finally {
      setPinging(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            System Connections & Adapters
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Integration architecture, verified system endpoints, and data source adapters powering reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleTestHealth}
            disabled={pinging}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pinging ? 'animate-spin' : ''}`} />
            <span>Test Service Health</span>
          </button>
        </div>
      </div>

      {/* Security Architecture Callout */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-xs flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-slate-900 text-xs">Zero-Exposure Credential Architecture</h4>
          <p className="mt-0.5 text-slate-500 leading-relaxed">
            Database credentials, private keys, and service tokens never touch the frontend or client bundles. Connectors operate exclusively via backend server-side retrying adapters with Row-Level Security (RLS) enforcement.
          </p>
        </div>
      </div>

      {/* Discovered Infrastructure Components */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PostgreSQL Database Component */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-800">
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-slate-900">PostgreSQL / Lakebase Storage</h3>
                  <span className="text-[10px] text-slate-400 font-mono">Core Relational Store</span>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isBackendLive
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${isBackendLive ? 'bg-emerald-600' : 'bg-rose-600'}`}
                />
                {isBackendLive ? 'Connected & Ready' : 'Unreachable'}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Stores reconciliation definitions, runs, discrepancies, evidence records, and append-only audit trails. Protected by tenant-isolated Row-Level Security.
            </p>

            <div className="rounded bg-slate-50 p-2.5 space-y-1 font-mono text-[11px] text-slate-600 border border-slate-100">
              <div className="flex justify-between">
                <span>Database Engine:</span>
                <span className="font-semibold text-slate-900">PostgreSQL (SQLAlchemy Async)</span>
              </div>
              <div className="flex justify-between">
                <span>Migration Baseline:</span>
                <span className="font-semibold text-slate-900">Alembic 0007_rls</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Configured via server DATABASE_URL</span>
            <span className="font-mono">Driver: asyncpg</span>
          </div>
        </div>

        {/* Worker Processing Service */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-800">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-slate-900">Background Worker Subsystem</h3>
                  <span className="text-[10px] text-slate-400 font-mono">Batch Execution Engine</span>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  workerAge !== null && workerAge !== undefined && workerAge < 60
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    workerAge !== null && workerAge !== undefined && workerAge < 60 ? 'bg-emerald-600' : 'bg-slate-400'
                  }`}
                />
                {workerAge !== null && workerAge !== undefined
                  ? `Heartbeat: ${workerAge}s ago`
                  : isBackendLive
                  ? 'Inline Mode Active'
                  : 'Offline'}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Processes queued batch reconciliation jobs asynchronously with retry backoff and progress tracking. Single-record runs execute synchronously.
            </p>

            <div className="rounded bg-slate-50 p-2.5 space-y-1 font-mono text-[11px] text-slate-600 border border-slate-100">
              <div className="flex justify-between">
                <span>Readiness Endpoint:</span>
                <span className="font-semibold text-slate-900">GET /readyz</span>
              </div>
              <div className="flex justify-between">
                <span>Concurrency Model:</span>
                <span className="font-semibold text-slate-900">Asyncio Task Queues</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Health Endpoint: {backendUrl}/readyz</span>
            <span className="font-mono">Retryable: Yes</span>
          </div>
        </div>

        {/* Document Store Component */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-800">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-slate-900">Document Store & OCR Adapter</h3>
                  <span className="text-[10px] text-slate-400 font-mono">Evidence Extraction</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700">
                Pipeline Connected
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Provides immutable PDF contracts, purchase orders, and certificates with SHA-256 content hashing and line-level citation anchors.
            </p>

            <div className="rounded bg-slate-50 p-2.5 space-y-1 font-mono text-[11px] text-slate-600 border border-slate-100">
              <div className="flex justify-between">
                <span>Storage Protocol:</span>
                <span className="font-semibold text-slate-900">doc:// URI Scheme</span>
              </div>
              <div className="flex justify-between">
                <span>Integrity Verification:</span>
                <span className="font-semibold text-slate-900">SHA-256 Digest</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Indexed in Evidence Vault</span>
            <span className="font-mono">Immutable</span>
          </div>
        </div>

        {/* Source System Adapters */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-800">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-slate-900">System Pipeline Adapters</h3>
                  <span className="text-[10px] text-slate-400 font-mono">ERP, VMS, CRM Adapters</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700">
                Configured
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Adapters read counterparty records and execute planned write mutations after four-eyes human approval.
            </p>

            <div className="rounded bg-slate-50 p-2.5 space-y-1 font-mono text-[11px] text-slate-600 border border-slate-100">
              <div className="flex justify-between">
                <span>Active Workflows:</span>
                <span className="font-semibold text-slate-900">
                  {types.length > 0 ? `${types.length} definitions` : '3 default workflows'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Execution Safety:</span>
                <span className="font-semibold text-slate-900">Optimistic Version Locking</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Requires recon:apply for writes</span>
            <span className="font-mono">Audited</span>
          </div>
        </div>
      </div>

      {/* Architectural Limitation & Governance Notice */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs text-slate-600 space-y-2">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <Info className="h-4 w-4 text-slate-500" />
          <span>Connection Management Architecture</span>
        </div>
        <p className="leading-relaxed">
          In the current backend architecture, connector definitions (<code className="font-mono text-slate-800">data_sources</code> table) are managed at the infrastructure and deployment level rather than via public HTTP REST CRUD. To connect new source systems or rotate credentials, configure the corresponding backend environment variables and restart the service.
        </p>
      </div>
    </div>
  )
}
