import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowRightLeft,
  CheckSquare,
  Database,
  FileCode,
  FileSearch,
  History,
  LayoutDashboard,
  PlayCircle,
  Radio,
  Search,
  Settings,
  Sliders,
} from 'lucide-react'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
      }
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const items = [
    { title: 'Overview Dashboard', url: '/', icon: LayoutDashboard, category: 'Workspace' },
    { title: 'New Reconciliation Run', url: '/runs/new', icon: PlayCircle, category: 'Actions' },
    { title: 'Reconciliation Runs History', url: '/runs', icon: ArrowRightLeft, category: 'Workspace' },
    { title: 'Exception Management Workbench', url: '/exceptions', icon: AlertOctagon, category: 'Workspace' },
    { title: 'Evidence Vault & Citations', url: '/evidence', icon: FileSearch, category: 'Workspace' },
    { title: 'Four-Eyes Approval Inbox', url: '/approvals', icon: CheckSquare, category: 'Workspace' },
    { title: 'Connections & Data Adapters', url: '/connections', icon: Database, category: 'Configuration' },
    { title: 'Reconciliation Rules & Tolerances', url: '/rules', icon: Sliders, category: 'Configuration' },
    { title: 'Governance & Audit Logs', url: '/audit', icon: History, category: 'Governance' },
    { title: 'MCP Console & Tool Schemas', url: '/developer', icon: Radio, category: 'Developer' },
    { title: 'REST API Documentation', url: '/api-docs', icon: FileCode, category: 'Developer' },
    { title: 'Platform Settings & Tokens', url: '/settings', icon: Settings, category: 'Settings' },
  ]

  const filtered = items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = (url: string) => {
    navigate(url)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center px-4 border-b border-slate-200">
          <Search className="h-4 w-4 text-slate-400 mr-2 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or navigate to a workspace page..."
            className="w-full py-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
            autoFocus
          />
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No navigation commands matching "{query}"
            </div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.url}
                  onClick={() => handleSelect(item.url)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-slate-400 group-hover:text-slate-900" />
                    <span className="text-xs font-medium text-slate-800 group-hover:text-slate-950">
                      {item.title}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 rounded bg-slate-100 px-1.5 py-0.2">
                    {item.category}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
