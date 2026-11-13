import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowRightLeft,
  ChevronRight,
  HelpCircle,
  History,
  LayoutDashboard,
  PlusCircle,
  Scale,
  Settings,
  User,
} from 'lucide-react'
import { useApi } from '../../api/context.tsx'
import { useAuth } from '../../lib/auth/use-auth.ts'
import { UserProfileModal } from '../common/UserProfileModal.tsx'

interface SidebarProps {
  onSearchOpen: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({ onSearchOpen }) => {
  const { activeTenant, isBackendLive } = useApi()
  const { user } = useAuth()
  const [showProfileModal, setShowProfileModal] = useState(false)

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all ${
      isActive
        ? 'bg-slate-900 text-white shadow-xs font-semibold'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`

  const tenantDisplayName =
    activeTenant === 'acme-india'
      ? 'Acme Manufacturing'
      : activeTenant === 'globex'
      ? 'Globex Trading'
      : activeTenant

  return (
    <aside className="w-64 border-r border-slate-200/80 bg-white flex flex-col justify-between shrink-0 select-none">
      <div className="flex flex-col min-h-0 flex-1">
        {/* Brand Header */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-xs">
              <Scale className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-slate-900">RECONCILE</span>
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">Financial Operations</p>
            </div>
          </div>

          {/* Prominent Action Button */}
          <div className="mt-4">
            <NavLink
              to="/runs/new"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white shadow-sm hover:bg-slate-800 transition-all active:scale-[0.99]"
            >
              <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
              <span>New Reconciliation</span>
            </NavLink>
          </div>
        </div>

        {/* Primary Navigation - Strictly 4 Core Business Sections */}
        <div className="p-3 space-y-1 flex-1 overflow-y-auto">
          <div className="px-3 pt-2 pb-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Operations
          </div>

          <nav className="space-y-1">
            {/* 1. Overview */}
            <NavLink to="/" end className={navItemClass}>
              <div className="flex items-center gap-2.5">
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>Overview</span>
              </div>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </NavLink>

            {/* 2. Reconciliations */}
            <NavLink to="/runs" className={navItemClass}>
              <div className="flex items-center gap-2.5">
                <ArrowRightLeft className="h-4 w-4 shrink-0" />
                <span>Reconciliations</span>
              </div>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </NavLink>

            {/* 3. Exceptions */}
            <NavLink to="/exceptions" className={navItemClass}>
              <div className="flex items-center gap-2.5">
                <AlertOctagon className="h-4 w-4 shrink-0 text-amber-500" />
                <span>Exceptions</span>
              </div>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </NavLink>

            {/* 4. Audit Trail */}
            <NavLink to="/audit" className={navItemClass}>
              <div className="flex items-center gap-2.5">
                <History className="h-4 w-4 shrink-0" />
                <span>Audit Trail</span>
              </div>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </NavLink>
          </nav>
        </div>
      </div>

      {/* Footer Area: Settings, Help & User Profile */}
      <div className="border-t border-slate-100 p-3 space-y-1 bg-slate-50/60 shrink-0">
        <NavLink
          to="/settings"
          className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-white hover:text-slate-900 transition-colors shadow-2xs hover:shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-slate-500" />
            <span>Settings & Tools</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">Rules • MCP</span>
        </NavLink>

        <button
          onClick={onSearchOpen}
          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-white hover:text-slate-800 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
            <span>Search & Commands</span>
          </div>
          <kbd className="rounded bg-white px-1.5 py-0.5 text-[9px] font-mono border border-slate-200 text-slate-400">
            ⌘K
          </kbd>
        </button>

        {/* Workspace & User Profile */}
        <div className="pt-2 mt-1 border-t border-slate-200/50">
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="w-full flex items-center gap-2.5 p-1.5 hover:bg-white rounded-lg transition-all text-left cursor-pointer shadow-2xs"
          >
            <div className="h-7 w-7 rounded-lg bg-slate-800 text-slate-100 flex items-center justify-center text-xs font-semibold shrink-0">
              {user?.sub ? user.sub.substring(0, 2).toUpperCase() : <User className="h-3.5 w-3.5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">
                {tenantDisplayName}
              </p>
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isBackendLive ? 'bg-emerald-500' : 'bg-rose-400'
                  }`}
                />
                <span className="text-[10px] text-slate-400 truncate">
                  {isBackendLive ? 'Systems Operational' : 'Offline'}
                </span>
              </div>
            </div>
          </button>
        </div>

        <UserProfileModal
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
        />
      </div>
    </aside>
  )
}
