import React from 'react'
import {
  CheckCircle2,
  Clock,
  KeyRound,
  LogOut,
  Shield,
  User,
  X,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../../lib/auth/use-auth.ts'
import type { Scope } from '../../lib/auth/auth-types.ts'

interface UserProfileModalProps {
  isOpen: boolean
  onClose: () => void
}

const ALL_SCOPES: { scope: Scope; title: string; description: string; target: 'Human' | 'Agent' | 'Shared' }[] = [
  {
    scope: 'recon:read',
    title: 'Operational Read',
    description: 'View reconciliation runs, exceptions, evidence, and audit logs.',
    target: 'Shared',
  },
  {
    scope: 'recon:run',
    title: 'Run Execution',
    description: 'Trigger single-record or batch reconciliation processes.',
    target: 'Shared',
  },
  {
    scope: 'recon:propose',
    title: 'Resolution Proposal',
    description: 'Generate corrective action proposals for discrepancies.',
    target: 'Agent',
  },
  {
    scope: 'recon:approve',
    title: 'Human Approval',
    description: 'Authorize or reject proposed corrective mutations with four-eyes validation.',
    target: 'Human',
  },
  {
    scope: 'recon:apply',
    title: 'Mutation Execution',
    description: 'Apply approved write operations into external source systems.',
    target: 'Agent',
  },
  {
    scope: 'recon:admin',
    title: 'Customer Administration',
    description: 'Author, validate, dry-run, activate, and roll back reconciliation rules.',
    target: 'Human',
  },
]

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, tenant, scopes, expiresAt, secondsRemaining, logout } = useAuth()

  if (!isOpen) return null

  const handleSignOut = () => {
    logout('User triggered sign-out from profile modal')
    onClose()
  }

  const formatRemaining = (sec: number | null) => {
    if (sec === null) return 'Active'
    if (sec <= 0) return 'Expired'
    const hours = Math.floor(sec / 3600)
    const minutes = Math.floor((sec % 3600) / 60)
    const seconds = sec % 60
    if (hours > 0) return `${hours}h ${minutes}m remaining`
    if (minutes > 0) return `${minutes}m ${seconds}s remaining`
    return `${seconds}s remaining`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
              {user?.sub ? user.sub.substring(0, 2).toUpperCase() : 'OP'}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">User Security Profile</h2>
              <p className="text-xs text-slate-500">Verified OAuth 2.1 Principal Claims & RBAC Scopes</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Identity Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-400">
              <User className="h-3.5 w-3.5" />
              <span>Subject Identity (sub)</span>
            </div>
            <p className="font-mono font-semibold text-slate-900 break-all">{user?.sub || 'None'}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Shield className="h-3.5 w-3.5" />
              <span>Organization / Tenant</span>
            </div>
            <p className="font-mono font-semibold text-slate-900">{tenant || 'Not bound'}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-400">
              <KeyRound className="h-3.5 w-3.5" />
              <span>Client ID / Audience</span>
            </div>
            <p className="font-mono text-slate-700 truncate">{user?.client_id || user?.aud || 'reconcile-mcp'}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              <span>Session Validity</span>
            </div>
            <p className="font-mono text-slate-700 text-[11px]">
              {expiresAt ? expiresAt.toLocaleTimeString() : 'N/A'} ({formatRemaining(secondsRemaining)})
            </p>
          </div>
        </div>

        {/* RBAC Scope Matrix */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Assigned Authorization Scopes
            </h3>
            <span className="text-[11px] text-slate-400">
              {scopes.length} of {ALL_SCOPES.length} Granted
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100 text-xs">
            {ALL_SCOPES.map(({ scope, title, description, target }) => {
              const isGranted = scopes.includes(scope)
              return (
                <div
                  key={scope}
                  className={`p-3 flex items-start justify-between gap-3 ${
                    isGranted ? 'bg-white' : 'bg-slate-50/40 text-slate-400'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[11px] font-semibold ${isGranted ? 'text-slate-900' : 'text-slate-400'}`}>
                        {scope}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="font-medium text-slate-700">{title}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-500 uppercase">
                        {target}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">{description}</p>
                  </div>

                  <div>
                    {isGranted ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Granted</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        <XCircle className="h-3 w-3" />
                        <span>Not Assigned</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>

          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  )
}

