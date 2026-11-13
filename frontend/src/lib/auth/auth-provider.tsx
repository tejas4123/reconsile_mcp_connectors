import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './auth-context.ts'
import type {
  AuthContextValue,
  AuthState,
  Scope,
  UserClaims,
} from './auth-types.ts'
import { authClient, inspectJwt } from './auth-client.ts'

interface AuthProviderProps {
  children: React.ReactNode
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    token: null,
    user: null,
    tenant: null,
    scopes: [],
    expiresAt: null,
    secondsRemaining: null,
  })

  // Expiration handler
  const handleExpire = useCallback((reason = 'Session has expired') => {
    setState((prev) => ({
      ...prev,
      status: 'expired',
      secondsRemaining: 0,
    }))
    authClient.clearToken()
    console.info(`[Auth] ${reason}`)
  }, [])

  // Process a token string and initialize or update authentication state
  const applyToken = useCallback(
    (token: string, rememberMe = false): { success: boolean; error?: string } => {
      const inspection = inspectJwt(token)
      if (!inspection.valid || !inspection.claims) {
        if (inspection.isExpired) {
          handleExpire('Token is already expired')
          return { success: false, error: 'Token has already expired' }
        }
        return { success: false, error: inspection.error || 'Invalid token claims' }
      }

      const claims: UserClaims = inspection.claims
      const expiresAt = new Date(claims.exp * 1000)
      const secondsRemaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))

      authClient.saveToken(token, rememberMe)

      setState({
        status: 'authenticated',
        token,
        user: claims,
        tenant: claims.tenant,
        scopes: claims.scopes,
        expiresAt,
        secondsRemaining,
      })

      return { success: true }
    },
    [handleExpire]
  )

  // Initialize on mount
  useEffect(() => {
    const stored = authClient.getStoredToken()
    const envToken = import.meta.env.VITE_RECONCILE_API_TOKEN as string | undefined

    const tokenToTry = stored || envToken

    if (tokenToTry) {
      const res = applyToken(tokenToTry, Boolean(stored))
      if (!res.success) {
        authClient.clearToken()
        setState({
          status: 'unauthenticated',
          token: null,
          user: null,
          tenant: null,
          scopes: [],
          expiresAt: null,
          secondsRemaining: null,
        })
      }
    } else {
      setState({
        status: 'unauthenticated',
        token: null,
        user: null,
        tenant: null,
        scopes: [],
        expiresAt: null,
        secondsRemaining: null,
      })
    }

    // Subscribe to client expiration timer
    const unsubscribeExp = authClient.onExpiration(() => {
      handleExpire('Session reached token expiration')
    })

    return () => {
      unsubscribeExp()
    }
  }, [applyToken, handleExpire])

  // Periodic expiration countdown heartbeat
  useEffect(() => {
    if (state.status !== 'authenticated' || !state.expiresAt) return

    const interval = setInterval(() => {
      const remaining = Math.floor((state.expiresAt!.getTime() - Date.now()) / 1000)
      if (remaining <= 0) {
        handleExpire('Token expiration reached during active session')
      } else {
        setState((prev) => (prev.status === 'authenticated' ? { ...prev, secondsRemaining: remaining } : prev))
      }
    }, 10000) // check every 10 seconds

    return () => clearInterval(interval)
  }, [state.status, state.expiresAt, handleExpire])

  // Cross-tab storage synchronization
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'reconcile_auth_token') {
        if (!e.newValue) {
          // Token was cleared in another tab
          setState({
            status: 'unauthenticated',
            token: null,
            user: null,
            tenant: null,
            scopes: [],
            expiresAt: null,
            secondsRemaining: null,
          })
        } else {
          // New token saved in another tab
          applyToken(e.newValue, true)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [applyToken])

  // Public methods
  const loginWithToken = useCallback(
    async (token: string, rememberMe = false): Promise<{ success: boolean; error?: string }> => {
      return applyToken(token, rememberMe)
    },
    [applyToken]
  )

  const logout = useCallback((reason = 'User signed out') => {
    authClient.clearToken()
    setState({
      status: 'unauthenticated',
      token: null,
      user: null,
      tenant: null,
      scopes: [],
      expiresAt: null,
      secondsRemaining: null,
    })
    console.info(`[Auth] ${reason}`)
  }, [])

  const expireSession = useCallback(
    (reason = 'API returned 401 Unauthorized') => {
      handleExpire(reason)
    },
    [handleExpire]
  )

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const stored = authClient.getStoredToken()
    if (!stored) return false
    const inspection = inspectJwt(stored)
    return inspection.valid && !inspection.isExpired
  }, [])

  // Scope verification helpers
  const hasScope = useCallback(
    (scope: Scope | string): boolean => {
      return state.scopes.includes(scope as Scope)
    },
    [state.scopes]
  )

  const hasAllScopes = useCallback(
    (required: (Scope | string)[]): boolean => {
      return required.every((req) => state.scopes.includes(req as Scope))
    },
    [state.scopes]
  )

  const hasAnyScope = useCallback(
    (required: (Scope | string)[]): boolean => {
      return required.some((req) => state.scopes.includes(req as Scope))
    },
    [state.scopes]
  )

  const contextValue: AuthContextValue = useMemo(
    () => ({
      ...state,
      isAuthenticated: state.status === 'authenticated',
      isLoading: state.status === 'loading',
      isExpired: state.status === 'expired',
      hasScope,
      hasAllScopes,
      hasAnyScope,
      loginWithToken,
      logout,
      expireSession,
      refreshSession,
    }),
    [state, hasScope, hasAllScopes, hasAnyScope, loginWithToken, logout, expireSession, refreshSession]
  )

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}

