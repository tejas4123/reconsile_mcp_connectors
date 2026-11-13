import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  Layers,
  Lock,
  Play,
  RotateCcw,
  Scale,
  Send,
  Shield,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type {
  AllowedAction,
  DiscrepancyExplanation,
} from '../types/index.ts'
import {
  DiscrepancyStatusBadge,
  ProposalStatusBadge,
  SeverityBadge,
} from '../components/common/Badge.tsx'
import { EvidenceViewer } from '../components/common/EvidenceViewer.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { Modal } from '../components/common/Modal.tsx'
import { ConfirmationDialog } from '../components/common/ConfirmationDialog.tsx'

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
  return diff.detail || diff.kind || 'Divergence'
}

interface ValidationCheck {
  name: string
  passed: boolean
  detail: string
}

interface ValidationModalData {
  proposalId: string
  action: string
  valid: boolean
  checks: ValidationCheck[]
}

export const ExceptionDetailPage: React.FC = () => {
  const { discrepancyId } = useParams<{ discrepancyId: string }>()
  const { client, addToast } = useApi()
  const navigate = useNavigate()

  const [explanation, setExplanation] = useState<DiscrepancyExplanation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  // Propose Modal State
  const [proposeModalOpen, setProposeModalOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<AllowedAction | null>(null)
  const [rationale, setRationale] = useState('')
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({})
  const [proposing, setProposing] = useState(false)
  const [proposeError, setProposeError] = useState<string | null>(null)

  // Validation State
  const [validationModalOpen, setValidationModalOpen] = useState(false)
  const [validationData, setValidationData] = useState<ValidationModalData | null>(null)
  const [validatingProposalId, setValidatingProposalId] = useState<string | null>(null)

  // Apply Resolution Confirmation State
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [proposalToApply, setProposalToApply] = useState<any | null>(null)
  const [applying, setApplying] = useState(false)

  const loadExplanation = async () => {
    if (!discrepancyId) return
    setLoading(true)
    setError(null)
    try {
      const data = await client.explainDiscrepancy(discrepancyId)
      setExplanation(data)
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || `Discrepancy ${discrepancyId} could not be retrieved from backend explanation service.`,
        code: e?.code || 'DISCREPANCY_NOT_FOUND',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExplanation()
  }, [discrepancyId, client])

  if (!discrepancyId) return null

  const d = explanation?.discrepancy

  // Open Propose Action Dialog
  const handleOpenPropose = (action: AllowedAction) => {
    setSelectedAction(action)
    setRationale(`Resolving ${d?.field || 'variance'} via ${action.name}`)
    // Set default parameter suggestions based on action
    const defaultParams: Record<string, string> = {}
    if (action.name === 'AMEND_PO_AMOUNT') {
      defaultParams['new_amount'] = String(d?.source_a_value ?? '')
      defaultParams['currency'] = 'INR'
    } else if (action.name === 'REQUEST_CREDIT_NOTE') {
      const diffVal = (d?.difference as any)?.signed
      defaultParams['amount'] = String(diffVal ? Math.abs(diffVal) : '500.00')
      defaultParams['currency'] = 'INR'
    } else if (action.name === 'ACCEPT_VARIANCE') {
      defaultParams['justification'] = 'Approved variance within contractual operational tolerance.'
    }
    setParamInputs(defaultParams)
    setProposeError(null)
    setProposeModalOpen(true)
  }

  // Submit Propose Resolution (via MCP propose_resolution)
  const handleProposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAction || !discrepancyId) return

    setProposing(true)
    setProposeError(null)

    try {
      const res = await client.proposeResolution({
        discrepancy_id: discrepancyId,
        action: selectedAction.name,
        params: Object.keys(paramInputs).length > 0 ? paramInputs : undefined,
        rationale: rationale.trim() || `Automated resolution proposal for ${selectedAction.name}`,
      })

      const proposal = res as any
      const requiresApproval = proposal?.requires_approval ?? selectedAction.requires_human_approval

      addToast(
        requiresApproval ? 'Proposal Submitted (Pending Approval)' : 'Containment Proposal Approved',
        `Proposal ${proposal?.proposal_id?.substring(0, 8) || ''} recorded with status ${proposal?.status || 'SUBMITTED'}.`,
        requiresApproval ? 'warning' : 'success'
      )

      setProposeModalOpen(false)
      setSelectedAction(null)
      // Reload explanation to display the updated proposals list
      loadExplanation()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setProposeError(e?.message || 'Failed to submit proposal via MCP.')
      addToast('Proposal Submission Failed', e?.message || 'Error executing propose_resolution', 'error')
    } finally {
      setProposing(false)
    }
  }

  // Validate Resolution (via MCP validate_resolution)
  const handleValidate = async (prop: any) => {
    setValidatingProposalId(prop.proposal_id)
    try {
      const res = (await client.validateResolution(prop.proposal_id)) as any
      setValidationData({
        proposalId: prop.proposal_id,
        action: prop.action,
        valid: res?.valid ?? true,
        checks: res?.checks ?? [],
      })
      setValidationModalOpen(true)
      addToast('Validation Passed', `Proposal ${prop.action} passed pre-execution checks.`, 'success')
    } catch (err: unknown) {
      const e = err as { message?: string }
      addToast('Validation Failed', e?.message || 'Error executing validate_resolution', 'error')
    } finally {
      setValidatingProposalId(null)
    }
  }

  // Prompt Confirmation to Apply Resolution
  const handlePromptApply = (prop: any) => {
    if (prop.status === 'AWAITING_APPROVAL') {
      addToast(
        'Approval Required',
        'This proposal requires four-eyes supervisor authorization in the Approvals Inbox before it can be applied.',
        'warning'
      )
      return
    }
    setProposalToApply(prop)
    setApplyDialogOpen(true)
  }

  // Apply Resolution (via MCP apply_resolution with confirmed: true)
  const handleConfirmApply = async () => {
    if (!proposalToApply) return
    setApplying(true)

    try {
      const res = (await client.applyResolution(proposalToApply.proposal_id, true)) as any
      addToast(
        'Resolution Applied',
        `Proposal ${proposalToApply.action} executed against source systems with status ${res?.status || 'APPLIED'}.`,
        'success'
      )
      setApplyDialogOpen(false)
      setProposalToApply(null)
      loadExplanation()
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      addToast(
        'Apply Resolution Failed',
        e?.message || 'Operation rejected by backend governance rule.',
        'error'
      )
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Back button & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(d?.run_id ? `/runs/${d.run_id}` : '/exceptions')}
            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            title="Return"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 font-mono">
                {d?.entity_ref || discrepancyId}
              </h1>
              {d && <SeverityBadge severity={d.severity} />}
              {d && <DiscrepancyStatusBadge status={d.status} />}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Field:{' '}
              <strong className="text-slate-800 font-mono">{d?.field || '—'}</strong> · Type:{' '}
              <span className="font-mono text-slate-700">{d?.discrepancy_type || '—'}</span>
            </p>
          </div>
        </div>

        {d && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={loadExplanation}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
            <Link
              to={`/runs/${d.run_id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>View Parent Run</span>
            </Link>
            <Link
              to="/approvals"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-slate-800 transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Approvals Queue</span>
            </Link>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && !loading && (
        <ErrorState
          title="Discrepancy Investigation Unavailable"
          message={error.message}
          code={error.code}
          onRetry={loadExplanation}
        />
      )}

      {loading && !explanation ? (
        <LoadingSkeleton variant="detail" />
      ) : explanation && d ? (
        <>
          {/* Executive Deterministic Explanation Banner */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Deterministic Root-Cause Analysis
              </h2>
            </div>
            <p className="text-sm font-semibold text-slate-900 leading-snug">
              {explanation.summary}
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>Severity Assessment:</strong> {explanation.severity_rationale}
            </p>

            {explanation.notes && explanation.notes.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1">
                {explanation.notes.map((note, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="h-1 w-1 rounded-full bg-slate-400" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Two-Way Record Comparison */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 bg-slate-50/60">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Two-Way Record Comparison
              </h3>
              <p className="text-xs text-slate-500">
                Observed values between primary record and secondary counterparty record.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              {/* Source A */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Source A (Primary Reference)
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-700">
                    {explanation.match.source_a_ref}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <span className="text-[11px] text-slate-400 uppercase font-mono block">
                    Field: {d.field}
                  </span>
                  <span className="font-mono text-xl font-bold text-slate-900 mt-1 block">
                    {String(d.source_a_value)}
                  </span>
                </div>
              </div>

              {/* Source B */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Source B (Counterparty / Extracted)
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-700">
                    {explanation.match.source_b_ref || 'None'}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <span className="text-[11px] text-slate-400 uppercase font-mono block">
                    Field: {d.field}
                  </span>
                  <span className="font-mono text-xl font-bold text-slate-900 mt-1 block">
                    {String(d.source_b_value)}
                  </span>
                </div>
              </div>
            </div>

            {/* Computed Difference Bar */}
            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Evaluated Divergence:</span>
                <span className="font-mono font-bold text-red-700 bg-red-100/60 px-2 py-0.5 rounded">
                  {formatDifference(d.difference)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Match Confidence:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {(explanation.match.confidence * 100).toFixed(0)}%
                </span>
                <span className="text-slate-400">({explanation.match.method})</span>
              </div>
            </div>
          </div>

          {/* Derivations & Fired Rules */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Rule Fired */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <Scale className="h-4 w-4 text-slate-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Applied Matching Rule
                </h3>
              </div>
              {explanation.rule ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Comparator:</span>
                    <span className="font-mono font-semibold text-slate-800">{explanation.rule.comparator}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Tolerance:</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {JSON.stringify(explanation.rule.tolerance)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Mandatory Field:</span>
                    <span className="font-semibold text-slate-800">
                      {explanation.rule.mandatory ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Base Severity:</span>
                    <SeverityBadge severity={explanation.rule.base_severity} size="sm" />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Policy-based single-source evaluation.</p>
              )}
            </div>

            {/* Derivations */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <Shield className="h-4 w-4 text-slate-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Evaluated Derivations
                </h3>
              </div>
              {explanation.derivations && explanation.derivations.length > 0 ? (
                <div className="space-y-2">
                  {explanation.derivations.map((drv, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800"
                    >
                      {drv}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Direct field-to-field comparison with no calculated derivations.</p>
              )}
            </div>
          </div>

          {/* Supporting Evidence Viewer */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Supporting Evidence Citations
            </h3>
            <EvidenceViewer evidence={explanation.evidence} />
          </div>

          {/* Resolution Proposals History & Execution Panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Resolution Proposals Workflow
                </h3>
              </div>
              <Link to="/approvals" className="text-xs text-slate-500 hover:text-slate-800">
                Open Approvals Inbox &rarr;
              </Link>
            </div>

            {explanation.proposals && explanation.proposals.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {explanation.proposals.map((prop: any) => (
                  <div key={prop.proposal_id} className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{prop.action}</span>
                        <ProposalStatusBadge status={prop.status} size="sm" />
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono">
                        ID: {prop.proposal_id} · By: {prop.proposed_by} · Created: {new Date(prop.created_at).toLocaleString()}
                      </p>
                      {prop.rationale && (
                        <p className="text-[11px] text-slate-600 italic">
                          &ldquo;{prop.rationale}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Validate Button */}
                      <button
                        onClick={() => handleValidate(prop)}
                        disabled={validatingProposalId === prop.proposal_id}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        {validatingProposalId === prop.proposal_id ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
                        ) : (
                          <Check className="h-3.5 w-3.5 text-slate-500" />
                        )}
                        <span>Validate</span>
                      </button>

                      {/* Apply Button */}
                      {prop.status === 'APPROVED' ? (
                        <button
                          onClick={() => handlePromptApply(prop)}
                          className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 transition-colors"
                        >
                          <Play className="h-3 w-3 text-emerald-200" />
                          <span>Apply Resolution</span>
                        </button>
                      ) : prop.status === 'AWAITING_APPROVAL' ? (
                        <Link
                          to="/approvals"
                          className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-900 border border-amber-200 px-2.5 py-1 text-xs font-medium hover:bg-amber-200 transition-colors"
                        >
                          <Lock className="h-3 w-3 text-amber-700" />
                          <span>Requires Sign-Off</span>
                        </Link>
                      ) : prop.status === 'APPLIED' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Applied to System</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-mono">
                          {prop.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<CheckCircle2 className="h-6 w-6 text-slate-400" />}
                title="No Proposals Registered"
                description="No resolution proposals have been submitted for this discrepancy yet. Select an authorized action below to propose a fix."
              />
            )}
          </div>

          {/* Permitted Actions Catalog & Propose Interface */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Permitted Resolution Actions (Action Catalog)
              </h3>
              <p className="text-xs text-slate-500">
                Closed set of deterministic resolution actions authorized by policy for this discrepancy type.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {explanation.allowed_actions.map((action) => (
                <div
                  key={action.name}
                  className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3 text-xs flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900">{action.name}</span>
                      {action.recommended && (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">{action.description}</p>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        action.requires_human_approval ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {action.requires_human_approval ? (
                        <>
                          <Lock className="h-3 w-3" />
                          <span>Requires Four-Eyes Approval</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-3 w-3" />
                          <span>Automated Containment</span>
                        </>
                      )}
                    </span>

                    <button
                      onClick={() => handleOpenPropose(action)}
                      className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors"
                    >
                      <Send className="h-3 w-3" />
                      <span>Propose Action</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
              <Terminal className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Governance &amp; Four-Eyes Security Barrier</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Automated proposals and operator proposals requiring corrective writes are held in <code className="font-mono text-slate-800 font-semibold">AWAITING_APPROVAL</code>.
                  Per corporate security policy, they cannot be applied until a second authorized human reviewer approves them via the inbox.
                </p>
                <Link
                  to="/developer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-900 hover:underline mt-2"
                >
                  <span>View MCP Tool Documentation & Prompts</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Propose Action Modal */}
      {selectedAction && (
        <Modal
          isOpen={proposeModalOpen}
          onClose={() => setProposeModalOpen(false)}
          title={`Propose Action: ${selectedAction.name}`}
          size="md"
        >
          <form onSubmit={handleProposeSubmit} className="space-y-4 text-xs">
            {selectedAction.requires_human_approval ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900 flex items-start gap-2">
                <Lock className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Four-Eyes Approval Required:</strong>
                  <span>
                    This action alters corporate records or authorizes financial amendments. Once submitted, it will be placed in the Approvals Inbox for human supervisor sign-off before application.
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-emerald-900 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Automated Clearance:</strong>
                  <span>This action is a containment safeguard and does not require four-eyes approval.</span>
                </div>
              </div>
            )}

            {proposeError && (
              <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-rose-800">
                <strong className="block font-semibold">Proposal Error:</strong>
                <span>{proposeError}</span>
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Proposal Rationale <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                required
                rows={2}
                placeholder="Explain why this resolution is appropriate..."
                className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
              />
            </div>

            {/* Action-specific Parameters */}
            {Object.keys(paramInputs).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block font-semibold text-slate-800">Action Parameters</label>
                {Object.entries(paramInputs).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-600 w-28 truncate">{k}:</span>
                    <input
                      type="text"
                      value={v}
                      onChange={(e) =>
                        setParamInputs((prev) => ({ ...prev, [k]: e.target.value }))
                      }
                      className="flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-900 focus:border-slate-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setProposeModalOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={proposing}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
              >
                {proposing && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                <span>Submit Proposal</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Validation Checks Modal */}
      {validationData && (
        <Modal
          isOpen={validationModalOpen}
          onClose={() => setValidationModalOpen(false)}
          title={`Validation Checks: ${validationData.action}`}
          size="md"
        >
          <div className="space-y-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Proposal ID:</span>
              <span className="font-mono font-semibold text-slate-900">{validationData.proposalId}</span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Verification Results
              </span>
              {validationData.checks.length > 0 ? (
                validationData.checks.map((chk, i) => (
                  <div key={i} className="flex items-start gap-2 bg-white p-2.5 rounded border border-slate-200">
                    {chk.passed ? (
                      <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <X className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold text-slate-900">{chk.name}</span>
                      <p className="text-[11px] text-slate-600 mt-0.5">{chk.detail}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">All pre-execution validation checks passed.</p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setValidationModalOpen(false)}
                className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Explicit Confirmation Dialog Before Write Operation (Apply Resolution) */}
      {proposalToApply && (
        <ConfirmationDialog
          isOpen={applyDialogOpen}
          onClose={() => setApplyDialogOpen(false)}
          onConfirm={handleConfirmApply}
          title={`Confirm Application: ${proposalToApply.action}`}
          description={`Are you sure you want to apply this resolution to live systems? This operation will mutate enterprise records for discrepancy ${discrepancyId}.`}
          confirmText="Confirm & Apply Resolution"
          cancelText="Cancel"
          variant="warning"
          isLoading={applying}
        >
          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-950 space-y-1">
            <div className="flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
              <span>Irreversible Write Warning</span>
            </div>
            <p>
              Action <strong className="font-mono text-amber-900">{proposalToApply.action}</strong> will be permanently recorded in the immutable audit log with your operator session.
            </p>
          </div>
        </ConfirmationDialog>
      )}
    </div>
  )
}
