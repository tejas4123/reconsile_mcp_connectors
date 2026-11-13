import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  History,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  Sliders,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import { useAuth } from '../lib/auth/use-auth.ts'
import type {
  DraftResult,
  DryRunResult,
  EffectiveTypeView,
  ReconciliationTypeView,
} from '../types/index.ts'
import { ScopeBadge } from '../components/common/Badge.tsx'
import { Modal } from '../components/common/Modal.tsx'
import { JsonViewer } from '../components/common/JsonViewer.tsx'
import { ErrorState } from '../components/common/ErrorState.tsx'
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.tsx'

export const RulesPage: React.FC = () => {
  const { client, addToast, activeTenant } = useApi()
  const { hasScope } = useAuth()
  const canAdmin = hasScope('recon:admin')

  const [types, setTypes] = useState<ReconciliationTypeView[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('invoice_to_po')
  const [effectiveView, setEffectiveView] = useState<EffectiveTypeView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  // Draft & Dry Run Modal State
  const [draftModalOpen, setDraftModalOpen] = useState(false)
  const [tolerancePercent, setTolerancePercent] = useState('0.0')
  const [changeNote, setChangeNote] = useState('Enforce strict zero tolerance for invoice amount deviations')
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null)

  // Dry run state
  const [dryRunning, setDryRunning] = useState(false)
  const [dryRunError, setDryRunError] = useState<string | null>(null)
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null)

  // Rollback state
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false)
  const [rollbackNote, setRollbackNote] = useState('Revert to previous template version')
  const [rollingBack, setRollingBack] = useState(false)

  const loadData = async (key: string) => {
    setLoading(true)
    setError(null)
    try {
      const [typeList, eff] = await Promise.all([
        client.getReconciliationTypes(),
        client.getEffectiveType(key),
      ])
      setTypes(typeList || [])
      setEffectiveView(eff)
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      setError({
        message: e?.message || `Failed to load effective rules for ${key}`,
        code: e?.code || 'FETCH_FAILED',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(selectedKey)
  }, [selectedKey, client, activeTenant])

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingDraft(true)
    setDraftError(null)
    try {
      const res = await client.createDraft(selectedKey, {
        patch: { 'fields.amount.tolerance.percent': tolerancePercent },
        change_note: changeNote,
      })
      setDraftResult(res)
      addToast(
        'Draft Created',
        `Draft version ${res.draft.version} created with ${res.issues.length} validation issues`,
        res.valid ? 'success' : 'warning'
      )
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      const msg = e?.message || 'Failed to create rule draft'
      setDraftError(msg)
      addToast('Draft Creation Failed', msg, 'error')
    } finally {
      setSavingDraft(false)
    }
  }

  const handleDryRun = async () => {
    if (!draftResult) return
    setDryRunning(true)
    setDryRunError(null)
    try {
      const res = await client.dryRunDraft(draftResult.draft.id, {
        selection: { filter: {}, limit: 100 },
      })
      setDryRunResult(res)
      addToast('Dry Run Finished', `Evaluated ${res.records_examined} records without modifying databases`, 'info')
    } catch (err: unknown) {
      const e = err as { message?: string }
      const msg = e?.message || 'Dry run evaluation failed'
      setDryRunError(msg)
      addToast('Dry Run Failed', msg, 'error')
    } finally {
      setDryRunning(false)
    }
  }

  const handleActivate = async () => {
    if (!draftResult) return
    try {
      await client.activateDraft(draftResult.draft.id, {
        expected_version: draftResult.draft.row_version,
      })
      addToast('Draft Activated', `Version ${draftResult.draft.version} is now the effective rule for this tenant!`, 'success')
      setDraftModalOpen(false)
      loadData(selectedKey)
    } catch (err: unknown) {
      const e = err as { message?: string }
      const msg = e?.message || 'Activation failed'
      addToast('Activation Failed', msg, 'error')
    }
  }

  const handleRollback = async () => {
    setRollingBack(true)
    try {
      const res = await client.rollbackType(selectedKey, { change_note: rollbackNote })
      addToast('Rule Rolled Back', `Restored previous effective version for ${res.key}`, 'success')
      setRollbackModalOpen(false)
      loadData(selectedKey)
    } catch (err: unknown) {
      const e = err as { message?: string }
      addToast('Rollback Failed', e?.message || 'Rollback rejected', 'error')
    } finally {
      setRollingBack(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Reconciliation Rules & Governance
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Tune field tolerances, escalation rules, and four-eyes approval thresholds with draft dry-run simulations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setRollbackModalOpen(true)}
            disabled={!canAdmin}
            title={!canAdmin ? 'Requires recon:admin scope' : 'Rollback to earlier version'}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            <span>Rollback Version</span>
          </button>

          <button
            onClick={() => {
              setDraftResult(null)
              setDryRunResult(null)
              setDraftError(null)
              setDraftModalOpen(true)
            }}
            disabled={!canAdmin}
            title={!canAdmin ? 'Requires recon:admin scope' : 'Author draft override'}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {canAdmin ? (
              <Sliders className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span>{canAdmin ? 'Tune Rule Overrides' : 'Rule Overrides (Locked)'}</span>
          </button>
        </div>
      </div>

      {/* Admin Scope Notice */}
      {!canAdmin && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-500 shrink-0" />
            <span>
              <strong>Read-Only Rule Inspection:</strong> Modifying rule tolerances, creating drafts, and activating configurations requires the <code className="font-mono bg-slate-200/60 px-1 py-0.5 rounded text-[11px]">recon:admin</code> scope.
            </span>
          </div>
        </div>
      )}

      {/* Rules Selector Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {types.map((type) => {
          const isSelected = selectedKey === type.key
          return (
            <button
              key={type.key}
              onClick={() => setSelectedKey(type.key)}
              className={`rounded-lg border px-3.5 py-2 text-left transition-all ${
                isSelected
                  ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">{type.title}</span>
                <span
                  className={`rounded px-1.5 py-0.2 text-[9px] font-mono ${
                    isSelected ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  v{type.version}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Error state */}
      {error && !loading && (
        <ErrorState
          title="Could Not Load Effective Rule Definition"
          message={error.message}
          code={error.code}
          onRetry={() => loadData(selectedKey)}
        />
      )}

      {/* Main Effective Rule View */}
      {loading ? (
        <LoadingSkeleton variant="detail" />
      ) : effectiveView ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Active Version & Definition (2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 font-mono">
                      {effectiveView.key}
                    </h3>
                    <ScopeBadge scope={effectiveView.effective.scope} />
                    <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 text-[10px] font-bold font-mono">
                      Active
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Row Version: {effectiveView.effective.row_version} &middot; Hash:{' '}
                    <span className="font-mono">{effectiveView.effective.definition_hash.substring(0, 16)}...</span>
                  </p>
                </div>

                <button
                  onClick={() => {
                    setDraftResult(null)
                    setDryRunResult(null)
                    setDraftError(null)
                    setDraftModalOpen(true)
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  Create Tenant Draft
                </button>
              </div>

              {/* Overrides Table */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Tenant Custom Overrides vs Platform Template
                </h4>
                {effectiveView.overrides.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                    No custom overrides. Currently applying baseline platform template definitions.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-mono text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Property Path</th>
                          <th className="px-3 py-2">Platform Default</th>
                          <th className="px-3 py-2">Tenant Override</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {effectiveView.overrides.map((ovr) => (
                          <tr key={ovr.path}>
                            <td className="px-3 py-2 font-semibold text-slate-800">{ovr.path}</td>
                            <td className="px-3 py-2 text-slate-500">{String(ovr.template_value)}</td>
                            <td className="px-3 py-2 text-emerald-700 font-bold">{String(ovr.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Full Rule JSON Definition */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Effective Rule Specification
                </h4>
                <JsonViewer data={effectiveView.definition} title="definition" />
              </div>
            </div>
          </div>

          {/* Right Column: Tunable Paths & Version History */}
          <div className="space-y-6">
            {/* Tunable Paths */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <Sliders className="h-4 w-4 text-slate-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Tunable Properties
                </h3>
              </div>
              <p className="text-[11px] text-slate-500">
                Safe configuration paths that tenants are authorized to override:
              </p>
              <div className="space-y-1.5 font-mono text-xs">
                {effectiveView.tunable_paths.map((path) => (
                  <div
                    key={path}
                    className="rounded bg-slate-50 px-2 py-1 text-slate-700 border border-slate-100 text-[11px]"
                  >
                    {path}
                  </div>
                ))}
              </div>
            </div>

            {/* Version History */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <History className="h-4 w-4 text-slate-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Version History
                </h3>
              </div>
              <div className="space-y-3 divide-y divide-slate-100">
                {effectiveView.versions.map((ver) => (
                  <div key={ver.id} className="pt-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-800">Version {ver.version}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[9px] font-mono uppercase ${
                          ver.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800 font-bold'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {ver.status}
                      </span>
                    </div>
                    {ver.change_note && (
                      <p className="text-slate-600 text-[11px] italic">"{ver.change_note}"</p>
                    )}
                    <p className="text-slate-400 font-mono text-[10px]">
                      Created: {new Date(ver.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create Tenant Draft & Dry Run Modal */}
      <Modal
        isOpen={draftModalOpen}
        onClose={() => setDraftModalOpen(false)}
        title="Draft & Dry-Run Rule Override"
        size="lg"
      >
        <div className="space-y-5 text-xs">
          {draftError && (
            <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-rose-800">
              <strong className="block font-semibold">Backend Error:</strong>
              <span>{draftError}</span>
            </div>
          )}

          {!draftResult ? (
            <form onSubmit={handleCreateDraft} className="space-y-4">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Target Reconciliation Type
                </label>
                <div className="font-mono text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">
                  {selectedKey}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Override Tolerance Percent (<code className="font-mono">fields.amount.tolerance.percent</code>)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tolerancePercent}
                    onChange={(e) => setTolerancePercent(e.target.value)}
                    placeholder="e.g. 0.0 or 1.0"
                    className="w-36 rounded-md border border-slate-300 p-2 font-mono text-xs text-slate-900 focus:outline-none focus:border-slate-500"
                    required
                  />
                  <span className="text-slate-500 font-mono">%</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Change Note / Justification
                </label>
                <textarea
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:border-slate-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDraftModalOpen(false)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDraft}
                  className="rounded-md bg-slate-900 px-4 py-1.5 font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingDraft ? 'Saving Draft...' : 'Create & Validate Draft'}
                </button>
              </div>
            </form>
          ) : (
            /* Draft Created: Run Dry-Run or Activate */
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span className="font-bold text-emerald-950">
                    Draft v{draftResult.draft.version} Validated Successfully
                  </span>
                </div>
                <p className="text-slate-600 text-[11px]">
                  Draft is saved in the database. Run a dry-run over historical live records to inspect potential impact before activation.
                </p>
              </div>

              {dryRunError && (
                <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-rose-800">
                  <strong className="block font-semibold">Dry Run Error:</strong>
                  <span>{dryRunError}</span>
                </div>
              )}

              {/* Dry Run Trigger / Results */}
              {dryRunResult ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <h4 className="font-bold text-slate-900 text-xs">Dry-Run Simulation Outcome</h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Records Examined</span>
                      <strong className="font-mono text-slate-900">{dryRunResult.records_examined}</strong>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Findings Added</span>
                      <strong className="font-mono text-amber-700">+{dryRunResult.findings_added}</strong>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Findings Removed</span>
                      <strong className="font-mono text-emerald-700">-{dryRunResult.findings_removed}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center space-y-2">
                  <p className="text-slate-600 text-xs">
                    Evaluate how this draft rule alters discrepancy detection over real records without persisting any changes.
                  </p>
                  <button
                    type="button"
                    onClick={handleDryRun}
                    disabled={dryRunning}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    <Play className="h-3.5 w-3.5 text-sky-400" />
                    <span>{dryRunning ? 'Evaluating Records...' : 'Execute Dry-Run Simulation'}</span>
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDraftResult(null)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit Overrides
                </button>
                <button
                  type="button"
                  onClick={handleActivate}
                  className="rounded-md bg-emerald-700 px-4 py-1.5 font-semibold text-white shadow-xs hover:bg-emerald-800"
                >
                  Activate Draft as Effective Rule
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Rollback Modal */}
      <Modal
        isOpen={rollbackModalOpen}
        onClose={() => setRollbackModalOpen(false)}
        title={`Rollback ${selectedKey} to Previous Version`}
        size="md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600">
            Retires the currently active tenant version and restores the previous active version (or baseline platform template).
          </p>
          <div>
            <label className="block font-semibold text-slate-800 mb-1">
              Rollback Audit Justification
            </label>
            <textarea
              value={rollbackNote}
              onChange={(e) => setRollbackNote(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:border-slate-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              onClick={() => setRollbackModalOpen(false)}
              className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRollback}
              disabled={rollingBack}
              className="rounded-md bg-amber-700 px-4 py-1.5 font-semibold text-white shadow-xs hover:bg-amber-800 disabled:opacity-50"
            >
              {rollingBack ? 'Rolling back...' : 'Confirm Rollback'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
