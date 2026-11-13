import type { Scope, TokenValidationResult, UserClaims } from './auth-types.ts'

const TOKEN_STORAGE_KEY = 'reconcile_auth_token'
const REMEMBER_STORAGE_KEY = 'reconcile_auth_remember'
const TENANT_CLAIM_CANDIDATES = [
  'tenant',
  'https://reconcile.example/tenant',
  'tenant_slug',
  'tenant_id',
  'org',
]

/**
 * Base64URL decode with UTF-8 support
 */
function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  try {
    // browser or Node environment UTF-8 decoding
    if (typeof atob === 'function') {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new TextDecoder().decode(bytes)
    }
    // Node.js fallback without static Buffer global requirement
    const globalBuf = (globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }).Buffer
    if (globalBuf) {
      return globalBuf.from(base64, 'base64').toString('utf8')
    }
    throw new Error('No base64 decoder available')
  } catch (err) {
    throw new Error(`Failed to decode base64url string: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Inspects and parses a JWT without evaluating untrusted code.
 * Validates expiration, required claims, and tenant presence.
 */
export function inspectJwt(token: string): TokenValidationResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token string is empty or invalid' }
  }

  const parts = token.trim().split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed JWT: Token must consist of 3 dot-separated segments' }
  }

  let payload: Record<string, unknown>
  try {
    const jsonStr = base64UrlDecode(parts[1])
    payload = JSON.parse(jsonStr)
  } catch (err) {
    return { valid: false, error: `Invalid JWT payload: ${err instanceof Error ? err.message : 'JSON parse failure'}` }
  }

  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Invalid JWT payload: Object expected' }
  }

  // 1. Validate Subject
  const sub = typeof payload.sub === 'string' ? payload.sub : typeof payload.client_id === 'string' ? payload.client_id : ''
  if (!sub) {
    return { valid: false, error: 'Token is missing standard "sub" (subject) claim' }
  }

  // 2. Validate Expiration
  if (typeof payload.exp !== 'number') {
    return { valid: false, error: 'Token is missing standard numeric "exp" (expiration) claim' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (payload.exp <= nowSeconds) {
    return {
      valid: false,
      isExpired: true,
      error: `Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
    }
  }

  // 3. Resolve Tenant Slug
  let tenant = ''
  for (const candidate of TENANT_CLAIM_CANDIDATES) {
    if (typeof payload[candidate] === 'string' && payload[candidate]) {
      tenant = payload[candidate] as string
      break
    }
  }

  if (!tenant) {
    return {
      valid: false,
      error: 'Token has no tenant claim (expected "tenant" or "https://reconcile.example/tenant")',
    }
  }

  // 4. Resolve Scopes
  const scopesList: Scope[] = []
  const rawScopes = payload.scope || payload.scp
  if (typeof rawScopes === 'string') {
    for (const s of rawScopes.split(/\s+/)) {
      if (s) scopesList.push(s as Scope)
    }
  } else if (Array.isArray(rawScopes)) {
    for (const s of rawScopes) {
      if (typeof s === 'string' && s) scopesList.push(s as Scope)
    }
  }

  // 5. Construct UserClaims
  const claims: UserClaims = {
    sub,
    tenant,
    client_id: (payload.azp || payload.client_id || payload.appid || sub) as string,
    scopes: scopesList,
    iss: typeof payload.iss === 'string' ? payload.iss : undefined,
    aud: typeof payload.aud === 'string' ? payload.aud : undefined,
    exp: payload.exp,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    email: typeof payload.email === 'string' ? payload.email : sub.includes('@') ? sub : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    rawClaims: payload,
  }

  return { valid: true, claims }
}

export class AuthClient {
  private static instance: AuthClient
  private expirationTimeoutId: ReturnType<typeof setTimeout> | null = null
  private expirationListeners: Set<() => void> = new Set()

  static getInstance(): AuthClient {
    if (!AuthClient.instance) {
      AuthClient.instance = new AuthClient()
    }
    return AuthClient.instance
  }

  /**
   * Retrieves active token from sessionStorage (default) or localStorage (if remember-me active).
   */
  getStoredToken(): string | null {
    if (typeof window === 'undefined') return null

    try {
      // 1. Check sessionStorage (highest priority, ephemeral)
      const sessionToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (sessionToken) return sessionToken

      // 2. Check localStorage if remember-me was chosen
      const isRemembered = window.localStorage.getItem(REMEMBER_STORAGE_KEY) === 'true'
      if (isRemembered) {
        const localToken = window.localStorage.getItem(TOKEN_STORAGE_KEY)
        if (localToken) return localToken
      }
    } catch {
      // Storage access may throw in restricted sandboxes
    }
    return null
  }

  /**
   * Saves the token securely. If rememberMe is true, uses localStorage; otherwise sessionStorage.
   */
  saveToken(token: string, rememberMe = false): void {
    if (typeof window === 'undefined') return

    try {
      if (rememberMe) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
        window.localStorage.setItem(REMEMBER_STORAGE_KEY, 'true')
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      } else {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
        window.localStorage.removeItem(TOKEN_STORAGE_KEY)
        window.localStorage.removeItem(REMEMBER_STORAGE_KEY)
      }
    } catch {
      // Storage quota or restriction
    }

    this.scheduleExpirationCheck(token)
  }

  /**
   * Clears token and remember flag across all storage tiers.
   */
  clearToken(): void {
    if (this.expirationTimeoutId) {
      clearTimeout(this.expirationTimeoutId)
      this.expirationTimeoutId = null
    }

    if (typeof window === 'undefined') return

    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      window.localStorage.removeItem(REMEMBER_STORAGE_KEY)
    } catch {
      // Ignore
    }
  }

  /**
   * Schedules a timer to fire when the JWT expires.
   */
  scheduleExpirationCheck(token: string): void {
    if (this.expirationTimeoutId) {
      clearTimeout(this.expirationTimeoutId)
      this.expirationTimeoutId = null
    }

    const inspection = inspectJwt(token)
    if (!inspection.valid || !inspection.claims) {
      return
    }

    const expMs = inspection.claims.exp * 1000
    const nowMs = Date.now()
    const delayMs = Math.max(0, expMs - nowMs)

    // Schedule timer to trigger when expired (cap at 24 hours to prevent integer overflow)
    const timerDelay = Math.min(delayMs, 24 * 60 * 60 * 1000)

    this.expirationTimeoutId = setTimeout(() => {
      this.notifyExpiration()
    }, timerDelay)
  }

  onExpiration(listener: () => void): () => void {
    this.expirationListeners.add(listener)
    return () => {
      this.expirationListeners.delete(listener)
    }
  }

  private notifyExpiration(): void {
    for (const listener of this.expirationListeners) {
      try {
        listener()
      } catch {
        // Safe listener execution
      }
    }
  }
}

export const authClient = AuthClient.getInstance()
