import React from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, RefreshCw, Settings } from 'lucide-react'
import { useApi } from '../../api/context.tsx'

export const ServiceConnectionBanner: React.FC = () => {
  const { isBackendLive, backendUrl, refreshHealth } = useApi()

  if (isBackendLive) {
    return null
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-2 text-xs text-amber-900 select-none">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span>
            Backend unreachable at <code className="font-mono font-semibold">{backendUrl}</code>. Live requests will fail until the service is started.
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshHealth()}
            className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Check Again</span>
          </button>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:underline"
          >
            <Settings className="h-3 w-3" />
            <span>Configure URL & Token</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

