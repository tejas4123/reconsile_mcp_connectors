import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ApiProvider } from './api/context.tsx'
import { AuthProvider } from './lib/auth/auth-provider.tsx'
import { ProtectedRoute, PublicOnlyRoute } from './lib/auth/protected-route.tsx'
import { AppLayout } from './components/layout/AppLayout.tsx'
import { OverviewPage } from './pages/OverviewPage.tsx'
import { RunsPage } from './pages/RunsPage.tsx'
import { NewRunPage } from './pages/NewRunPage.tsx'
import { RunDetailPage } from './pages/RunDetailPage.tsx'
import { ExceptionsPage } from './pages/ExceptionsPage.tsx'
import { ExceptionDetailPage } from './pages/ExceptionDetailPage.tsx'
import { EvidenceExplorerPage } from './pages/EvidenceExplorerPage.tsx'
import { ApprovalsPage } from './pages/ApprovalsPage.tsx'
import { ConnectionsPage } from './pages/ConnectionsPage.tsx'
import { RulesPage } from './pages/RulesPage.tsx'
import { AuditPage } from './pages/AuditPage.tsx'
import { DeveloperPage } from './pages/DeveloperPage.tsx'
import { ApiDocsPage } from './pages/ApiDocsPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { AuthCallbackPage } from './pages/AuthCallbackPage.tsx'
import { SessionExpiredPage } from './pages/SessionExpiredPage.tsx'
import { AccessDeniedPage } from './pages/AccessDeniedPage.tsx'

function App() {
  return (
    <AuthProvider>
      <ApiProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Unauthenticated Routes */}
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <LoginPage />
                </PublicOnlyRoute>
              }
            />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/session-expired" element={<SessionExpiredPage />} />
            <Route path="/access-denied" element={<AccessDeniedPage />} />

            {/* Protected Workspace Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute requiredScope="recon:read">
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="runs" element={<RunsPage />} />
              <Route
                path="runs/new"
                element={
                  <ProtectedRoute requiredScope="recon:run">
                    <NewRunPage />
                  </ProtectedRoute>
                }
              />
              <Route path="runs/:runId" element={<RunDetailPage />} />
              <Route path="exceptions" element={<ExceptionsPage />} />
              <Route path="exceptions/:discrepancyId" element={<ExceptionDetailPage />} />
              <Route path="evidence" element={<EvidenceExplorerPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="connections" element={<ConnectionsPage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="developer" element={<DeveloperPage />} />
              <Route path="api-docs" element={<ApiDocsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ApiProvider>
    </AuthProvider>
  )
}

export default App
