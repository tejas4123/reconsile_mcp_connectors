import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type { Difference, DiscrepancyStatus, DiscrepancySummary, RunListItem, Severity } from '../types/index.ts'
import {
  DiscrepancyStatusBadge,
  SeverityBadge,
} from '../components/common/Badge.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

function formatDifference(diff: Difference): string {
  if (diff.numeric_difference !== undefined && diff.numeric_difference !== null) {
    const num = Number(diff.numeric_difference)
    const sign = num > 0 ? '+' : ''
    return `${sign}${diff.numeric_difference}${diff.percentage_difference ? ` (${diff.percentage_difference}%)` : ''}`
  }
  if (diff.diff !== undefined && diff.diff !== null) {
    const num = Number(diff.diff)
    const sign = num > 0 ? '+' : ''
    return `${sign}${diff.diff}`
  }
  return diff.detail || diff.kind || 'Variance'
}

function getIssueTitle(d: DiscrepancySummary): string {
  if (d.field === 'amount' || d.field === 'total_amount') {
    return `Amount Variance (${formatDifference(d.difference)})`
  }
  if (d.field) {
    return `${d.field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Mismatch`
  }
  return 'Policy Variance Detected'
}

function getRecommendedNextStep(d: DiscrepancySummary): string {
  if (d.status === 'RESOLVED') return 'Resolved (Applied to ERP)'
  if (d.status === 'AWAITING_APPROVAL') return 'Pending Controller Authorization'
  if (d.status === 'PROPOSED') return 'Review Proposed PO Amendment'
  return 'Review & Propose Amendment'
}

export const ExceptionsPage: React.FC = () => {
  const { client, activeTenant } = useApi()
  const [searchParams, setSearchParams] = useSearchParams()

  const [runs, setRuns] = useState<RunListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>(searchParams.get('runId') || '')
  const [discrepancies, setDiscrepancies] = useState<DiscrepancySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  const [severityFilter, setSeverityFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  // 1. Load runs
  useEffect(() => {
    async function loadRuns() {
      try {
        const res = await client.listRuns({ limit: 25 })
        const runItems = res.items || []
        setRuns(runItems)

        if (!selectedRunId && runItems.length > 0) {
          const withDisc = runItems.find((r) => r.discrepancy_count > 0)
          const targetId = withDisc ? withDisc.run_id : runItems[0].run_id
          setSelectedRunId(targetId)
          setSearchParams({ runId: targetId })
        }
      } catch (err: unknown) {
        const e = err as { message?: string; code?: string }
        setError({
          message: e?.message || 'Failed to query runs for exceptions view.',
          code: e?.code || 'UNAVAILABLE',
        })
      }
    }
    loadRuns()
  }, [client, activeTenant])

  // 2. Load discrepancies for selectedRunId
  const loadDiscrepancies = async () => {
    if (!selectedRunId) {
      setDiscrepancies([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const severities =
        severityFilter !== 'ALL' ? ([severityFilter as Severity]) : undefined
      const statuses =
        statusFilter !== 'ALL' ? ([statusFilter as DiscrepancyStatus]) : undefined

      const res = await client.listRunDiscrepancies(selectedRunId, {
        severities,
        statuses,
        limit: 100,
      })
      setDiscrepancies(res.items || [])
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || `Failed to fetch discrepancies for run ${selectedRunId}`,
        code: e?.code || 'FETCH_FAILED',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiscrepancies()
  }, [selectedRunId, severityFilter, statusFilter])

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId)
    setSearchParams({ runId })
  }

  const filtered = discrepancies.filter((d) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      d.entity_ref.toLowerCase().includes(q) ||
      d.field.toLowerCase().includes(q) ||
      d.reason.toLowerCase().includes(q) ||
      d.discrepancy_type.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Business Exceptions
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Items requiring review, amendment, or operational controller sign-off.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadDiscrepancies}
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

      {/* Filter and Run Selector Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        {/* Run Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 shrink-0">
            Reconciliation Run:
          </span>
          <div className="relative flex-1 sm:w-72">
            <select
              value={selectedRunId}
              onChange={(e) => handleRunChange(e.target.value)}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs font-mono font-medium text-slate-900 hover:bg-slate-100 focus:border-slate-400 focus:outline-none"
            >
              {runs.length === 0 ? (
                <option value="">No reconciliation runs found</option>
              ) : (
                runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.source_refs?.invoice || r.source_refs?.vendor || r.source_refs?.contract || r.run_id.substring(0, 14)} ({r.reconciliation_type} • {r.discrepancy_count} issues)
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Severity & Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="PROPOSED">Proposed</option>
            <option value="AWAITING_APPROVAL">Awaiting Approval</option>
            <option value="RESOLVED">Resolved</option>
          </select>

          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search exceptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none w-36 sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* Exception Cards / List */}
      {loading ? (
        <LoadingSkeleton variant="table-rows" rows={4} />
      ) : error ? (
        <ErrorState
          title="Could Not Load Exceptions"
          message={error.message}
          code={error.code}
          onRetry={loadDiscrepancies}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8">
          <EmptyState
            icon={<ShieldAlert className="h-6 w-6 text-slate-400" />}
            title="No Exceptions Found"
            description="All records in the selected reconciliation run match required policy criteria, or no exceptions match your filters."
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Issue Title</th>
                <th className="py-3 px-4">Affected Record</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Current Status</th>
                <th className="py-3 px-4">Recommended Next Step</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((d) => (
                <tr key={d.discrepancy_id} className="hover:bg-slate-50/80 transition-colors">
                  {/* Issue Title */}
                  <td className="py-3.5 px-4">
                    <span className="font-bold text-slate-900">
                      {getIssueTitle(d)}
                    </span>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                      Field: {d.field}
                    </p>
                  </td>

                  {/* Affected Record */}
                  <td className="py-3.5 px-4 font-mono font-semibold text-slate-700">
                    {d.entity_ref}
                  </td>

                  {/* Severity */}
                  <td className="py-3.5 px-4">
                    <SeverityBadge severity={d.severity} size="sm" />
                  </td>

                  {/* Reason */}
                  <td className="py-3.5 px-4 max-w-xs text-slate-600 truncate">
                    {d.reason || 'Variance exceeds configured policy threshold.'}
                  </td>

                  {/* Current Status */}
                  <td className="py-3.5 px-4">
                    <DiscrepancyStatusBadge status={d.status} />
                  </td>

                  {/* Recommended Next Step */}
                  <td className="py-3.5 px-4 font-medium text-slate-800">
                    {getRecommendedNextStep(d)}
                  </td>

                  {/* Action Link */}
                  <td className="py-3.5 px-4 text-right">
                    <Link
                      to={`/exceptions/${d.discrepancy_id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors"
                    >
                      <span>Review</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
