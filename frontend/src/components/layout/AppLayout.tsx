import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar.tsx'
import { Header } from './Header.tsx'
import { ServiceConnectionBanner } from '../common/ServiceConnectionBanner.tsx'
import { ToastContainer } from '../common/Toast.tsx'
import { CommandPalette } from '../common/CommandPalette.tsx'

export const AppLayout: React.FC = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
      <Sidebar onSearchOpen={() => setIsSearchOpen(true)} />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Header onSearchOpen={() => setIsSearchOpen(true)} />
        <ServiceConnectionBanner />

        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <ToastContainer />
    </div>
  )
}
