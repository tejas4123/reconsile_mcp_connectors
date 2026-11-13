import test from 'node:test'
import assert from 'node:assert/strict'
import { mintMcpToken, mintApproverToken, verifyServerToken } from '../auth.ts'
import { getServerConfig } from '../config.ts'
import { handleApiRequest } from '../handlers.ts'

test('BFF Config - Loads defaults and enforces signing secret', () => {
  const config = getServerConfig()
  assert.ok(config.mcpUrl.includes('reconcile-mcp.onrender.com'))
  assert.equal(config.signingSecret.length > 0, true)
  assert.equal(config.issuer, 'https://auth.reconcile.local')
  assert.equal(config.audience, 'reconcile-mcp')
  assert.equal(config.defaultTenant, 'acme-india')
})

test('BFF Token Minting - Produces compliant HS256 JWT with proper claims and 5-15 min TTL', async () => {
  const token = await mintMcpToken({ sub: 'test-agent' })
  assert.ok(token)

  // Verify signature and claims using jose
  const verified = await verifyServerToken(token)
  assert.equal(verified.sub, 'test-agent')
  assert.equal(verified.iss, 'https://auth.reconcile.local')
  assert.equal(verified.aud, 'reconcile-mcp')
  assert.equal(verified.tenant, 'acme-india')

  // Check scopes - ensure automated identity NEVER receives recon:approve
  const scopes = String(verified.scope || '').split(' ')
  assert.ok(scopes.includes('recon:read'))
  assert.ok(scopes.includes('recon:run'))
  assert.ok(scopes.includes('recon:propose'))
  assert.ok(scopes.includes('recon:apply'))
  assert.equal(scopes.includes('recon:approve'), false, 'Automated operator MUST NOT carry recon:approve scope')

  // Check TTL (between 5 and 15 minutes, or 300 to 900 seconds)
  const now = Math.floor(Date.now() / 1000)
  const exp = verified.exp as number
  const ttl = exp - now
  assert.ok(ttl >= 290 && ttl <= 910, `TTL ${ttl}s outside expected 5-15 min range`)
})

test('BFF Approver Token - Enforces four-eyes separation of duties', async () => {
  const approverToken = await mintApproverToken({ sub: 'human-controller@acme-india' })
  assert.ok(approverToken)

  const verified = await verifyServerToken(approverToken)
  assert.equal(verified.sub, 'human-controller@acme-india')
  assert.equal(verified.tenant, 'acme-india')

  const scopes = String(verified.scope || '').split(' ')
  assert.ok(scopes.includes('recon:approve'), 'Approver identity must carry recon:approve')
  assert.ok(scopes.includes('recon:read'))
  assert.equal(scopes.includes('recon:run'), false, 'Approver identity does not run automated sweeps')
})

test('BFF Handlers - Rejects resolution application without explicit confirmation', async () => {
  // Test POST /api/reconciliation/proposals/:id/apply with confirmed: false
  const unconfirmedReq = new Request('http://localhost/api/reconciliation/proposals/prop-12345/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed: false }),
  })

  const res = await handleApiRequest(unconfirmedReq)
  assert.equal(res.status, 400)
  const body = (await res.json()) as any
  assert.equal(body.error?.code, 'CONFIRMATION_REQUIRED')
  assert.ok(body.error?.message?.includes('Explicit user confirmation'))
})

test('BFF Handlers - Health check returns structured response', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = async (input: string | URL | Request) => {
    const urlStr = input.toString()
    if (urlStr.includes('/readyz')) {
      return new Response(JSON.stringify({ status: 'ready', worker_last_seen_seconds: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200 })
  }

  try {
    const healthReq = new Request('http://localhost/api/health', {
      method: 'GET',
    })

    const res = await handleApiRequest(healthReq)
    assert.equal(res.status, 200)
    const body = (await res.json()) as any
    assert.equal(body.status, 'ready')
    assert.equal(body.live, true)
    assert.equal(body.bff, 'online')
    assert.equal(body.tenant, 'acme-india')
  } finally {
    globalThis.fetch = origFetch
  }
})
