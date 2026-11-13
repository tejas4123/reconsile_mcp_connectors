import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  ChevronRight,
  Filter,
  PlusCircle,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type { ReconciliationTypeView, RunListItem, RunStatus } from '../types/index.ts'
import { RunStatusBadge } from '../components/common/Badge.tsx'
import { Drawer } from '../components/common/Drawer.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

function getFriendlyTypeTitle(key: string): string {
  switch (key) {
    case 'invoice_to_po':
      return 'Invoice vs Purchase Order'
    case 'vendor_compliance':
    case 'vendor_certificate_compliance':
      return 'Vendor Compliance'
    case 'contract_to_crm':
    case 'contract_terms_to_crm':
      return 'Contract vs CRM'
    case 'contract_to_erp':
      return 'Contract vs ERP'
    default:
      return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

export const RunsPage: React.FC = () => {
  const { client, activeTenant } = useApi()
  const navigate = useNavigate()
  const [runs, setRuns] = useState<RunListItem[]>([])
  const [types, setTypes] = useState<ReconciliationTypeView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRun, setSelectedRun] = useState<RunListItem | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchRuns = async (cursor?: string) => {
    setLoading(true)
    setError(null)
    try {
      const [runsRes, typesRes] = await Promise.all([
        client.listRuns({
          status: statusFilter === 'ALL' ? undefined : (statusFilter as RunStatus),
          type: typeFilter === 'ALL' ? undefined : typeFilter,
          limit: 50,
          cursor,
        }),
        client.getReconciliationTypes().catch(() => []),
      ])
      setRuns(runsRes.items || [])
      setNextCursor(runsRes.next_cursor || null)
      if (typesRes.length > 0) {
        setTypes(typesRes)
      }
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || 'Failed to query reconciliation runs from backend.',
        code: e?.code || 'UNAVAILABLE',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRuns()
  }, [client, activeTenant, statusFilter, typeFilter])

  const filteredRuns = runs.filter((run) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const target =
      run.source_refs?.invoice ||
      run.source_refs?.vendor ||
      run.source_refs?.contract ||
      ''
    return (
      run.run_id.toLowerCase().includes(q) ||
      run.reconciliation_type.toLowerCase().includes(q) ||
      target.toLowerCase().includes(q) ||
      run.requested_by.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Reconciliations
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Audit history of all completed, active, and queued business reconciliations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchRuns()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <Link
            to="/runs/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors"
          >
            <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
            <span>New Reconciliation</span>
          </Link>
        </div>
      </div>

      {/* Error state if API call failed */}
      {error && !loading && (
        <ErrorState
          title="Could Not Load Reconciliations"
          message={error.message}
          code={error.code}
          onRetry={() => fetchRuns()}
        />
      )}

      {/* Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Box */}
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoice, vendor, record..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <span>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Matched (Clean)</option>
              <option value="COMPLETED_WITH_DISCREPANCIES">Discrepancies Flagged</option>
              <option value="RUNNING">Running</option>
              <option value="PENDING">Queued</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span>Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 focus:outline-none"
            >
              <option value="ALL">All Types</option>
              {types.length > 0 ? (
                types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.title}
                  </option>
                ))
              ) : (
                <>
                  <option value="invoice_to_po">Invoice vs Purchase Order</option>
                  <option value="vendor_compliance">Vendor Compliance</option>
                  <option value="contract_to_crm">Contract vs CRM</option>
                  <option value="contract_to_erp">Contract vs ERP</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-mono">
          Showing <strong>{filteredRuns.length}</strong> items
        </div>
      </div>

      {/* Runs Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-6">
            <LoadingSkeleton variant="table-rows" rows={5} />
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No Reconciliations Found"
              description="No runs matched your selected filters or search terms."
            >
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setStatusFilter('ALL')
                  setTypeFilter('ALL')
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Clear Filters
              </button>
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reconciliation Type</th>
                  <th className="px-4 py-3">Target Reference</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Issues</th>
                  <th className="px-4 py-3">Executed</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRuns.map((run) => {
                  const targetRef =
                    run.source_refs?.invoice ||
                    run.source_refs?.vendor ||
                    run.source_refs?.contract ||
                    (run.selection ? 'Batch Run' : '—')

                  return (
                    <tr
                      key={run.run_id}
                      onClick={() => navigate(`/runs/${run.run_id}`)}
                      className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-4 py-3.5">
                        <span className="font-bold text-slate-900">
                          {getFriendlyTypeTitle(run.reconciliation_type)}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 font-mono font-medium text-slate-700">
                        {targetRef}
                      </td>

                      <td className="px-4 py-3.5">
                        <RunStatusBadge status={run.status} size="sm" />
                      </td>

                      <td className="px-4 py-3.5 text-center">
                        {run.discrepancy_count > 0 ? (
                          <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full ring-1 ring-inset ring-amber-600/20">
                            {run.discrepancy_count}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">0</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-slate-500 text-[11px]">
                        {new Date(run.created_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <Link
                          to={`/runs/${run.run_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          <span>Results</span>
                          <ArrowRight className="h-3 w-3 text-slate-400" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {nextCursor && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <span>Showing current page</span>
            <button
              onClick={() => fetchRuns(nextCursor)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <span>Load Next Page</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Drawer */}
      <Drawer
        isOpen={Boolean(selectedRun)}
        onClose={() => setSelectedRun(null)}
        title={selectedRun ? getFriendlyTypeTitle(selectedRun.reconciliation_type) : ''}
      >
        {selectedRun && (
          <div className="space-y-4 text-xs">
            <div>
              <span className="text-slate-400 block font-medium">Run ID:</span>
              <span className="font-mono font-bold text-slate-800">{selectedRun.run_id}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Status:</span>
              <RunStatusBadge status={selectedRun.status} />
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Issues Detected:</span>
              <span className="font-bold text-amber-700">{selectedRun.discrepancy_count}</span>
            </div>
            <div className="pt-2">
              <Link
                to={`/runs/${selectedRun.run_id}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 font-bold text-white shadow-2xs hover:bg-slate-800"
              >
                <span>View Full Results</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
