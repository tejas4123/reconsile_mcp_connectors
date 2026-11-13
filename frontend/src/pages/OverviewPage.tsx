import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  FileCheck2,
  PlusCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type { RunListItem, StatsView } from '../types/index.ts'
import { MetricCard } from '../components/common/MetricCard.tsx'
import { RunStatusBadge } from '../components/common/Badge.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return 'Just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function getFriendlyType(typeKey: string): { label: string; icon: typeof Scale } {
  switch (typeKey) {
    case 'invoice_to_po':
      return { label: 'Invoice vs Purchase Order', icon: FileCheck2 }
    case 'vendor_compliance':
    case 'vendor_certificate_compliance':
      return { label: 'Vendor Compliance', icon: ShieldCheck }
    case 'contract_to_crm':
    case 'contract_terms_to_crm':
      return { label: 'Contract vs CRM', icon: ArrowRightLeft }
    case 'contract_to_erp':
      return { label: 'Contract vs ERP', icon: Scale }
    default:
      return {
        label: typeKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        icon: Scale,
      }
  }
}

export const OverviewPage: React.FC = () => {
  const { client, activeTenant, isBackendLive } = useApi()
  const [stats, setStats] = useState<StatsView | null>(null)
  const [recentRuns, setRecentRuns] = useState<RunListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      try {
        const overview = await client.getDashboardOverview()
        if (overview) {
          setStats(overview.stats)
          setRecentRuns(overview.recentRuns || [])
          setLoading(false)
          return
        }
      } catch {
        // Fallback to direct client calls
      }

      const [statsData, runsData] = await Promise.all([
        client.getStats(),
        client.listRuns({ limit: 6 }),
      ])
      setStats(statsData)
      setRecentRuns(runsData.items || [])
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || 'Failed to retrieve operational metrics from backend.',
        code: e?.code || 'UNAVAILABLE',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [client, activeTenant])

  // Extract exactly the 4 required business metrics from live backend data
  const totalRuns = stats?.runs_total ?? recentRuns.length
  const issuesDetected = stats?.open_discrepancies ?? 0
  const pendingApprovals = stats?.proposals_awaiting_approval ?? 0
  const failedRuns = stats?.runs_by_status?.['FAILED'] ?? 0

  if (loading && !stats) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <LoadingSkeleton variant="stats" />
        <LoadingSkeleton variant="table-rows" rows={5} />
      </div>
    )
  }

  if (error && !stats && recentRuns.length === 0) {
    return (
      <div className="max-w-4xl mx-auto pt-6">
        <ErrorState
          title="Could Not Connect to Reconciliation Service"
          message={error.message}
          code={error.code}
          onRetry={loadData}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* 1. Header: Greeting & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {getGreeting()}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Here's what's happening across your business reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            title="Refresh metrics"
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <Link
            to="/runs/new"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-all active:scale-[0.99]"
          >
            <PlusCircle className="h-4 w-4 text-emerald-400" />
            <span>New Reconciliation</span>
          </Link>
        </div>
      </div>

      {/* 2. Four Important Metrics - Clean, Minimal Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Reconciliations */}
        <MetricCard
          title="Total Reconciliations"
          value={totalRuns}
          subtitle="Processed across systems"
          icon={<ArrowRightLeft className="h-4 w-4 text-slate-400" />}
        />

        {/* Metric 2: Issues Detected */}
        <MetricCard
          title="Issues Detected"
          value={issuesDetected}
          subtitle={issuesDetected === 0 ? 'No active discrepancies' : 'Action recommended'}
          icon={<AlertOctagon className={`h-4 w-4 ${issuesDetected > 0 ? 'text-amber-500' : 'text-slate-400'}`} />}
          badge={
            issuesDetected > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                Action Req.
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                Clean
              </span>
            )
          }
        />

        {/* Metric 3: Pending Approvals */}
        <MetricCard
          title="Pending Approvals"
          value={pendingApprovals}
          subtitle="Awaiting human sign-off"
          icon={<Clock className="h-4 w-4 text-sky-500" />}
          badge={
            pendingApprovals > 0 ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-600/20">
                Four-Eyes Gate
              </span>
            ) : undefined
          }
        />

        {/* Metric 4: Failed Reconciliations */}
        <MetricCard
          title="Failed Reconciliations"
          value={failedRuns}
          subtitle={failedRuns === 0 ? 'All runs executed smoothly' : 'Requires review'}
          icon={<XCircle className={`h-4 w-4 ${failedRuns > 0 ? 'text-rose-500' : 'text-slate-400'}`} />}
        />
      </div>

      {/* 3. Recent Activity Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold tracking-tight text-slate-900 uppercase">
              Recent Reconciliation Activity
            </h2>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              <span>{isBackendLive ? 'Live Sync Active' : 'Offline'}</span>
            </div>
          </div>

          <Link
            to="/runs"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
          >
            <span>View all reconciliations</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentRuns.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8">
            <EmptyState
              title="No Reconciliations Yet"
              description="Start your first automated business reconciliation to cross-check records across your ERP and invoicing systems."
            >
              <Link
                to="/runs/new"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
              >
                <PlusCircle className="h-4 w-4 text-emerald-400" />
                <span>Start First Reconciliation</span>
              </Link>
            </EmptyState>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Reconciliation</th>
                    <th className="py-3 px-4">Target Record</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Issues Found</th>
                    <th className="py-3 px-4">Executed</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentRuns.map((run) => {
                    const typeInfo = getFriendlyType(run.reconciliation_type)
                    const TypeIcon = typeInfo.icon
                    const targetRef =
                      run.source_refs?.invoice ||
                      run.source_refs?.vendor ||
                      run.source_refs?.contract ||
                      'All Records'

                    return (
                      <tr
                        key={run.run_id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        {/* Reconciliation Type */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                              <TypeIcon className="h-3.5 w-3.5" />
                            </div>
                            <span className="font-semibold text-slate-900">
                              {typeInfo.label}
                            </span>
                          </div>
                        </td>

                        {/* Target Record */}
                        <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                          {targetRef}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          <RunStatusBadge status={run.status} size="sm" />
                        </td>

                        {/* Issues Found */}
                        <td className="py-3.5 px-4">
                          {run.discrepancy_count > 0 ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                              <AlertOctagon className="h-3.5 w-3.5 text-amber-500" />
                              <span>{run.discrepancy_count} Discrepanc{run.discrepancy_count > 1 ? 'ies' : 'y'}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              <span>Clean Match</span>
                            </span>
                          )}
                        </td>

                        {/* Executed Time */}
                        <td className="py-3.5 px-4 text-slate-500">
                          {formatRelativeTime(run.created_at)}
                        </td>

                        {/* Action Link */}
                        <td className="py-3.5 px-4 text-right">
                          <Link
                            to={`/runs/${run.run_id}`}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                          >
                            <span>View Results</span>
                            <ArrowRight className="h-3 w-3 text-slate-400" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom bar with prominent CTA */}
            <div className="border-t border-slate-100 bg-slate-50/50 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Connected to upstream enterprise records via Model Context Protocol (MCP).
              </span>
              <Link
                to="/runs/new"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors"
              >
                <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
                <span>Start New Reconciliation</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
