import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiClient, ReconcileApiClient } from './client.ts'
import { useAuth } from '../lib/auth/use-auth.ts'

export interface Toast {
  id: string
  title: string
  message?: string
  type: 'info' | 'success' | 'warning' | 'error'
}

interface ApiContextValue {
  client: ReconcileApiClient
  isBackendLive: boolean
  backendUrl: string
  workerAge: number | null
  activeTenant: string
  token: string | null
  toasts: Toast[]
  setTenant: (tenant: string) => void
  setToken: (token: string | null) => void
  setBaseUrl: (url: string) => void
  addToast: (title: string, message?: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  removeToast: (id: string) => void
  refreshHealth: () => Promise<void>
}

const ApiContext = createContext<ApiContextValue | null>(null)

export const ApiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const auth = useAuth()
  const [isBackendLive, setIsBackendLive] = useState(false)
  const [backendUrl, setBackendUrlState] = useState(apiClient.getBaseUrl())
  const [workerAge, setWorkerAge] = useState<number | null>(null)
  const [activeTenant, setActiveTenantState] = useState(auth.tenant || apiClient.tenant)
  const [token, setTokenState] = useState(auth.token || apiClient.getToken())
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = (
    title: string,
    message?: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, title, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const refreshHealth = async () => {
    const health = await apiClient.checkHealth()
    setIsBackendLive(health.live)
    setWorkerAge(health.workerAge ?? null)
  }

  // Synchronize token & tenant from auth context
  useEffect(() => {
    if (auth.token !== token) {
      setTokenState(auth.token)
      apiClient.setToken(auth.token)
      refreshHealth()
    }
  }, [auth.token, token])

  useEffect(() => {
    if (auth.tenant && auth.tenant !== activeTenant) {
      setActiveTenantState(auth.tenant)
      apiClient.setTenant(auth.tenant)
    }
  }, [auth.tenant, activeTenant])

  // Configure 401 and 403 API interceptors
  useEffect(() => {
    apiClient.setOnUnauthorized((err) => {
      auth.expireSession(err.message || 'Session expired or invalid token')
      addToast('Session Expired', 'Your security session has expired. Please sign in again.', 'error')
    })

    apiClient.setOnForbidden((err) => {
      addToast('Permission Denied', err.message || 'You lack the required security scope for this operation.', 'error')
    })
  }, [auth])

  useEffect(() => {
    refreshHealth()
    const interval = setInterval(refreshHealth, 15000)
    return () => clearInterval(interval)
  }, [])

  const handleSetTenant = (tenant: string) => {
    apiClient.setTenant(tenant)
    setActiveTenantState(tenant)
    addToast('Tenant Changed', `Switched active organization to ${tenant}`, 'info')
  }

  const handleSetToken = (newToken: string | null) => {
    apiClient.setToken(newToken)
    setTokenState(newToken)
    addToast(
      newToken ? 'API Token Registered' : 'API Token Cleared',
      newToken ? 'Bearer token registered for all subsequent API requests' : 'Cleared authentication token',
      'info'
    )
    refreshHealth()
  }

  const handleSetBaseUrl = (newUrl: string) => {
    apiClient.setBaseUrl(newUrl)
    setBackendUrlState(newUrl)
    addToast('API Base URL Updated', `Backend target set to ${newUrl}`, 'info')
    refreshHealth()
  }

  return (
    <ApiContext.Provider
      value={{
        client: apiClient,
        isBackendLive,
        backendUrl,
        workerAge,
        activeTenant,
        token,
        toasts,
        setTenant: handleSetTenant,
        setToken: handleSetToken,
        setBaseUrl: handleSetBaseUrl,
        addToast,
        removeToast,
        refreshHealth,
      }}
    >
      {children}
    </ApiContext.Provider>
  )
}

export const useApi = (): ApiContextValue => {
  const context = useContext(ApiContext)
  if (!context) {
    throw new Error('useApi must be used within an ApiProvider')
  }
  return context
}
