import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Filter,
  RefreshCw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import { useAuth } from '../lib/auth/use-auth.ts'
import type { DecisionRequest, ProposalDetail, ProposalResult, ProposalStatus } from '../types/index.ts'
import { ProposalStatusBadge } from '../components/common/Badge.tsx'
import { Modal } from '../components/common/Modal.tsx'
import { Drawer } from '../components/common/Drawer.tsx'
import { EmptyState } from '../components/common/EmptyState.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

export const ApprovalsPage: React.FC = () => {
  const { client, addToast, activeTenant } = useApi()
  const { hasScope } = useAuth()
  const canApprove = hasScope('recon:approve')
  const [proposals, setProposals] = useState<ProposalResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('AWAITING_APPROVAL')
  const [selectedProposal, setSelectedProposal] = useState<ProposalResult | null>(null)
  const [proposalDetail, setProposalDetail] = useState<ProposalDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Decision Modal State
  const [decisionModalOpen, setDecisionModalOpen] = useState(false)
  const [decisionType, setDecisionType] = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [decisionComment, setDecisionComment] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  const fetchProposals = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await client.listProposals({
        status: statusFilter === 'ALL' ? undefined : (statusFilter as ProposalStatus),
        limit: 100,
      })
      setProposals(data || [])
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || 'Failed to query proposals from approval service.',
        code: e?.code || 'UNAVAILABLE',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProposals()
  }, [client, activeTenant, statusFilter])

  const openDetailDrawer = async (proposal: ProposalResult) => {
    setSelectedProposal(proposal)
    setLoadingDetail(true)
    try {
      const detail = await client.getProposal(proposal.proposal_id)
      setProposalDetail(detail)
    } catch (err: unknown) {
      console.warn('Could not fetch proposal detail', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  const promptDecision = (type: 'APPROVED' | 'REJECTED') => {
    setDecisionType(type)
    setDecisionComment('')
    setDecisionError(null)
    setDecisionModalOpen(true)
  }

  const handleDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProposal) return
    setDeciding(true)
    setDecisionError(null)

    const payload: DecisionRequest = {
      decision: decisionType,
      comment: decisionComment.trim() || undefined,
      expected_version: proposalDetail?.version || 1,
    }

    try {
      const updated = await client.decideProposal(selectedProposal.proposal_id, payload)
      addToast(
        decisionType === 'APPROVED' ? 'Proposal Authorized' : 'Proposal Rejected',
        `Proposal ${selectedProposal.proposal_id.substring(0, 8)} recorded as ${updated.status}`,
        decisionType === 'APPROVED' ? 'success' : 'warning'
      )
      setDecisionModalOpen(false)
      setSelectedProposal(null)
      fetchProposals()
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      const msg = e?.message || 'Decision submission failed'
      setDecisionError(msg)
      addToast('Decision Rejected by Backend', msg, 'error')
    } finally {
      setDeciding(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Four-Eyes Authorization Inbox
            </h1>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900 font-mono">
              {proposals.length} in Queue
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Mandatory human-in-the-loop sign-off for sensitive database modifications and financial corrections.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-2.5 py-1">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <span>Filter:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-medium text-slate-900 focus:outline-none"
            >
              <option value="AWAITING_APPROVAL">Awaiting Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="SUPERSEDED">Superseded</option>
              <option value="ALL">All Proposals</option>
            </select>
          </div>

          <button
            onClick={fetchProposals}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Read-Only Governance Scope Notice */}
      {!canApprove && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Read-Only Approval Queue:</strong> Your identity does not carry the <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-[11px]">recon:approve</code> scope. You can review proposals, checks, and evidence, but authorization actions are restricted to designated human approvers.
            </span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <ErrorState
          title="Could Not Load Proposals"
          message={error.message}
          code={error.code}
          onRetry={fetchProposals}
        />
      )}

      {/* Four-Eyes Governance Callout */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-950 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold text-xs">Strict Four-Eyes Principle Enforced</h3>
          <p className="mt-0.5 text-slate-700 leading-relaxed">
            Per backend governance rules, the proposer identity cannot approve its own resolution. All decisions require an independent human reviewer authenticated with scope <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-semibold">recon:approve</code>.
          </p>
        </div>
      </div>

      {/* Proposals Queue Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-6">
            <LoadingSkeleton variant="table-rows" rows={5} />
          </div>
        ) : proposals.length === 0 ? (
          <div className="p-10">
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6 text-emerald-600" />}
              title="No Pending Approvals"
              description={`There are currently no proposals matching status "${statusFilter}" for tenant "${activeTenant}".`}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Proposal ID</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Target / Parameters</th>
                  <th className="px-4 py-3">Proposed By</th>
                  <th className="px-4 py-3">Approval Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {proposals.map((prop) => (
                  <tr
                    key={prop.proposal_id}
                    onClick={() => openDetailDrawer(prop)}
                    className="cursor-pointer hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-slate-900">
                      {prop.proposal_id.substring(0, 13)}...
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{prop.action}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {prop.planned_write ? (
                        <span className="truncate block max-w-xs">{prop.planned_write.target}</span>
                      ) : (
                        <span>{JSON.stringify(prop.params)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 truncate max-w-xs">
                      {prop.proposed_by}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-[11px] max-w-xs truncate">
                      {prop.approval_reason || 'Requires supervisor sign-off'}
                    </td>
                    <td className="px-4 py-3">
                      <ProposalStatusBadge status={prop.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                      {prop.approval_expires_at
                        ? new Date(prop.approval_expires_at).toLocaleDateString()
                        : 'No Expiry'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetailDrawer(prop)
                        }}
                        className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
                      >
                        <span>Review</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Drawer */}
      <Drawer
        isOpen={Boolean(selectedProposal)}
        onClose={() => {
          setSelectedProposal(null)
          setProposalDetail(null)
        }}
        title={`Review Proposal: ${selectedProposal?.action}`}
        subtitle={selectedProposal?.proposal_id}
        footer={
          selectedProposal && (
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-slate-500">
                Action requires four-eyes validation
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => promptDecision('REJECTED')}
                  disabled={!canApprove}
                  title={!canApprove ? 'Requires recon:approve scope' : 'Reject proposal'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-rose-700 shadow-2xs hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  <span>Reject</span>
                </button>
                <button
                  onClick={() => promptDecision('APPROVED')}
                  disabled={!canApprove}
                  title={!canApprove ? 'Requires recon:approve scope' : 'Authorize proposal'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  <span>Authorize & Approve</span>
                </button>
              </div>
            </div>
          )
        }
      >
        {selectedProposal && (
          <div className="space-y-6 text-xs">
            {/* Status and Action Header */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-base font-bold text-slate-900">
                  {selectedProposal.action}
                </span>
                <ProposalStatusBadge status={selectedProposal.status} />
              </div>
              <p className="text-slate-600 leading-relaxed">{selectedProposal.rationale}</p>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-200/60">
                <div>
                  <span>Proposed by: </span>
                  <strong className="font-mono text-slate-800">{selectedProposal.proposed_by}</strong>
                </div>
                <div>
                  <span>Created: </span>
                  <span className="font-mono">{new Date(selectedProposal.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Planned Write Details */}
            {selectedProposal.planned_write && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Planned Target Write (Mutation)
                </h4>
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Target Record:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedProposal.planned_write.target}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Expected Version:</span>
                    <span className="font-mono text-slate-700">
                      {selectedProposal.planned_write.expected_version || 'None'}
                    </span>
                  </div>
                  <div className="pt-2">
                    <span className="text-slate-400 block mb-1">Proposed Field Changes:</span>
                    <pre className="rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800 border border-slate-200 overflow-x-auto">
                      {JSON.stringify(selectedProposal.planned_write.changes, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* Validation Checks */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Pre-Execution Validation Checks
              </h4>
              <div className="space-y-2">
                {selectedProposal.checks.map((check) => (
                  <div
                    key={check.name}
                    className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3"
                  >
                    {check.passed ? (
                      <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <X className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-semibold text-slate-800">{check.name}</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence Root Cause Summary */}
            {loadingDetail ? (
              <div className="text-center py-4 text-slate-400">Loading full root-cause explanation...</div>
            ) : proposalDetail ? (
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Supporting Discrepancy Evidence
                </h4>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="font-semibold text-slate-900">{proposalDetail.explanation.summary}</p>
                  <p className="text-[11px] text-slate-600">{proposalDetail.explanation.severity_rationale}</p>
                  <Link
                    to={`/exceptions/${selectedProposal.discrepancy_id}`}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-900 font-semibold hover:underline pt-1"
                  >
                    <span>Inspect Full Root-Cause Console</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Drawer>

      {/* Decision Submission Modal */}
      <Modal
        isOpen={decisionModalOpen}
        onClose={() => setDecisionModalOpen(false)}
        title={decisionType === 'APPROVED' ? 'Authorize Proposed Write' : 'Reject Proposed Resolution'}
        size="md"
      >
        <form onSubmit={handleDecisionSubmit} className="space-y-4 text-xs">
          <p className="text-slate-600">
            {decisionType === 'APPROVED'
              ? 'By approving, you authorize this planned write to execute against source enterprise records. Your identity will be permanently recorded in the immutable audit log.'
              : 'Rejecting this proposal will close it and require a supervisor or AI agent to submit an alternate resolution.'}
          </p>

          {decisionError && (
            <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-rose-800">
              <strong className="block font-semibold">Backend Error:</strong>
              <span>{decisionError}</span>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-800 mb-1">
              Audit Comment / Justification
            </label>
            <textarea
              value={decisionComment}
              onChange={(e) => setDecisionComment(e.target.value)}
              placeholder="Provide reason for this four-eyes authorization decision..."
              rows={3}
              className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDecisionModalOpen(false)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deciding}
              className={`rounded-md px-4 py-1.5 font-semibold text-white shadow-xs transition-colors flex items-center gap-1.5 ${
                decisionType === 'APPROVED'
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : 'bg-rose-700 hover:bg-rose-800'
              }`}
            >
              {deciding && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{decisionType === 'APPROVED' ? 'Confirm Approval' : 'Confirm Rejection'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
