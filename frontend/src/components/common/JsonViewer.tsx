import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export const JsonViewer: React.FC<{ data: unknown; title?: string }> = ({ data, title }) => {
  const [copied, setCopied] = useState(false)
  const jsonString = JSON.stringify(data, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 overflow-hidden text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2">
        <span className="font-mono text-[11px] text-slate-400">{title || 'Payload / Raw Object'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy JSON</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 font-mono text-[11px] overflow-x-auto max-h-96 leading-relaxed text-emerald-300">
        {jsonString}
      </pre>
    </div>
  )
}

