import React from 'react'

interface LoadingSkeletonProps {
  variant?: 'card' | 'table-rows' | 'detail' | 'stats'
  rows?: number
  className?: string
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  variant = 'card',
  rows = 4,
  className = '',
}) => {
  if (variant === 'stats') {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 space-y-3"
          >
            <div className="h-3 w-24 bg-slate-100 rounded"></div>
            <div className="h-7 w-16 bg-slate-200 rounded"></div>
            <div className="h-2.5 w-32 bg-slate-100 rounded"></div>
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'table-rows') {
    return (
      <div className={`divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden ${className}`}>
        <div className="bg-slate-50/70 p-3 h-10 animate-pulse"></div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="p-3.5 flex items-center gap-4 animate-pulse">
            <div className="h-4 w-28 bg-slate-200 rounded"></div>
            <div className="h-4 w-36 bg-slate-100 rounded"></div>
            <div className="h-4 w-20 bg-slate-100 rounded"></div>
            <div className="h-4 w-16 bg-slate-100 rounded ml-auto"></div>
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'detail') {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="animate-pulse rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div className="h-5 w-48 bg-slate-200 rounded"></div>
          <div className="h-3 w-80 bg-slate-100 rounded"></div>
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
            <div className="h-12 bg-slate-50 rounded"></div>
            <div className="h-12 bg-slate-50 rounded"></div>
            <div className="h-12 bg-slate-50 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`animate-pulse rounded-lg border border-slate-200 bg-white p-6 space-y-3 ${className}`}>
      <div className="h-4 w-32 bg-slate-200 rounded"></div>
      <div className="h-3 w-56 bg-slate-100 rounded"></div>
      <div className="h-20 w-full bg-slate-50 rounded mt-4"></div>
    </div>
  )
}

