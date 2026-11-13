import React, { useState, useEffect } from 'react'
import { Sparkles, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react'
import type { McpTool, McpToolInputSchema } from '../../lib/mcp/mcp-types.ts'

interface DynamicSchemaFormProps {
  tool: McpTool
  onSubmit: (args: Record<string, unknown>) => void
  isExecuting: boolean
  lastUsedArgs?: Record<string, unknown>
}

export const DynamicSchemaForm: React.FC<DynamicSchemaFormProps> = ({
  tool,
  onSubmit,
  isExecuting,
  lastUsedArgs,
}) => {
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [jsonFieldErrors, setJsonFieldErrors] = useState<Record<string, string>>({})
  const [rawJsonTexts, setRawJsonTexts] = useState<Record<string, string>>({})

  const schema: McpToolInputSchema = tool.inputSchema || { type: 'object' }
  const properties = schema.properties || {}
  const requiredFields = new Set(schema.required || [])

  // Initialize or reset form values when tool changes
  useEffect(() => {
    const initialData: Record<string, unknown> = {}
    const initialRawTexts: Record<string, string> = {}

    for (const [key, prop] of Object.entries(properties)) {
      if (lastUsedArgs && lastUsedArgs[key] !== undefined) {
        initialData[key] = lastUsedArgs[key]
        if (typeof lastUsedArgs[key] === 'object' && lastUsedArgs[key] !== null) {
          initialRawTexts[key] = JSON.stringify(lastUsedArgs[key], null, 2)
        }
      } else if (prop.default !== undefined) {
        initialData[key] = prop.default
        if (typeof prop.default === 'object' && prop.default !== null) {
          initialRawTexts[key] = JSON.stringify(prop.default, null, 2)
        }
      } else if (prop.type === 'object') {
        initialRawTexts[key] = ''
      } else if (prop.type === 'boolean') {
        initialData[key] = false
      } else {
        initialData[key] = ''
      }
    }

    setFormData(initialData)
    setRawJsonTexts(initialRawTexts)
    setJsonFieldErrors({})
  }, [tool.name, lastUsedArgs])

  const handleFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  const handleJsonFieldChange = (key: string, rawText: string) => {
    setRawJsonTexts((prev) => ({ ...prev, [key]: rawText }))

    if (!rawText.trim()) {
      setJsonFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setFormData((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      return
    }

    try {
      const parsed = JSON.parse(rawText)
      setJsonFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setFormData((prev) => ({ ...prev, [key]: parsed }))
    } catch (err) {
      setJsonFieldErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'Invalid JSON format',
      }))
    }
  }

  const applyPreset = (presetValues: Record<string, unknown>) => {
    const newForm = { ...formData, ...presetValues }
    const newRaw = { ...rawJsonTexts }

    for (const [k, v] of Object.entries(presetValues)) {
      if (typeof v === 'object' && v !== null) {
        newRaw[k] = JSON.stringify(v, null, 2)
      }
    }

    setFormData(newForm)
    setRawJsonTexts(newRaw)
    setJsonFieldErrors({})
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate that there are no unparsed JSON errors
    if (Object.keys(jsonFieldErrors).length > 0) {
      return
    }

    // Filter out empty optional values
    const cleanArgs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(formData)) {
      if (v === '' || v === undefined) {
        if (requiredFields.has(k)) {
          cleanArgs[k] = v
        }
      } else {
        cleanArgs[k] = v
      }
    }

    onSubmit(cleanArgs)
  }

  const renderPresets = () => {
    if (tool.name === 'start_reconciliation') {
      const genKey = () => `recon-${Date.now().toString(36)}`
      return (
        <div className="flex flex-wrap items-center gap-2 pt-1 pb-3 text-xs border-b border-slate-100">
          <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-500" /> Presets:
          </span>
          <button
            type="button"
            onClick={() =>
              applyPreset({
                reconciliation_type: 'invoice_to_po',
                idempotency_key: genKey(),
                source_refs: { invoice: 'INV-2026-0042' },
              })
            }
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors"
          >
            Invoice vs PO (INV-2026-0042)
          </button>
          <button
            type="button"
            onClick={() =>
              applyPreset({
                reconciliation_type: 'vendor_certificate_compliance',
                idempotency_key: genKey(),
                source_refs: { vendor_id: 'V-1001' },
              })
            }
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors"
          >
            Vendor Compliance (V-1001)
          </button>
        </div>
      )
    }

    if (tool.name === 'propose_resolution') {
      return (
        <div className="flex flex-wrap items-center gap-2 pt-1 pb-3 text-xs border-b border-slate-100">
          <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-500" /> Presets:
          </span>
          <button
            type="button"
            onClick={() =>
              applyPreset({
                action: 'HOLD_PAYMENT',
                params: { hold_reason: 'Discrepancy exceeds tolerance threshold' },
                rationale: 'Protect against cash leakage while vendor clarifies line item variance',
                idempotency_key: `prop-${Date.now().toString(36)}`,
              })
            }
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors"
          >
            Hold Payment Action
          </button>
          <button
            type="button"
            onClick={() =>
              applyPreset({
                action: 'REQUEST_CREDIT_NOTE',
                params: { requested_amount: '1250.00' },
                rationale: 'Overbilling detected against approved purchase order unit rate',
                idempotency_key: `prop-${Date.now().toString(36)}`,
              })
            }
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors"
          >
            Request Credit Note
          </button>
        </div>
      )
    }

    return null
  }

  const propKeys = Object.keys(properties)

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {renderPresets()}

      {propKeys.length === 0 ? (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-xs font-mono">
          This tool takes no parameters. Ready to execute.
        </div>
      ) : (
        <div className="space-y-3.5">
          {propKeys.map((key) => {
            const prop = properties[key]
            const isRequired = requiredFields.has(key)
            const fieldType = prop.type || 'string'
            const currentVal = formData[key]
            const hasJsonError = jsonFieldErrors[key]

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor={`field-${key}`} className="font-mono text-xs font-bold text-slate-800">
                    {key}
                    {isRequired && <span className="text-rose-500 ml-1">*</span>}
                  </label>
                  <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    {fieldType}
                    {isRequired ? ' · required' : ' · optional'}
                  </span>
                </div>

                {prop.description && (
                  <p className="text-[11px] text-slate-500 leading-tight">{prop.description}</p>
                )}

                {/* Render by schema property type */}
                {prop.enum && prop.enum.length > 0 ? (
                  <select
                    id={`field-${key}`}
                    value={String(currentVal ?? '')}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    required={isRequired}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  >
                    <option value="">-- Select {key} --</option>
                    {prop.enum.map((opt) => (
                      <option key={String(opt)} value={String(opt)}>
                        {String(opt)}
                      </option>
                    ))}
                  </select>
                ) : fieldType === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      id={`field-${key}`}
                      checked={Boolean(currentVal)}
                      onChange={(e) => handleFieldChange(key, e.target.checked)}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4"
                    />
                    <span className="text-xs text-slate-700 font-mono">
                      {Boolean(currentVal) ? 'True' : 'False'}
                    </span>
                  </label>
                ) : fieldType === 'object' || fieldType === 'array' ? (
                  <div className="space-y-1">
                    <textarea
                      id={`field-${key}`}
                      rows={3}
                      value={rawJsonTexts[key] ?? ''}
                      onChange={(e) => handleJsonFieldChange(key, e.target.value)}
                      placeholder={fieldType === 'object' ? '{\n  "key": "value"\n}' : '["item1", "item2"]'}
                      className={`w-full p-2.5 bg-slate-950 text-slate-100 border rounded font-mono text-xs focus:outline-none ${
                        hasJsonError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {hasJsonError && (
                      <p className="flex items-center gap-1 text-[11px] text-rose-600 font-mono">
                        <AlertCircle className="h-3 w-3" />
                        <span>Syntax Error: {hasJsonError}</span>
                      </p>
                    )}
                  </div>
                ) : fieldType === 'integer' || fieldType === 'number' ? (
                  <input
                    type="number"
                    id={`field-${key}`}
                    value={currentVal !== undefined && currentVal !== null ? String(currentVal) : ''}
                    onChange={(e) =>
                      handleFieldChange(key, e.target.value === '' ? '' : Number(e.target.value))
                    }
                    required={isRequired}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                ) : (
                  <input
                    type="text"
                    id={`field-${key}`}
                    value={String(currentVal ?? '')}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    required={isRequired}
                    placeholder={`Enter ${key}...`}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-200">
        <button
          type="button"
          onClick={() => {
            const initialData: Record<string, unknown> = {}
            for (const key of Object.keys(properties)) {
              initialData[key] = ''
            }
            setFormData(initialData)
            setRawJsonTexts({})
            setJsonFieldErrors({})
          }}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 font-medium px-2 py-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset Form</span>
        </button>

        <button
          type="submit"
          disabled={isExecuting || Object.keys(jsonFieldErrors).length > 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
        >
          {isExecuting ? (
            <>
              <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Executing via MCP...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Execute {tool.name}</span>
            </>
          )}
        </button>
      </div>
    </form>
  )
}

