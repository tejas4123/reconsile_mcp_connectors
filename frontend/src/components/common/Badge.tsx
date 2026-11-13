import React from 'react'
import type { DiscrepancyStatus, ProposalStatus, RunStatus, Severity } from '../../types/index.ts'

export const RunStatusBadge: React.FC<{ status: RunStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'md',
}) => {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs font-medium'

  switch (status) {
    case 'COMPLETED':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 ${sizeClasses}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>
          Matched
        </span>
      )
    case 'COMPLETED_WITH_DISCREPANCIES':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 ${sizeClasses}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-600"></span>
          Discrepancies
        </span>
      )
    case 'RUNNING':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20 ${sizeClasses}`}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600"></span>
          Running
        </span>
      )
    case 'PENDING':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20 ${sizeClasses}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500"></span>
          Queued
        </span>
      )
    case 'FAILED':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 ${sizeClasses}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-rose-600"></span>
          Failed
        </span>
      )
    default:
      return (
        <span className={`inline-flex items-center rounded-md bg-slate-100 text-slate-700 ${sizeClasses}`}>
          {status}
        </span>
      )
  }
}

export const SeverityBadge: React.FC<{ severity: Severity; size?: 'sm' | 'md' }> = ({
  severity,
  size = 'md',
}) => {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs font-medium'

  switch (severity) {
    case 'CRITICAL':
      return (
        <span
          className={`inline-flex items-center rounded-md bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-600/30 font-semibold ${sizeClasses}`}
        >
          Critical
        </span>
      )
    case 'HIGH':
      return (
        <span
          className={`inline-flex items-center rounded-md bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 ${sizeClasses}`}
        >
          High
        </span>
      )
    case 'MEDIUM':
      return (
        <span
          className={`inline-flex items-center rounded-md bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 ${sizeClasses}`}
        >
          Medium
        </span>
      )
    case 'LOW':
      return (
        <span
          className={`inline-flex items-center rounded-md bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20 ${sizeClasses}`}
        >
          Low
        </span>
      )
    default:
      return <span>{severity}</span>
  }
}

export const DiscrepancyStatusBadge: React.FC<{ status: DiscrepancyStatus }> = ({ status }) => {
  switch (status) {
    case 'OPEN':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">
          Open
        </span>
      )
    case 'PROPOSED':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
          Proposed
        </span>
      )
    case 'AWAITING_APPROVAL':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
          Awaiting Approval
        </span>
      )
    case 'RESOLVED':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Resolved
        </span>
      )
    case 'DISMISSED':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
          Dismissed
        </span>
      )
    default:
      return <span>{status}</span>
  }
}

export const ProposalStatusBadge: React.FC<{ status: ProposalStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'md',
}) => {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs font-medium'
  switch (status) {
    case 'AWAITING_APPROVAL':
      return (
        <span className={`inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 ${sizeClasses}`}>
          Awaiting Approval
        </span>
      )
    case 'APPROVED':
      return (
        <span className={`inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 ${sizeClasses}`}>
          Approved
        </span>
      )
    case 'REJECTED':
      return (
        <span className={`inline-flex items-center gap-1 rounded-md bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 ${sizeClasses}`}>
          Rejected
        </span>
      )
    case 'SUPERSEDED':
      return (
        <span className={`inline-flex items-center gap-1 rounded-md bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20 ${sizeClasses}`}>
          Superseded
        </span>
      )
    case 'APPLIED':
      return (
        <span className={`inline-flex items-center gap-1 rounded-md bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/20 ${sizeClasses}`}>
          Applied
        </span>
      )
    default:
      return (
        <span className={`inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-700 ${sizeClasses}`}>
          {status}
        </span>
      )
  }
}

export const ScopeBadge: React.FC<{ scope: 'platform' | 'tenant' }> = ({ scope }) => {
  return scope === 'platform' ? (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
      Platform Template
    </span>
  ) : (
    <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
      Tenant Override
    </span>
  )
}

