import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './use-auth.ts'
import type { Scope } from './auth-types.ts'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredScope?: Scope | string
  requiredScopes?: (Scope | string)[]
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredScope,
  requiredScopes,
}) => {
  const { status, hasScope, hasAllScopes } = useAuth()
  const location = useLocation()

  // 1. Loading State - Block render of protected UI
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          <div className="text-center">
            <h3 className="text-xs font-semibold text-slate-800">Verifying Security Session</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Validating tenant principal and JWT claims...</p>
          </div>
        </div>
      </div>
    )
  }

  // 2. Expired State - Redirect to dedicated session expired notice
  if (status === 'expired') {
    return <Navigate to="/session-expired" state={{ from: location }} replace />
  }

  // 3. Unauthenticated State - Redirect to login preserving intended destination
  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // 4. Role & Scope Verification
  if (requiredScope && !hasScope(requiredScope)) {
    return (
      <Navigate
        to="/access-denied"
        state={{
          requiredScope,
          from: location,
        }}
        replace
      />
    )
  }

  if (requiredScopes && !hasAllScopes(requiredScopes)) {
    return (
      <Navigate
        to="/access-denied"
        state={{
          requiredScopes,
          from: location,
        }}
        replace
      />
    )
  }

  // 5. Authorized - Render protected component tree
  return <>{children}</>
}

interface PublicOnlyRouteProps {
  children: React.ReactNode
}

export const PublicOnlyRoute: React.FC<PublicOnlyRouteProps> = ({ children }) => {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
      </div>
    )
  }

  if (status === 'authenticated') {
    const from = (location.state as { from?: Location })?.from?.pathname || '/'
    return <Navigate to={from} replace />
  }

  return <>{children}</>
}

