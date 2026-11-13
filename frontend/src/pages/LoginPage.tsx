import React, { useState, useTransition } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../lib/auth/use-auth.ts'
import { inspectJwt } from '../lib/auth/auth-client.ts'
import { apiClient } from '../lib/api/api-client.ts'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { loginWithToken } = useAuth()
  const [isPending, startTransition] = useTransition()

  const [emailOrLoginId, setEmailOrLoginId] = useState('admin@reconcile.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedLogin = emailOrLoginId.trim()
    const trimmedPassword = password.trim()

    if (!trimmedLogin) {
      setError('Please enter your email or login ID.')
      return
    }

    if (!trimmedPassword) {
      setError('Please enter your password.')
      return
    }

    startTransition(async () => {
      try {
        let activeToken = trimmedPassword

        // If the password is not already a raw 3-part JWT, request token from server-side BFF auth
        if (!trimmedPassword.includes('.') || trimmedPassword.split('.').length !== 3) {
          const authRes = await fetch(`${apiClient.getBaseUrl()}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: trimmedLogin,
              password: trimmedPassword,
              tenant: apiClient.tenant,
            }),
          })
          const authData = (await authRes.json().catch(() => ({}))) as {
            success?: boolean
            token?: string
            error?: { message?: string }
            detail?: string
          }

          if (!authRes.ok || !authData.token) {
            setError(
              authData.detail ||
                authData.error?.message ||
                'Authentication failed. Please verify your credentials.'
            )
            return
          }

          activeToken = authData.token
        }

        // Authenticate if token is a valid 3-part JWT
        if (activeToken.includes('.') && activeToken.split('.').length === 3) {
          const inspection = inspectJwt(activeToken)
          if (!inspection.valid || !inspection.claims) {
            setError(
              inspection.isExpired
                ? 'Invalid credentials: Your security session token has expired.'
                : 'Invalid credentials. Please check your login ID and password.'
            )
            return
          }

          const res = await loginWithToken(activeToken, true)
          if (res.success) {
            const from = (location.state as { from?: Location })?.from?.pathname || '/'
            navigate(from, { replace: true })
            return
          }

          setError(res.error || 'Authentication failed. Please try again.')
          return
        }

        // Standard rejection for incorrect credentials
        setError('Invalid credentials. Please check your email and password.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error occurred. Please try again.')
      }
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 antialiased selection:bg-slate-900 selection:text-white">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-slate-900 text-white font-bold text-lg shadow-sm mb-4">
            R
          </div>
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase mb-2">
            Reconcile
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome back
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Sign in to your Reconcile workspace.
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-7 shadow-xs">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-rose-50 border border-rose-200/80 p-3 text-xs text-rose-700 flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="login-id" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email or Login ID
              </label>
              <input
                id="login-id"
                type="text"
                autoComplete="username"
                value={emailOrLoginId}
                onChange={(e) => {
                  setEmailOrLoginId(e.target.value)
                  setError(null)
                }}
                placeholder="name@company.com"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 transition-colors"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer mt-2"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Signing in...</span>
                </span>
              ) : (
                <span>Sign in</span>
              )}
            </button>
          </form>
        </div>

        {/* Small Notice */}
        <p className="text-center text-[11px] text-slate-400 mt-6">
          Authorized users only. Enterprise multi-tenant security enforced.
        </p>
      </div>
    </div>
  )
}
