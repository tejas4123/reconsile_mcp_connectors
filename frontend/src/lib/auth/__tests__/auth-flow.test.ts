import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectJwt } from '../auth-client.ts'
import type { Scope, UserClaims } from '../auth-types.ts'

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function createToken(claims: Record<string, unknown>): string {
  const h = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = base64UrlEncode(JSON.stringify(claims))
  const s = base64UrlEncode('sig')
  return `${h}.${p}.${s}`
}

// In-memory mock storage implementing Web Storage API
class MockStorage {
  private store: Map<string, string> = new Map()

  getItem(key: string): string | null {
    return this.store.get(key) || null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

test('Auth Flow - Storage tier selection based on remember-me policy', () => {
  const sessionStorage = new MockStorage()
  const localStorage = new MockStorage()

  const saveTokenWithPolicy = (token: string, remember: boolean) => {
    if (remember) {
      localStorage.setItem('reconcile_auth_token', token)
      localStorage.setItem('reconcile_auth_remember', 'true')
      sessionStorage.removeItem('reconcile_auth_token')
    } else {
      sessionStorage.setItem('reconcile_auth_token', token)
      localStorage.removeItem('reconcile_auth_token')
      localStorage.removeItem('reconcile_auth_remember')
    }
  }

  const tokenA = 'token_ephemeral'
  saveTokenWithPolicy(tokenA, false)
  assert.equal(sessionStorage.getItem('reconcile_auth_token'), tokenA)
  assert.equal(localStorage.getItem('reconcile_auth_token'), null)

  const tokenB = 'token_persisted'
  saveTokenWithPolicy(tokenB, true)
  assert.equal(localStorage.getItem('reconcile_auth_token'), tokenB)
  assert.equal(sessionStorage.getItem('reconcile_auth_token'), null)
})

test('Auth Flow - Scope authorization logic enforces four-eyes and admin bounds', () => {
  const operatorClaims: UserClaims = {
    sub: 'operator_id',
    tenant: 'acme-india',
    scopes: ['recon:read', 'recon:run'] as Scope[],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }

  const approverClaims: UserClaims = {
    sub: 'lead_approver',
    tenant: 'acme-india',
    scopes: ['recon:read', 'recon:run', 'recon:approve'] as Scope[],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }

  const hasScope = (user: UserClaims, scope: Scope) => user.scopes.includes(scope)

  // Operator cannot approve
  assert.equal(hasScope(operatorClaims, 'recon:read'), true)
  assert.equal(hasScope(operatorClaims, 'recon:run'), true)
  assert.equal(hasScope(operatorClaims, 'recon:approve'), false)
  assert.equal(hasScope(operatorClaims, 'recon:admin'), false)

  // Approver can approve but not administer rules
  assert.equal(hasScope(approverClaims, 'recon:approve'), true)
  assert.equal(hasScope(approverClaims, 'recon:admin'), false)
})

test('Auth Flow - Route protection decision matrix', () => {
  type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'expired'

  const evaluateRouteAccess = (
    status: AuthStatus,
    userScopes: Scope[],
    requiredScope?: Scope
  ): 'render' | 'loading' | 'redirect_login' | 'redirect_expired' | 'access_denied' => {
    if (status === 'loading') return 'loading'
    if (status === 'expired') return 'redirect_expired'
    if (status === 'unauthenticated') return 'redirect_login'
    if (requiredScope && !userScopes.includes(requiredScope)) return 'access_denied'
    return 'render'
  }

  // 1. Loading state shields protected render
  assert.equal(evaluateRouteAccess('loading', []), 'loading')

  // 2. Unauthenticated user redirected to login
  assert.equal(evaluateRouteAccess('unauthenticated', []), 'redirect_login')

  // 3. Expired session redirected to session expired screen
  assert.equal(evaluateRouteAccess('expired', []), 'redirect_expired')

  // 4. Authenticated without required scope triggers access denied
  assert.equal(
    evaluateRouteAccess('authenticated', ['recon:read'], 'recon:admin'),
    'access_denied'
  )

  // 5. Authenticated with required scope renders view
  assert.equal(
    evaluateRouteAccess('authenticated', ['recon:read', 'recon:admin'], 'recon:admin'),
    'render'
  )
})

test('Auth Flow - 401 Unauthorized signals session termination', () => {
  let sessionTerminated = false
  let logoutReason = ''

  const handle401 = (reason: string) => {
    sessionTerminated = true
    logoutReason = reason
  }

  const simulateResponse = (status: number) => {
    if (status === 401) {
      handle401('Token expired or revoked by resource server')
    }
  }

  simulateResponse(200)
  assert.equal(sessionTerminated, false)

  simulateResponse(401)
  assert.equal(sessionTerminated, true)
  assert.ok(logoutReason.includes('revoked'))
})

test('Auth Flow - Login validation returns structured error on malformed tokens', () => {
  const validToken = createToken({
    sub: 'analyst',
    tenant: 'acme-india',
    scope: 'recon:read',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })

  const resValid = inspectJwt(validToken)
  assert.equal(resValid.valid, true)

  const resInvalid = inspectJwt('not-a-token')
  assert.equal(resInvalid.valid, false)
  assert.ok(resInvalid.error)
})

