import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../lib/auth/use-auth.ts'

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate()
  const { loginWithToken } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(true)

  useEffect(() => {
    const processCallback = async () => {
      // 1. Check URL fragment/hash for OAuth implicit/hybrid response (e.g. #access_token=...)
      const hash = window.location.hash.substring(1)
      const search = window.location.search.substring(1)
      const params = new URLSearchParams(hash || search)

      const err = params.get('error')
      const errDesc = params.get('error_description')
      if (err) {
        setError(errDesc || `Authentication failed: ${err}`)
        setProcessing(false)
        return
      }

      const accessToken = params.get('access_token') || params.get('token') || params.get('id_token')
      if (!accessToken) {
        setError('No access token returned by the Identity Provider callback.')
        setProcessing(false)
        return
      }

      const res = await loginWithToken(accessToken, false)
      if (res.success) {
        // Clear hash from URL for security
        window.history.replaceState(null, '', window.location.pathname)
        navigate('/', { replace: true })
      } else {
        setError(res.error || 'Failed to initialize session with returned token.')
        setProcessing(false)
      }
    }

    processCallback()
  }, [loginWithToken, navigate])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xs text-center space-y-4">
        {processing ? (
          <div className="space-y-3 py-6">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
            <h2 className="text-sm font-bold text-slate-900">Completing Enterprise Authentication</h2>
            <p className="text-xs text-slate-500">
              Validating token signature, tenant binding, and granted scopes...
            </p>
          </div>
        ) : error ? (
          <div className="space-y-4 py-2">
            <div className="mx-auto h-10 w-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Authentication Failed</h2>
              <p className="text-xs text-rose-600 mt-1 leading-relaxed">{error}</p>
            </div>
            <div className="pt-2">
              <Link
                to="/login"
                replace
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Sign In</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-6">
            <div className="mx-auto h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">Session Verified</h2>
            <p className="text-xs text-slate-500">Redirecting to reconciliation workspace...</p>
          </div>
        )}
      </div>
    </div>
  )
}

