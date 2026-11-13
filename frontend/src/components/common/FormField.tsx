import React, { type ReactNode } from 'react'

interface FormFieldProps {
  label: string
  htmlFor?: string
  description?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  description,
  error,
  required,
  children,
  className = '',
}) => {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-900">
          {label}
          {required && <span className="text-rose-500 ml-1">*</span>}
        </label>
      </div>

      {description && <p className="text-[11px] text-slate-500">{description}</p>}

      {children}

      {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}
    </div>
  )
}

