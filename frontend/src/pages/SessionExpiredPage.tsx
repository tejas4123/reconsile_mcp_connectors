import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, Clock, ShieldAlert } from 'lucide-react'

export const SessionExpiredPage: React.FC = () => {
  const location = useLocation()
  const from = (location.state as { from?: Location })?.from

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xs text-center space-y-5">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
          <Clock className="h-6 w-6" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">Security Session Expired</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your JWT access token has expired according to OAuth 2.1 RFC 6750 specifications. Please re-authenticate to continue working.
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 text-left text-xs text-slate-600 space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <span>Zero-Trust Security Enforcement</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Unused or expired tokens are invalidated immediately to protect sensitive financial records and reconciliation audit trails.
          </p>
        </div>

        <div className="pt-2">
          <Link
            to="/login"
            state={{ from }}
            replace
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors"
          >
            <span>Sign In Again</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}

