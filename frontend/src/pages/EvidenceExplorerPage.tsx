import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  Copy,
  FileSearch,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import type { RunEvidenceItem, RunListItem } from '../types/index.ts'
import { SeverityBadge } from '../components/common/Badge.tsx'
import { useApi } from '../api/context.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

export const EvidenceExplorerPage: React.FC = () => {
  const { client, addToast, activeTenant } = useApi()
  const [searchParams, setSearchParams] = useSearchParams()

  const [runs, setRuns] = useState<RunListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>(searchParams.get('runId') || '')
  const [evidenceList, setEvidenceList] = useState<RunEvidenceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  const [sideFilter, setSideFilter] = useState<'ALL' | 'a' | 'b'>('ALL')
  const [documentsOnly, setDocumentsOnly] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  // Step 1: Load runs to populate run selector
  useEffect(() => {
    async function loadRuns() {
      try {
        const res = await client.listRuns({ limit: 25 })
        const runItems = res.items || []
        setRuns(runItems)

        if (!selectedRunId && runItems.length > 0) {
          setSelectedRunId(runItems[0].run_id)
          setSearchParams({ runId: runItems[0].run_id })
        }
      } catch (err: unknown) {
        console.warn('Failed to load runs for evidence explorer', err)
      }
    }
    loadRuns()
  }, [client, activeTenant])

  // Step 2: Load evidence for selected run
  const loadEvidence = async () => {
    if (!selectedRunId) {
      setEvidenceList([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await client.listRunEvidence(selectedRunId, {
        side: sideFilter === 'ALL' ? undefined : sideFilter,
        documentsOnly,
        limit: 100,
      })
      setEvidenceList(res.items || [])
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || `Failed to fetch evidence records for run ${selectedRunId}`,
        code: e?.code || 'FETCH_FAILED',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvidence()
  }, [selectedRunId, sideFilter, documentsOnly])

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId)
    setSearchParams({ runId })
  }

  const filtered = evidenceList.filter((item) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      item.record_id.toLowerCase().includes(q) ||
      item.source_system.toLowerCase().includes(q) ||
      item.field_path.toLowerCase().includes(q) ||
      item.content_hash.toLowerCase().includes(q) ||
      (item.excerpt && item.excerpt.toLowerCase().includes(q))
    )
  })

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash)
    setCopiedHash(hash)
    addToast('Content Hash Copied', hash, 'info')
    setTimeout(() => setCopiedHash(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Evidence Vault & Citations
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Immutable, cryptographically-hashed observations and document line-anchors backing reconciliation decisions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadEvidence}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-mono font-medium text-slate-700">
            SHA-256 Tamper-Evident
          </span>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <ErrorState
          title="Could Not Load Evidence Records"
          message={error.message}
          code={error.code}
          onRetry={loadEvidence}
        />
      )}

      {/* Filter Toolbar */}
      <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Run Selector */}
          <div className="flex items-center gap-1 text-xs text-slate-700 font-medium">
            <span>Run:</span>
            <select
              value={selectedRunId}
              onChange={(e) => handleRunChange(e.target.value)}
              className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-mono text-slate-900 focus:outline-none"
            >
              {runs.length === 0 ? (
                <option value="">No runs available</option>
              ) : (
                runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.reconciliation_type} ({r.run_id.substring(0, 8)}...)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search record, system, excerpt..."
              className="w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>

          {/* Side Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span>Side:</span>
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value as any)}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800 focus:outline-none font-mono"
            >
              <option value="ALL">All Sides</option>
              <option value="a">Source A (Primary)</option>
              <option value="b">Source B (Secondary)</option>
            </select>
          </div>

          {/* Documents Only Toggle */}
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={documentsOnly}
              onChange={(e) => setDocumentsOnly(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-0"
            />
            <span>OCR Documents Only</span>
          </label>
        </div>

        <div className="text-xs text-slate-500 font-mono">
          Showing <strong>{filtered.length}</strong> evidence records
        </div>
      </div>

      {/* Evidence Cards Grid */}
      {loading ? (
        <LoadingSkeleton variant="table-rows" rows={6} />
      ) : filtered.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={<FileSearch className="h-6 w-6 text-slate-400" />}
            title="No Evidence Records Found"
            description={
              runs.length === 0
                ? 'No reconciliation runs exist yet. Start a reconciliation run to collect evidence citations.'
                : `No evidence items matched the filter criteria for run ${selectedRunId.substring(0, 8)}...`
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item, idx) => (
            <div
              key={`${item.record_id}-${item.field_path}-${idx}`}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-slate-300 transition-colors space-y-4"
            >
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase ${
                      item.side === 'a'
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    Side {item.side.toUpperCase()}
                  </span>
                  <span className="font-mono font-bold text-slate-900 text-xs">
                    {item.source_system} : {item.record_id}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs text-slate-600 font-mono">{item.field_path}</span>
                </div>

                <div className="flex items-center gap-2">
                  {item.severity && <SeverityBadge severity={item.severity} size="sm" />}
                  <span className="text-[11px] text-slate-400 font-mono">
                    Observed: {new Date(item.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* Observed Value & Document Reference */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Observed Extracted Value
                  </span>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono font-bold text-slate-900 text-sm">
                    {String(item.observed_value)}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Document Line Anchor & Provenance
                  </span>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-700 flex items-center justify-between">
                    <span className="truncate">
                      {item.document_ref || `${item.data_source} (Database Entity ${item.record_version})`}
                    </span>
                    {item.document_ref && <FileText className="h-4 w-4 text-slate-400 shrink-0 ml-2" />}
                  </div>
                </div>
              </div>

              {/* Excerpt if document text */}
              {item.excerpt && (
                <div className="rounded-md bg-amber-50/60 border border-amber-200/70 p-3 text-xs">
                  <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block mb-1">
                    Exact Document Line Excerpt
                  </span>
                  <p className="font-mono text-slate-800 text-[11px] bg-white p-2 rounded border border-amber-100">
                    "{item.excerpt}"
                  </p>
                </div>
              )}

              {/* Tamper-evident SHA-256 Hash footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-500 font-mono">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span>SHA-256:</span>
                  <span className="font-semibold text-slate-700">{item.content_hash}</span>
                  <button
                    onClick={() => copyHash(item.content_hash)}
                    className="ml-1 text-slate-400 hover:text-slate-700"
                    title="Copy Full Hash"
                  >
                    {copiedHash === item.content_hash ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>

                <div className="text-slate-400 font-mono text-[10px]">
                  DataSource: {item.data_source} · Type: {item.entity_type}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
