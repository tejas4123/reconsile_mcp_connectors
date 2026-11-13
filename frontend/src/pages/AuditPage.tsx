import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  Download,
  FileCheck2,
  History,
  Info,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from 'lucide-react'
import type { AuditEventView, RunListItem } from '../types/index.ts'
import { useApi } from '../api/context.tsx'
import { JsonViewer } from '../components/common/JsonViewer.tsx'
import { Modal } from '../components/common/Modal.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

interface EventMeta {
  title: string
  description: (evt: AuditEventView) => string
  icon: typeof History
  color: string
}

function getEventMeta(eventType: string): EventMeta {
  const norm = eventType.toLowerCase().replace(/_/g, '.')
  switch (norm) {
    case 'run.requested':
    case 'reconciliation.run.requested':
      return {
        title: 'Reconciliation Requested',
        description: (evt) =>
          `Reconciliation requested by ${evt.actor || 'operator'} for target ${evt.subject_id?.slice(0, 8) || 'run'}.`,
        icon: PlayCircle,
        color: 'text-sky-600 bg-sky-50 border-sky-200',
      }
    case 'run.started':
    case 'reconciliation.run.started':
      return {
        title: 'Reconciliation Initiated',
        description: () =>
          `Automated pipeline started comparing records across systems.`,
        icon: PlayCircle,
        color: 'text-sky-600 bg-sky-50 border-sky-200',
      }
    case 'run.completed':
    case 'reconciliation.run.completed':
      return {
        title: 'Reconciliation Completed',
        description: (evt) =>
          `Execution finished with audit status ${evt.payload?.status || 'COMPLETED'}.`,
        icon: CheckCircle2,
        color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      }
    case 'run.status.changed':
      return {
        title: 'Run Status Updated',
        description: (evt) =>
          `Status transitioned from ${evt.payload?.from || '—'} to ${evt.payload?.to || '—'}.`,
        icon: History,
        color: 'text-slate-600 bg-slate-50 border-slate-200',
      }
    case 'discrepancy.detected':
      return {
        title: 'Discrepancy Identified',
        description: (evt) =>
          `Identified variance on field "${evt.payload?.field || 'amount'}". Requires operational review.`,
        icon: AlertOctagon,
        color: 'text-amber-600 bg-amber-50 border-amber-200',
      }
    case 'proposal.created':
      return {
        title: 'Resolution Proposed',
        description: (evt) =>
          `Action "${evt.payload?.action || 'PROPOSED'}" submitted for controller review.`,
        icon: FileCheck2,
        color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      }
    case 'proposal.approved':
      return {
        title: 'Resolution Approved (Human Authorization)',
        description: (evt) =>
          `Controller ${evt.payload?.approver || evt.actor || ''} authorized action "${evt.payload?.action || ''}".`,
        icon: ShieldCheck,
        color: 'text-purple-600 bg-purple-50 border-purple-200',
      }
    case 'proposal.rejected':
      return {
        title: 'Resolution Rejected',
        description: (evt) =>
          `Controller rejected proposal: ${evt.payload?.comment || 'Rejected during review'}.`,
        icon: AlertOctagon,
        color: 'text-rose-600 bg-rose-50 border-rose-200',
      }
    case 'proposal.decided':
      return {
        title: 'Human Authorization Decided',
        description: (evt) =>
          `Controller decided proposal as ${evt.payload?.decision || 'DECIDED'}.`,
        icon: ShieldCheck,
        color: 'text-purple-600 bg-purple-50 border-purple-200',
      }
    case 'proposal.applied':
    case 'resolution.applied':
      return {
        title: 'Resolution Applied to Target System',
        description: () =>
          `Approved correction successfully written to ERP financial database.`,
        icon: CheckCircle2,
        color: 'text-emerald-700 bg-emerald-100 border-emerald-300',
      }
    default:
      return {
        title: eventType.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: (evt) =>
          `Audit record registered for entity ${evt.subject_id || evt.subject_type}.`,
        icon: History,
        color: 'text-slate-600 bg-slate-100 border-slate-200',
      }
  }
}

