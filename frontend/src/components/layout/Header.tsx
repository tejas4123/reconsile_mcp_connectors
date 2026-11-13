import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  LogOut,
  Search,
  Settings,
  Shield,
  Terminal,
  User,
} from 'lucide-react'
import { useApi } from '../../api/context.tsx'
import { useAuth } from '../../lib/auth/use-auth.ts'
import { UserProfileModal } from '../common/UserProfileModal.tsx'

interface HeaderProps {
  onSearchOpen: () => void
}

export const Header: React.FC<HeaderProps> = ({ onSearchOpen }) => {
  const location = useLocation()
  const { isBackendLive, activeTenant, setTenant } = useApi()
  const { user, logout } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)

  // Generate breadcrumbs from path
  const pathParts = location.pathname.split('/').filter(Boolean)

  const getBreadcrumbTitle = (part: string, idx: number) => {
    if (idx === 0) {
      const map: Record<string, string> = {
        runs: 'Reconciliations',
        exceptions: 'Exceptions',
        evidence: 'Evidence Vault',
        approvals: 'Approvals',
        connections: 'Connected Systems',
        rules: 'Matching Rules',
        audit: 'Audit Trail',
        developer: 'Developer Console',
        'api-docs': 'API Documentation',
        settings: 'Settings',
      }
      return map[part] || part
    }
    if (part === 'new') return 'New Reconciliation'
    return part.length > 14 ? `${part.substring(0, 10)}...` : part
  }

  const tenantOptions = [
    { id: 'acme-india', label: 'Acme Manufacturing (India)' },
    { id: 'globex', label: 'Globex Trading International' },
  ]

  const currentTenantObj =
    tenantOptions.find((t) => t.id === activeTenant) || {
      id: activeTenant,
      label: activeTenant,
    }

  return (
    <header className="h-14 border-b border-slate-200/80 bg-white px-6 flex items-center justify-between shrink-0 select-none">
      {/* Breadcrumb / Title */}
      <div className="flex items-center gap-2 text-xs">
        <Link to="/" className="text-slate-400 hover:text-slate-700 font-medium">
          Reconcile
        </Link>
        {pathParts.length === 0 ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            <span className="font-semibold text-slate-900">Executive Overview</span>
          </>
        ) : (
          pathParts.map((part, index) => {
            const url = `/${pathParts.slice(0, index + 1).join('/')}`
            const isLast = index === pathParts.length - 1
            return (
              <React.Fragment key={url}>
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                {isLast ? (
                  <span className="font-semibold text-slate-900">
                    {getBreadcrumbTitle(part, index)}
                  </span>
                ) : (
                  <Link to={url} className="text-slate-500 hover:text-slate-800">
                    {getBreadcrumbTitle(part, index)}
                  </Link>
                )}
              </React.Fragment>
            )
          })
        )}
      </div>

      {/* Right Tools: Customer Workspace, Status, Search, User */}
      <div className="flex items-center gap-3">
        {/* Global Search Trigger */}
        <button
          onClick={onSearchOpen}
          className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-600 transition-colors w-48 md:w-56"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left truncate">Search invoices, runs...</span>
          <kbd className="rounded bg-white px-1.5 py-0.5 text-[9px] font-mono border border-slate-200 text-slate-400">
            ⌘K
          </kbd>
        </button>

        {/* Customer / Workspace Selector */}
        <div className="relative">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs hover:border-slate-300 transition-colors">
            <Building2 className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={activeTenant}
              onChange={(e) => setTenant(e.target.value)}
              className="appearance-none bg-transparent pr-5 text-xs font-medium text-slate-800 focus:outline-none cursor-pointer"
            >
              {tenantOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* System Health Status Indicator */}
        <div className="hidden lg:flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isBackendLive ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
          />
          <span className="font-medium">{isBackendLive ? 'Operational' : 'Offline'}</span>
        </div>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-slate-100 flex items-center justify-center text-xs font-semibold">
              {user?.sub ? user.sub.substring(0, 2).toUpperCase() : <User className="h-4 w-4" />}
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg z-50">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {user?.sub || 'Enterprise Operator'}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate mt-0.5">
                    {currentTenantObj.label}
                  </p>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowProfileModal(true)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Shield className="h-4 w-4 text-slate-400" />
                    <span>Authentication & Roles</span>
                  </button>

                  <Link
                    to="/settings"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Settings className="h-4 w-4 text-slate-400" />
                    <span>Platform Settings</span>
                  </Link>

                  <Link
                    to="/developer"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Terminal className="h-4 w-4 text-slate-400" />
                    <span>Developer Console (MCP)</span>
                  </Link>
                </div>

                <div className="border-t border-slate-100 pt-1">
                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      logout('User clicked sign out')
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </header>
  )
}
