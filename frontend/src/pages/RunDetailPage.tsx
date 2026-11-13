import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Scale,
  ShieldAlert,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type {
  AuditEventView,
  DiscrepancySummary,
  RunEvidenceItem,
  RunStatusResult,
} from '../types/index.ts'
import {
  DiscrepancyStatusBadge,
  RunStatusBadge,
  SeverityBadge,
} from '../components/common/Badge.tsx'
import { EvidenceViewer } from '../components/common/EvidenceViewer.tsx'
import { JsonViewer } from '../components/common/JsonViewer.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'

function formatDifference(diff: any): string {
  if (!diff) return '—'
  if (diff.signed !== undefined && diff.signed !== null) {
    const sign = Number(diff.signed) > 0 ? '+' : ''
    const curr = diff.currency ? ` ${diff.currency}` : ''
    const pct = diff.percent ? ` (${diff.percent}%)` : ''
    return `${sign}${diff.signed}${curr}${pct}`
  }
  if (diff.absolute !== undefined && diff.absolute !== null) {
    const curr = diff.currency ? ` ${diff.currency}` : ''
    const pct = diff.percent ? ` (${diff.percent}%)` : ''
    return `${diff.absolute}${curr}${pct}`
  }
  if (diff.days !== undefined && diff.days !== null) {
    return `${diff.days} day(s)`
  }
  if (diff.numeric_difference !== undefined && diff.numeric_difference !== null) {
    const num = Number(diff.numeric_difference)
    const sign = num > 0 ? '+' : ''
    return `${sign}${diff.numeric_difference}${diff.percentage_difference ? ` (${diff.percentage_difference}%)` : ''}`
  }
  return diff.detail || diff.kind || 'Variance'
}

