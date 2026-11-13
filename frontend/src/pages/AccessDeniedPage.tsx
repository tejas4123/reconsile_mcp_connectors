import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, KeyRound, ShieldX, UserCheck } from 'lucide-react'
import { useAuth } from '../lib/auth/use-auth.ts'

export const AccessDeniedPage: React.FC = () => {
  const { user, tenant, scopes } = useAuth()
  const location = useLocation()
  const required =
    (location.state as { requiredScope?: string; requiredScopes?: string[] })?.requiredScope ||
    (location.state as { requiredScope?: string; requiredScopes?: string[] })?.requiredScopes

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-xs space-y-6">
        <div className="flex items-start gap-4">
          <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200 shrink-0">
            <ShieldX className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">403 Access Forbidden</h1>
            <p className="text-xs text-slate-500 leading-relaxed">
              You do not have the required role or authorization scope to access this operation.
            </p>
          </div>
        </div>

        {/* Missing Scope Callout */}
        {required && (
          <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-3.5 text-xs text-amber-900 space-y-1">
            <span className="font-semibold flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-amber-600" />
              <span>Required Authorization Scope:</span>
            </span>
            <div className="pt-1 flex flex-wrap gap-1 font-mono text-[11px]">
              {Array.isArray(required) ? (
                required.map((s) => (
                  <span key={s} className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-200">
                    {s}
                  </span>
                ))
              ) : (
                <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-200">
                  {required}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Current Identity & Granted Scopes */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-xs space-y-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <UserCheck className="h-3.5 w-3.5 text-slate-500" />
            <span>Your Verified Principal</span>
          </div>

          <div className="space-y-1 font-mono text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
            <div className="flex justify-between">
              <span className="text-slate-400">Subject:</span>
              <span className="font-semibold text-slate-900">{user?.sub || 'Unidentified'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Tenant:</span>
              <span className="font-semibold text-slate-900">{tenant || 'Not bound'}</span>
            </div>
          </div>

          <div className="pt-1">
            <span className="text-slate-400 block mb-1 text-[11px]">Currently Granted Scopes:</span>
            <div className="flex flex-wrap gap-1 font-mono text-[10px]">
              {scopes.length > 0 ? (
                scopes.map((s) => (
                  <span
                    key={s}
                    className="bg-white text-slate-700 px-2 py-0.5 rounded border border-slate-200"
                  >
                    {s}
                  </span>
                ))
              ) : (
                <span className="text-slate-400 italic">No scopes granted</span>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
          If you require access to this capability (such as human approval <code className="text-slate-700 font-mono">recon:approve</code> or rule authoring <code className="text-slate-700 font-mono">recon:admin</code>), contact your organization's security administrator to update your IdP group assignments.
        </div>

        <div className="pt-1 flex items-center justify-between">
          <Link
            to="/"
            replace
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Return to Workspace Overview</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

