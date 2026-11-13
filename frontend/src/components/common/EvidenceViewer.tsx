import React, { useState } from 'react'
import { Check, Copy, FileText, ShieldCheck } from 'lucide-react'
import type { EvidenceView } from '../../types/index.ts'

export const EvidenceViewer: React.FC<{ evidence: EvidenceView[] }> = ({ evidence }) => {
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash)
    setCopiedHash(hash)
    setTimeout(() => setCopiedHash(null), 2000)
  }

  if (evidence.length === 0) {
    return <div className="p-4 text-xs text-slate-500">No supporting evidence recorded for this item.</div>
  }

  return (
    <div className="space-y-4">
      {evidence.map((item, idx) => (
        <div key={idx} className="rounded-lg border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                  item.side === 'a' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                }`}
              >
                Source {item.side.toUpperCase()}
              </span>
              <span className="text-xs font-semibold text-slate-900 font-mono">
                {item.source_system}:{item.record_id}
              </span>
              <span className="text-xs text-slate-400">({item.entity_type})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 font-mono">
                {new Date(item.observed_at).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Field Path</span>
                <span className="font-mono font-medium text-slate-800">{item.field_path}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Observed Value</span>
                <span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                  {String(item.observed_value ?? 'null')}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Data Source</span>
                <span className="font-mono text-slate-700">{item.data_source}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Record Version</span>
                <span className="font-mono text-slate-700">{item.record_version}</span>
              </div>
            </div>

            {/* Document Reference & Excerpt if available */}
            {item.document_ref && (
              <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
                  <FileText className="h-4 w-4 text-amber-700" />
                  <span>Document Citation:</span>
                  <code className="text-xs font-mono text-amber-800 bg-amber-100/70 px-1.5 py-0.5 rounded">
                    {item.document_ref}
                  </code>
                </div>
                {item.excerpt && (
                  <div className="mt-2 pl-3 border-l-2 border-amber-400 font-mono text-xs text-slate-800 bg-white/70 p-2 rounded">
                    "{item.excerpt}"
                  </div>
                )}
              </div>
            )}

            {/* Cryptographic Content Hash verification */}
            <div className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-[11px] border border-slate-200/60">
              <div className="flex items-center gap-1.5 text-slate-500 font-mono truncate max-w-md">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-slate-400">Content Hash:</span>
                <span className="truncate">{item.content_hash}</span>
              </div>
              <button
                onClick={() => copyHash(item.content_hash)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-900 font-medium ml-2 shrink-0"
              >
                {copiedHash === item.content_hash ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
