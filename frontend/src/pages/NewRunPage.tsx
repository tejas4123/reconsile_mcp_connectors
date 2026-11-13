import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  Loader2,
  Play,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useApi } from '../api/context.tsx'
import type { DiscrepancySummary, StartReconciliationResult, StartRunRequest } from '../types/index.ts'
import { RunStatusBadge } from '../components/common/Badge.tsx'

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

interface ReconciliationOption {
  key: string
  title: string
  description: string
  systems: string
  icon: typeof FileCheck2
  fieldLabel: string
  fieldPlaceholder: string
  fieldHelp: string
  demoValue: string
  roleName: string
}

const DEFAULT_OPTIONS: ReconciliationOption[] = [
  {
    key: 'invoice_to_po',
    title: 'Invoice vs Purchase Order',
    description: 'Match supplier invoice line items, unit prices, and taxes against authorized Purchase Orders.',
    systems: 'ERP & Billing Systems',
    icon: FileCheck2,
    fieldLabel: 'Invoice Reference Number',
    fieldPlaceholder: 'e.g. INV-2026-0042',
    fieldHelp: 'Enter the supplier invoice reference to reconcile against ERP purchase orders.',
    demoValue: 'INV-2026-0042',
    roleName: 'invoice',
  },
  {
    key: 'vendor_certificate_compliance',
    title: 'Vendor Compliance',
    description: 'Verify supplier tax standing, registration certificates, and compliance regulatory policies.',
    systems: 'Procurement & Tax Registry',
    icon: ShieldCheck,
    fieldLabel: 'Vendor Master Code / Tax ID',
    fieldPlaceholder: 'e.g. V-1001',
    fieldHelp: 'Enter the vendor identifier to audit compliance and certificate records.',
    demoValue: 'V-1001',
    roleName: 'vendor',
  },
  {
    key: 'contract_to_crm',
    title: 'Contract vs CRM',
    description: 'Cross-reference executed customer contracts against closed CRM opportunities and deal terms.',
    systems: 'Contract Vault & CRM',
    icon: ArrowRightLeft,
    fieldLabel: 'Contract Document Reference',
    fieldPlaceholder: 'e.g. CON-2026-88',
    fieldHelp: 'Enter the executed contract number to verify against CRM milestones.',
    demoValue: 'CON-2026-88',
    roleName: 'contract',
  },
  {
    key: 'contract_to_erp',
    title: 'Contract vs ERP',
    description: 'Ensure recurring billing schedules and milestones match general ledger accounting entries.',
    systems: 'Contracts & Financial Ledger',
    icon: Scale,
    fieldLabel: 'Contract Agreement Reference',
    fieldPlaceholder: 'e.g. CON-2026-88',
    fieldHelp: 'Enter the contract reference to audit ERP billing schedules.',
    demoValue: 'CON-2026-88',
    roleName: 'contract',
  },
]