function getFriendlyTypeName(typeKey: string): string {
  switch (typeKey) {
    case 'invoice_to_po':
      return 'Invoice vs Purchase Order'
    case 'vendor_compliance':
      return 'Vendor Compliance'
    case 'contract_to_crm':
      return 'Contract vs CRM'
    case 'contract_to_erp':
      return 'Contract vs ERP'
    default:
      return typeKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

export const RunDetailPage: React.FC = () => {
  const { runId } = useParams<{ runId: string }>()
  const { client } = useApi()
  const navigate = useNavigate()

  const [run, setRun] = useState<RunStatusResult | null>(null)
  const [discrepancies, setDiscrepancies] = useState<DiscrepancySummary[]>([])
  const [evidence, setEvidence] = useState<RunEvidenceItem[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  // Advanced technical details accordion
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)
  const [activeTechnicalTab, setActiveTechnicalTab] = useState<'evidence' | 'audit' | 'raw'>('evidence')

  const loadRunData = async () => {
    if (!runId) return
    setLoading(true)
    setError(null)
    try {
      const [runData, discData, evData, auditData] = await Promise.all([
        client.getRun(runId),
        client.listRunDiscrepancies(runId),
        client.listRunEvidence(runId),
        client.getRunAudit(runId),
      ])
      setRun(runData)
      setDiscrepancies(discData.items || [])
      setEvidence(evData.items || [])
      setAuditEvents(auditData.items || [])
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || `Failed to fetch run details for ID ${runId}`,
        code: e?.code || 'RUN_NOT_FOUND',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRunData()
  }, [runId, client])

  if (!runId) return null

  if (loading && !run) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <LoadingSkeleton variant="detail" />
      </div>
    )
  }

  if (error && !run) {
    return (
      <div className="max-w-4xl mx-auto pt-6">
        <ErrorState
          title="Could Not Load Reconciliation Results"
          message={error.message}
          code={error.code}
          onRetry={loadRunData}
        />
      </div>
    )
  }

  const hasDiscrepancy = (run?.discrepancy_count ?? 0) > 0 || discrepancies.length > 0

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* 1. Header with Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/runs')}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {run ? getFriendlyTypeName(run.reconciliation_type) : 'Reconciliation Analysis'}
              </h1>
              {run && <RunStatusBadge status={run.status} size="sm" />}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Executed on{' '}
              {run?.created_at
                ? new Date(run.created_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : '—'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadRunData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <Link
            to="/runs/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors"
          >
            <span>New Reconciliation</span>
          </Link>
        </div>
      </div>

      {/* 2. Executive Takeaway Banner */}
      <div
        className={`rounded-2xl p-6 border transition-all ${
          hasDiscrepancy
            ? 'bg-amber-50/70 border-amber-200/80'
            : 'bg-emerald-50/70 border-emerald-200/80'
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${
              hasDiscrepancy
                ? 'bg-amber-500 text-white'
                : 'bg-emerald-600 text-white'
            }`}
          >
            {hasDiscrepancy ? (
              <ShieldAlert className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </div>

          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-900">
              {hasDiscrepancy
                ? `${discrepancies.length} Discrepancy Found — Action Recommended`
                : 'Reconciliation Completed — All Records Matched'}
            </h2>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              {hasDiscrepancy
                ? 'The automated model compared the records across your connected ERP and procurement databases and identified a variance that exceeds allowable matching tolerance. A proposed resolution has been generated for review.'
                : 'All fields, unit pricing, line item sums, and regulatory criteria compared between both source records matched within configured operational tolerances.'}
            </p>

            {/* Business KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-200/60 text-xs">
              <div>
                <span className="text-[11px] font-medium text-slate-500 uppercase">
                  Records Compared
                </span>
                <p className="font-bold text-slate-900 mt-0.5 font-mono">
                  {run?.entities_compared ?? 1} / {run?.entities_total ?? 1}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-medium text-slate-500 uppercase">
                  Issues Detected
                </span>
                <p
                  className={`font-bold mt-0.5 font-mono ${
                    hasDiscrepancy ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {run?.discrepancy_count ?? 0}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-medium text-slate-500 uppercase">
                  Financial Variance
                </span>
                <p className="font-bold text-slate-900 mt-0.5 font-mono">
                  {discrepancies.length > 0 && discrepancies[0].difference
                    ? formatDifference(discrepancies[0].difference)
                    : '₹0.00 (0%)'}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-medium text-slate-500 uppercase">
                  Next Step
                </span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {hasDiscrepancy ? 'Review Resolution' : 'No Action Needed'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Discrepancy Investigation Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-slate-900 uppercase">
            Discrepancy Findings ({discrepancies.length})
          </h2>
        </div>

        {discrepancies.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8">
            <EmptyState
              icon={<Scale className="h-6 w-6 text-emerald-600" />}
              title="Zero Discrepancies"
              description="No variances or policy violations were detected across compared records."
            />
          </div>
        ) : (
          <div className="space-y-4">
            {discrepancies.map((d) => (
              <div
                key={d.discrepancy_id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Field Variance: {d.field || 'Amount'}
                      </span>
                      <SeverityBadge severity={d.severity} size="sm" />
                      <DiscrepancyStatusBadge status={d.status} />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">
                      Affected Record: {d.entity_ref}
                    </p>
                  </div>

                  <Link
                    to={`/exceptions/${d.discrepancy_id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors self-start sm:self-auto"
                  >
                    <span>Resolve Exception</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {/* 2-Way Comparison Box */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 rounded-xl p-4 text-xs">
                  <div className="p-3 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 font-medium">Source A (Invoiced)</span>
                    <p className="text-base font-bold text-slate-900 font-mono mt-1">
                      {String(d.source_a_value)}
                    </p>
                    <span className="text-[10px] text-slate-400">Supplier Document</span>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 font-medium">Source B (Authorized PO)</span>
                    <p className="text-base font-bold text-slate-900 font-mono mt-1">
                      {String(d.source_b_value)}
                    </p>
                    <span className="text-[10px] text-slate-400">ERP System Ledger</span>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 font-medium">Variance Detected</span>
                    <p className="text-base font-bold text-amber-700 font-mono mt-1">
                      {formatDifference(d.difference)}
                    </p>
                    <span className="text-[10px] text-amber-600 font-medium">Exceeds Tolerance</span>
                  </div>
                </div>

                {/* Plain-English Root Cause Explanation */}
                <div className="rounded-lg bg-slate-50/80 p-3 text-xs text-slate-700 space-y-1">
                  <span className="font-bold text-slate-900">Root Cause Rationale:</span>
                  <p className="text-slate-600">
                    The supplier submitted invoice #{d.entity_ref} billing {String(d.source_a_value)}, whereas the authorized purchase order in the ERP specifies {String(d.source_b_value)}. The calculated difference of {formatDifference(d.difference)} requires formal review.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Advanced Technical Details & Audit (Collapsible for Developers / Auditors) */}
      <div className="pt-4 border-t border-slate-200/80">
        <button
          type="button"
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
          className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              showTechnicalDetails ? 'rotate-180' : ''
            }`}
          />
          <span>Advanced Audit & Technical Information (Developers & Compliance)</span>
        </button>

        {showTechnicalDetails && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            {/* Sub-tabs */}
            <div className="flex items-center gap-4 border-b border-slate-100 pb-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveTechnicalTab('evidence')}
                className={`font-semibold pb-1 border-b-2 transition-colors ${
                  activeTechnicalTab === 'evidence'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                Supporting Evidence ({evidence.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTechnicalTab('audit')}
                className={`font-semibold pb-1 border-b-2 transition-colors ${
                  activeTechnicalTab === 'audit'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                Immutable Audit Trail ({auditEvents.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTechnicalTab('raw')}
                className={`font-semibold pb-1 border-b-2 transition-colors ${
                  activeTechnicalTab === 'raw'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-700'
                }`}
              >
                Raw MCP Payload
              </button>
            </div>

            {/* Tab content */}
            {activeTechnicalTab === 'evidence' && (
              <div>
                {evidence.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">No evidence records attached.</p>
                ) : (
                  <EvidenceViewer evidence={evidence} />
                )}
              </div>
            )}

            {activeTechnicalTab === 'audit' && (
              <div className="space-y-2">
                {auditEvents.map((evt) => (
                  <div
                    key={evt.seq}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-mono"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 font-bold">#{evt.seq}</span>
                      <span className="font-bold text-slate-900">{evt.event_type}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">{evt.actor}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTechnicalTab === 'raw' && (
              <div className="max-h-80 overflow-y-auto">
                <JsonViewer data={run} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
