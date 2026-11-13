export type Scope =
  | 'recon:read'
  | 'recon:run'
  | 'recon:propose'
  | 'recon:apply'
  | 'recon:approve'
  | 'recon:admin'

export interface UserClaims {
  sub: string
  tenant: string
  client_id?: string
  scopes: Scope[]
  iss?: string
  aud?: string
  exp: number
  iat?: number
  email?: string
  name?: string
  rawClaims?: Record<string, unknown>
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'expired'

export interface AuthState {
  status: AuthStatus
  token: string | null
  user: UserClaims | null
  tenant: string | null
  scopes: Scope[]
  expiresAt: Date | null
  secondsRemaining: number | null
}

export interface TokenValidationResult {
  valid: boolean
  claims?: UserClaims
  error?: string
  isExpired?: boolean
}

export interface AuthContextValue extends AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  isExpired: boolean
  hasScope: (scope: Scope | string) => boolean
  hasAllScopes: (scopes: (Scope | string)[]) => boolean
  hasAnyScope: (scopes: (Scope | string)[]) => boolean
  loginWithToken: (token: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>
  logout: (reason?: string) => void
  expireSession: (reason?: string) => void
  refreshSession: () => Promise<boolean>
}

export interface SSOProviderConfig {
  name: string
  issuerUrl: string
  clientId: string
  authorizationEndpoint?: string
  scopes?: string
}