export const NewRunPage: React.FC = () => {
  const { client, addToast } = useApi()

  const [options, setOptions] = useState<ReconciliationOption[]>(DEFAULT_OPTIONS)
  const [selectedKey, setSelectedKey] = useState<string>('invoice_to_po')
  const [recordId, setRecordId] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [loadingStage, setLoadingStage] = useState<string>('')
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [result, setResult] = useState<StartReconciliationResult | null>(null)
  const [discrepancies, setDiscrepancies] = useState<DiscrepancySummary[]>([])

  // Advanced settings toggle
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [batchLimit, setBatchLimit] = useState(100)

  // Dynamically load workflow types from backend MCP resource reconciliation://types
  useEffect(() => {
    async function loadTypes() {
      try {
        const types = await client.getReconciliationTypes()
        if (Array.isArray(types) && types.length > 0) {
          const mapped = DEFAULT_OPTIONS.map((opt) => {
            const found = types.find((t) => t.key === opt.key)
            if (found) {
              const reqRefs = found.source_refs_required || {}
              const firstRole = Object.keys(reqRefs)[0] || opt.roleName
              return {
                ...opt,
                title: found.title || opt.title,
                description: found.description || opt.description,
                roleName: firstRole,
                fieldHelp: reqRefs[firstRole] || opt.fieldHelp,
              }
            }
            return opt
          })
          setOptions(mapped)
        }
      } catch {
        // Fallback to DEFAULT_OPTIONS if offline
      }
    }
    loadTypes()
  }, [client])

  const activeOption =
    options.find((opt) => opt.key === selectedKey) || options[0]

  const handleSelectOption = (option: ReconciliationOption) => {
    setSelectedKey(option.key)
    setRecordId('')
    setError(null)
    setResult(null)
    setDiscrepancies([])
  }

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedId = recordId.trim()
    if (!trimmedId) {
      setError({ message: `Please enter a valid ${activeOption.fieldLabel.toLowerCase()}.` })
      return
    }

    setError(null)
    setSubmitting(true)
    setResult(null)
    setDiscrepancies([])

    setLoadingStage('Connecting to ERP & Invoicing systems via MCP...')
    const stageTimer1 = setTimeout(() => {
      setLoadingStage('Extracting records and comparing line items...')
    }, 900)
    const stageTimer2 = setTimeout(() => {
      setLoadingStage('Evaluating matching tolerances and business policies...')
    }, 1800)

    try {
      const payload: StartRunRequest = {
        reconciliation_type: selectedKey,
        idempotency_key: generateUUID(),
        source_refs: {
          [activeOption.roleName]: trimmedId,
        },
      }

      const res = await client.startRun(payload)
      setResult(res)

      if (res.discrepancy_count > 0) {
        try {
          const discRes = await client.listRunDiscrepancies(res.run_id)
          setDiscrepancies(discRes.items || [])
        } catch {
          // Fallback if listing fails
        }
      }

      addToast(
        'Reconciliation Executed',
        `Reconciliation completed with status: ${res.status.replace(/_/g, ' ')}`,
        'success'
      )
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      const msg = e?.message || 'Failed to trigger reconciliation run'
      setError({ message: msg, code: e?.code || 'EXECUTION_FAILED' })
      addToast('Execution Failed', msg, 'error')
    } finally {
      clearTimeout(stageTimer1)
      clearTimeout(stageTimer2)
      setSubmitting(false)
      setLoadingStage('')
    }
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          New Business Reconciliation
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Follow 3 simple steps to compare and verify records across your connected systems.
        </p>
      </div>

      {/* STEP 1: Select What to Reconcile */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-bold">
            1
          </div>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Select What to Reconcile
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {options.map((option) => {
            const isSelected = option.key === selectedKey
            const Icon = option.icon
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => handleSelectOption(option)}
                className={`relative flex flex-col p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-slate-900 bg-slate-50/80 shadow-xs ring-1 ring-slate-900'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      isSelected
                        ? 'bg-slate-900 text-emerald-400'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  {isSelected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>

                <div className="mt-3">
                  <h3 className="text-sm font-bold text-slate-900">{option.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                    {option.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] font-medium text-slate-400">
                  Systems: <span className="text-slate-600">{option.systems}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* STEP 2: Enter Relevant Business Record Identifier */}
      <form onSubmit={handleStart} className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-bold">
              2
            </div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Enter Business Record Identifier
            </h2>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">
                {activeOption.fieldLabel}
              </label>
              <p className="text-xs text-slate-500 mb-2">
                {activeOption.fieldHelp}
              </p>
              <div className="relative">
                <input
                  type="text"
                  value={recordId}
                  onChange={(e) => {
                    setRecordId(e.target.value)
                    setError(null)
                  }}
                  placeholder={activeOption.fieldPlaceholder}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-colors"
                />
              </div>
            </div>

            {/* Helper Chip to populate demo record if desired */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-slate-400">Sample Reference:</span>
              <button
                type="button"
                onClick={() => {
                  setRecordId(activeOption.demoValue)
                  setError(null)
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span>Fill {activeOption.demoValue}</span>
              </button>
            </div>
          </div>
        </div>

        {/* STEP 3: Start Reconciliation */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-bold">
              3
            </div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Execute Reconciliation
            </h2>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
              <p className="font-bold">Execution Error</p>
              <p className="mt-0.5">{error.message}</p>
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2.5 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 transition-all active:scale-[0.99] cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                  <span>Processing Reconciliation...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 text-emerald-400 fill-emerald-400" />
                  <span>Start Reconciliation</span>
                </>
              )}
            </button>

            {result && (
              <button
                type="button"
                onClick={() => {
                  setResult(null)
                  setDiscrepancies([])
                  setRecordId('')
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Run Another</span>
              </button>
            )}
          </div>

          {/* Loading Animation Card with Stages */}
          {submitting && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs text-center space-y-3 animate-pulse">
              <Loader2 className="h-8 w-8 animate-spin text-slate-900 mx-auto" />
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {loadingStage || 'Reconciling across systems...'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Connecting to Render MCP server and executing Neon PostgreSQL queries
                </p>
              </div>
            </div>
          )}
        </div>
      </form>

      {/* EXECUTIVE RESULT SUMMARY CARD - Displays actual backend outcome */}
      {result && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Reconciliation Result
                </span>
                <RunStatusBadge status={result.status} size="sm" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-1">
                {result.discrepancy_count > 0
                  ? `Completed with ${result.discrepancy_count} Discrepancy Found`
                  : 'Reconciliation Completed — All Records Matched'}
              </h3>
            </div>

            <Link
              to={`/runs/${result.run_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition-colors self-start sm:self-auto"
            >
              <span>View Full Analysis</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Business Comparison Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 rounded-xl p-4 text-xs">
            <div>
              <span className="text-slate-400 font-medium">Reconciled Item</span>
              <p className="font-mono font-bold text-slate-900 mt-0.5">{recordId || 'Batch Run'}</p>
            </div>
            <div>
              <span className="text-slate-400 font-medium">Reconciliation Type</span>
              <p className="font-bold text-slate-900 mt-0.5">{activeOption.title}</p>
            </div>
            <div>
              <span className="text-slate-400 font-medium">Action Required</span>
              <p className="font-bold text-slate-900 mt-0.5">
                {result.discrepancy_count > 0
                  ? 'Controller Review & Sign-Off'
                  : 'None — Fully Reconciled'}
              </p>
            </div>
          </div>

          {/* Highlight if discrepancies detected */}
          {discrepancies.length > 0 && (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider">
                <AlertOctagon className="h-4 w-4 text-amber-600" />
                <span>Detected Discrepancies ({discrepancies.length})</span>
              </div>

              <div className="space-y-2">
                {discrepancies.map((d) => (
                  <div
                    key={d.discrepancy_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white rounded-lg border border-amber-200/60 text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-900">
                        {d.field ? `Field: ${d.field}` : 'Record Variance'}
                      </span>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Severity: <span className="font-semibold text-amber-700">{d.severity}</span> • Status: <span className="font-semibold text-slate-700">{d.status}</span>
                      </p>
                    </div>

                    <Link
                      to={`/exceptions/${d.discrepancy_id}`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 hover:text-emerald-600 transition-colors self-start sm:self-auto"
                    >
                      <span>Resolve Exception</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advanced Settings Accordion */}
      <div className="pt-4 border-t border-slate-200/60">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              showAdvanced ? 'rotate-180' : ''
            }`}
          />
          <span>Advanced Batch & Filter Options (Optional)</span>
        </button>

        {showAdvanced && (
          <div className="mt-3 p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Batch Record Limit
              </label>
              <input
                type="number"
                value={batchLimit}
                onChange={(e) => setBatchLimit(Number(e.target.value))}
                min={1}
                max={500}
                className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Maximum records evaluated in batch execution mode.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
