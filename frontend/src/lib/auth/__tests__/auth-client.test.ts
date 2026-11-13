import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectJwt } from '../auth-client.ts'

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function createMockJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const mockSignature = base64UrlEncode('mock_signature_bytes')
  return `${encodedHeader}.${encodedPayload}.${mockSignature}`
}

test('inspectJwt() - successfully parses a valid enterprise token with scopes', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const token = createMockJwt({
    iss: 'https://auth.reconcile.local',
    aud: 'reconcile-mcp',
    sub: 'analyst@acme-india.example',
    tenant: 'acme-india',
    scope: 'recon:read recon:run recon:approve',
    exp: futureExp,
    iat: futureExp - 3600,
  })

  const result = inspectJwt(token)
  assert.equal(result.valid, true)
  assert.ok(result.claims)
  assert.equal(result.claims?.sub, 'analyst@acme-india.example')
  assert.equal(result.claims?.tenant, 'acme-india')
  assert.deepEqual(result.claims?.scopes, ['recon:read', 'recon:run', 'recon:approve'])
  assert.equal(result.claims?.exp, futureExp)
})

test('inspectJwt() - detects and rejects expired tokens', () => {
  const pastExp = Math.floor(Date.now() / 1000) - 120
  const token = createMockJwt({
    iss: 'https://auth.reconcile.local',
    aud: 'reconcile-mcp',
    sub: 'expired_user',
    tenant: 'acme-india',
    scope: 'recon:read',
    exp: pastExp,
  })

  const result = inspectJwt(token)
  assert.equal(result.valid, false)
  assert.equal(result.isExpired, true)
  assert.ok(result.error?.includes('expired'))
})

test('inspectJwt() - rejects malformed tokens without 3 segments', () => {
  const result = inspectJwt('not.a.valid.jwt.segment.count')
  assert.equal(result.valid, false)
  assert.ok(result.error?.includes('Malformed JWT'))
})

test('inspectJwt() - rejects tokens missing required subject', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const token = createMockJwt({
    iss: 'https://auth.reconcile.local',
    tenant: 'acme-india',
    exp: futureExp,
  })

  const result = inspectJwt(token)
  assert.equal(result.valid, false)
  assert.ok(result.error?.includes('sub'))
})

test('inspectJwt() - rejects tokens missing tenant claim', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const token = createMockJwt({
    iss: 'https://auth.reconcile.local',
    sub: 'user_without_tenant',
    exp: futureExp,
  })

  const result = inspectJwt(token)
  assert.equal(result.valid, false)
  assert.ok(result.error?.includes('tenant'))
})

test('inspectJwt() - parses alternate array formatted scopes', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600
  const token = createMockJwt({
    iss: 'https://auth.reconcile.local',
    sub: 'admin_user',
    tenant: 'globex',
    scp: ['recon:read', 'recon:admin'],
    exp: futureExp,
  })

  const result = inspectJwt(token)
  assert.equal(result.valid, true)
  assert.deepEqual(result.claims?.scopes, ['recon:read', 'recon:admin'])
})

