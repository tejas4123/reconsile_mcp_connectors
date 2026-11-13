import React, { useState } from 'react'
import { Check, Copy, ExternalLink, Lock, Search } from 'lucide-react'
import { useApi } from '../api/context.tsx'

interface EndpointDoc {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  title: string
  scope: string
  description: string
  requestSchema?: string
  responseSchema: string
  exampleCurl: string
}

export const ApiDocsPage: React.FC = () => {
  const { client, addToast } = useApi()
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const endpoints: EndpointDoc[] = [
    {
      method: 'GET',
      path: '/api/v1/stats',
      title: 'Get Dashboard Aggregate Statistics',
      scope: 'recon:read',
      description: 'Live counts for the caller tenant (runs, severity breakdowns, pending proposals).',
      responseSchema: 'StatsView',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" ${client.getBaseUrl()}/api/v1/stats`,
    },
    {
      method: 'GET',
      path: '/api/v1/types',
      title: 'List Reconciliation Types',
      scope: 'recon:read',
      description: 'All reconciliation workflows configured for this tenant with required source refs.',
      responseSchema: 'list[ReconciliationTypeView]',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" ${client.getBaseUrl()}/api/v1/types`,
    },
    {
      method: 'GET',
      path: '/api/v1/runs',
      title: 'List Reconciliation Runs',
      scope: 'recon:read',
      description: 'Paginated list of reconciliation runs with optional status and type filters.',
      responseSchema: 'RunPage',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" "${client.getBaseUrl()}/api/v1/runs?status=COMPLETED_WITH_DISCREPANCIES&limit=25"`,
    },
    {
      method: 'POST',
      path: '/api/v1/runs',
      title: 'Start Reconciliation Run',
      scope: 'recon:run',
      description: 'Trigger immediate single-record inline run or batch selection queued for worker.',
      requestSchema: 'StartRunRequest { reconciliation_type, idempotency_key, source_refs?, selection? }',
      responseSchema: 'StartReconciliationResult (201 Created)',
      exampleCurl: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"reconciliation_type": "invoice_to_po", "idempotency_key": "uuid-here", "source_refs": {"invoice": "INV-2026-0042"}}' \\
  ${client.getBaseUrl()}/api/v1/runs`,
    },
    {
      method: 'GET',
      path: '/api/v1/runs/{run_id}',
      title: 'Get Run Status & Findings',
      scope: 'recon:read',
      description: 'Retrieve execution status, record comparison counts, timing, and error state for a run.',
      responseSchema: 'RunStatusResult',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" ${client.getBaseUrl()}/api/v1/runs/8f92b7e1-3140-4e2b-bb6e-82193b2a0001`,
    },
    {
      method: 'GET',
      path: '/api/v1/runs/{run_id}/discrepancies',
      title: 'List Run Discrepancies',
      scope: 'recon:read',
      description: 'Returns discrepancy records found in this run with severity, differences, and recommended actions.',
      responseSchema: 'DiscrepancyPage',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" ${client.getBaseUrl()}/api/v1/runs/8f92b7e1-3140-4e2b-bb6e-82193b2a0001/discrepancies`,
    },
    {
      method: 'GET',
      path: '/api/v1/discrepancies/{discrepancy_id}',
      title: 'Explain Discrepancy (Deterministic Root Cause)',
      scope: 'recon:read',
      description: 'Returns root cause explanation, rule fired, derivations, matching diagnostics, and allowed actions.',
      responseSchema: 'DiscrepancyExplanation',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" ${client.getBaseUrl()}/api/v1/discrepancies/d1000000-0000-0000-0000-000000000001`,
    },
    {
      method: 'GET',
      path: '/api/v1/proposals',
      title: 'List Proposals Awaiting Approval',
      scope: 'recon:read | recon:approve',
      description: 'Human approval queue for the caller tenant (default: proposals awaiting approval).',
      responseSchema: 'list[ProposalResult]',
      exampleCurl: `curl -H "Authorization: Bearer $TOKEN" "${client.getBaseUrl()}/api/v1/proposals?status=AWAITING_APPROVAL"`,
    },
    {
      method: 'POST',
      path: '/api/v1/proposals/{proposal_id}/decision',
      title: 'Authorize or Reject Proposal (Four-Eyes)',
      scope: 'recon:approve',
      description: 'Approve or reject a resolution proposal. The original proposer can never decide.',
      requestSchema: 'DecisionRequest { decision: "APPROVED"|"REJECTED", comment?, expected_version }',
      responseSchema: 'ProposalResult (409 Conflict if SUPERSEDED)',
      exampleCurl: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"decision": "APPROVED", "comment": "Authorized by Controller", "expected_version": 1}' \\
  ${client.getBaseUrl()}/api/v1/proposals/p1000000-0000-0000-0000-000000000001/decision`,
    },
    {
      method: 'POST',
      path: '/api/v1/admin/drafts/{draft_id}/dry-run',
      title: 'Dry-Run Rule Draft Over Live Records',
      scope: 'recon:admin',
      description: 'Simulates draft rule changes over live records without persisting any changes.',
      requestSchema: 'DryRunRequest { selection: Selection }',
      responseSchema: 'DryRunResult',
      exampleCurl: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"selection": {"limit": 100}}' \\
  ${client.getBaseUrl()}/api/v1/admin/drafts/draft-id/dry-run`,
    },
  ]

  const filtered = endpoints.filter(
    (e) =>
      e.path.toLowerCase().includes(search.toLowerCase()) ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase())
  )

  const copyCurl = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    addToast('Curl Command Copied', 'Sample request copied to clipboard', 'info')
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            HTTP REST API Reference
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Enterprise OpenAPI specification for human approval and configuration endpoints.
          </p>
        </div>

        <a
          href={`${client.getBaseUrl()}/docs`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
        >
          <span>Open Interactive Swagger</span>
          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
        </a>
      </div>

      {/* Filter Box */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search endpoint path, title, or scope..."
            className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-4">
        {filtered.map((ep, idx) => {
          const isGet = ep.method === 'GET'
          const isPost = ep.method === 'POST'
          const isDelete = ep.method === 'DELETE'

          return (
            <div
              key={idx}
              className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-mono font-bold uppercase tracking-wider ${
                      isGet
                        ? 'bg-blue-100 text-blue-800'
                        : isPost
                        ? 'bg-emerald-100 text-emerald-800'
                        : isDelete
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <span className="font-mono font-bold text-xs text-slate-900">{ep.path}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                    <Lock className="h-3 w-3 text-slate-400" />
                    <span>{ep.scope}</span>
                  </span>
                </div>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{ep.title}</h3>
                  <p className="mt-1 text-slate-600 leading-relaxed">{ep.description}</p>
                </div>

                {ep.requestSchema && (
                  <div className="pt-1">
                    <span className="text-slate-400 block text-[11px] font-semibold">Request Body:</span>
                    <code className="text-xs font-mono text-slate-800 bg-slate-50 p-1.5 rounded block border border-slate-200/80 mt-1">
                      {ep.requestSchema}
                    </code>
                  </div>
                )}

                <div>
                  <span className="text-slate-400 block text-[11px] font-semibold">Response Model:</span>
                  <code className="text-xs font-mono text-emerald-800 bg-emerald-50/50 p-1 rounded border border-emerald-200/60 inline-block mt-0.5">
                    {ep.responseSchema}
                  </code>
                </div>

                {/* Example Curl Box */}
                <div className="pt-2">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Sample Request
                    </span>
                    <button
                      onClick={() => copyCurl(ep.exampleCurl, idx)}
                      className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 font-medium"
                    >
                      {copiedIdx === idx ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          <span className="text-emerald-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy cURL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="rounded-lg bg-slate-900 text-slate-200 p-3 font-mono text-[11px] overflow-x-auto">
                    {ep.exampleCurl}
                  </pre>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
