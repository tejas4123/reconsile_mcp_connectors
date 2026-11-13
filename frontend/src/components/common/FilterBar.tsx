import React, { type ReactNode } from 'react'
import { X } from 'lucide-react'

interface FilterBarProps {
  children: ReactNode
  onReset?: () => void
  hasActiveFilters?: boolean
  className?: string
}

export const FilterBar: React.FC<FilterBarProps> = ({
  children,
  onReset,
  hasActiveFilters,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-xs ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">{children}</div>

      {hasActiveFilters && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          <span>Reset Filters</span>
        </button>
      )}
    </div>
  )
}
