import React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react'
import { useApi } from '../../api/context.tsx'

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApi()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success'
        const isError = toast.type === 'error'
        const isWarning = toast.type === 'warning'

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all animate-in slide-in-from-bottom-2 ${
              isSuccess
                ? 'border-emerald-200 bg-white text-emerald-950'
                : isError
                ? 'border-rose-200 bg-white text-rose-950'
                : isWarning
                ? 'border-amber-200 bg-white text-amber-950'
                : 'border-slate-200 bg-white text-slate-900'
            }`}
          >
            <div className="mt-0.5">
              {isSuccess && <CheckCircle className="h-5 w-5 text-emerald-600" />}
              {isError && <AlertCircle className="h-5 w-5 text-rose-600" />}
              {isWarning && <AlertTriangle className="h-5 w-5 text-amber-600" />}
              {!isSuccess && !isError && !isWarning && <Info className="h-5 w-5 text-sky-600" />}
            </div>

            <div className="flex-1">
              <h4 className="text-xs font-semibold">{toast.title}</h4>
              {toast.message && <p className="mt-0.5 text-xs text-slate-600">{toast.message}</p>}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