export const AuditPage: React.FC = () => {
  const { client, addToast, activeTenant } = useApi()
  const [searchParams, setSearchParams] = useSearchParams()

  const [runs, setRuns] = useState<RunListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>(searchParams.get('runId') || '')
  const [events, setEvents] = useState<AuditEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<AuditEventView | null>(null)

  // Step 1: Load runs
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
        console.warn('Could not load runs for audit viewer', err)
      }
    }
    loadRuns()
  }, [client, activeTenant])

  // Step 2: Load audit trail for selectedRunId
  const loadAudit = async () => {
    if (!selectedRunId) {
      setEvents([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await client.getRunAudit(selectedRunId, { limit: 100 })
      setEvents(res.items || [])
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || `Failed to fetch audit records for run ${selectedRunId}`,
        code: e?.code || 'FETCH_FAILED',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAudit()
  }, [selectedRunId])

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId)
    setSearchParams({ runId })
  }

  const filtered = events.filter((evt) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      evt.event_type.toLowerCase().includes(q) ||
      evt.actor.toLowerCase().includes(q) ||
      evt.correlation_id.toLowerCase().includes(q) ||
      evt.client_id.toLowerCase().includes(q)
    )
  })

  const exportAudit = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reconcile-audit-trail-${selectedRunId.substring(0, 8)}-${Date.now()}.json`
    a.click()
    addToast('Audit Log Exported', 'Full append-only audit trail exported as JSON', 'success')
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Audit Trail
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Immutable, append-only chronological history of every reconciliation action, human approval, and system write.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadAudit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          {events.length > 0 && (
            <button
              onClick={exportAudit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Audit</span>
            </button>
          )}
        </div>
      </div>

      {/* Selector & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 shrink-0">
            Reconciliation:
          </span>
          <div className="relative flex-1 sm:w-80">
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
                    {r.source_refs?.invoice || r.source_refs?.vendor || r.source_refs?.contract || r.run_id.substring(0, 14)} ({r.reconciliation_type})
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search events, actors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none w-full sm:w-56"
          />
        </div>
      </div>

      {/* Chronological Timeline */}
      {loading ? (
        <LoadingSkeleton variant="table-rows" rows={5} />
      ) : error ? (
        <ErrorState
          title="Could Not Load Audit Log"
          message={error.message}
          code={error.code}
          onRetry={loadAudit}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8">
          <EmptyState
            icon={<History className="h-6 w-6 text-slate-400" />}
            title="No Audit Records"
            description="No matching audit events recorded for this reconciliation run."
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs space-y-6">
          <div className="relative pl-6 space-y-6 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {filtered.map((evt) => {
              const meta = getEventMeta(evt.event_type)
              const Icon = meta.icon

              return (
                <div key={evt.seq} className="relative flex items-start gap-4 group">
                  {/* Timeline Node Icon */}
                  <div
                    className={`absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full border shadow-2xs shrink-0 ${meta.color}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>

                  {/* Event Content */}
                  <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-4 transition-all hover:bg-white hover:border-slate-200 hover:shadow-2xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-2 border-b border-slate-200/50">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {meta.title}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          #{evt.seq}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-slate-400" />
                          <span>{evt.actor || 'System'}</span>
                        </div>
                        <span>•</span>
                        <span>
                          {new Date(evt.created_at).toLocaleString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <p className="text-xs text-slate-600">
                        {meta.description(evt)}
                      </p>

                      <button
                        type="button"
                        onClick={() => setSelectedEvent(evt)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors self-start sm:self-auto"
                      >
                        <Info className="h-3 w-3" />
                        <span>Inspect Payload</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Inspect Event Payload Modal for Technical Audits */}
      {selectedEvent && (
        <Modal
          isOpen={Boolean(selectedEvent)}
          onClose={() => setSelectedEvent(null)}
          title={`Audit Event #${selectedEvent.seq}: ${selectedEvent.event_type}`}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg text-slate-700 font-mono text-[11px]">
              <div>
                <span className="text-slate-400 block">Actor:</span>
                <span className="font-bold">{selectedEvent.actor}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Correlation ID:</span>
                <span className="font-bold truncate block">{selectedEvent.correlation_id}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Subject ID:</span>
                <span className="font-bold">{selectedEvent.subject_id}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Timestamp:</span>
                <span>{selectedEvent.created_at}</span>
              </div>
            </div>

            <div>
              <span className="text-slate-500 font-semibold mb-1 block">
                Structured Event Payload:
              </span>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <JsonViewer data={selectedEvent.payload || selectedEvent} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
