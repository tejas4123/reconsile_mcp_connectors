import React, { type ReactNode } from 'react'
import { AlertCircle, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

interface ErrorStateProps {
  title?: string
  message: string
  code?: string
  onRetry?: () => void
  showSettingsLink?: boolean
  extra?: ReactNode
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Service Request Failed',
  message,
  code,
  onRetry,
  showSettingsLink = true,
  extra,
}) => {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-rose-950">{title}</h3>
            {code && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-rose-800">
                {code}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-rose-800 leading-relaxed break-words">{message}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-rose-700 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry Request</span>
              </button>
            )}

            {showSettingsLink && (
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 shadow-xs hover:bg-rose-50 transition-colors"
              >
                <SettingsIcon className="h-3.5 w-3.5 text-rose-600" />
                <span>Configure API URL & Token</span>
              </Link>
            )}
          </div>

          {extra && <div className="mt-3">{extra}</div>}
        </div>
      </div>
    </div>
  )
}

