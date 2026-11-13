import React, { type ReactNode } from 'react'
import { AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { Modal } from './Modal.tsx'

interface ConfirmationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'primary' | 'success'
  isLoading?: boolean
  children?: ReactNode
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  isLoading = false,
  children,
}) => {
  const getIcon = () => {
    switch (variant) {
      case 'danger':
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-amber-600" />
      case 'success':
        return <CheckCircle className="h-5 w-5 text-emerald-600" />
      default:
        return <Info className="h-5 w-5 text-sky-600" />
    }
  }

  const getButtonClass = () => {
    switch (variant) {
      case 'danger':
        return 'bg-rose-600 hover:bg-rose-700 text-white'
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-700 text-white'
      case 'success':
        return 'bg-emerald-600 hover:bg-emerald-700 text-white'
      default:
        return 'bg-slate-900 hover:bg-slate-800 text-white'
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="mt-0.5 rounded-full bg-slate-50 p-2 border border-slate-100 shrink-0">
            {getIcon()}
          </div>
          <div>
            <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
          </div>
        </div>

        {children}

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded-md px-3 py-1.5 text-xs font-medium shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5 ${getButtonClass()}`}
          >
            {isLoading && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}

