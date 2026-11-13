/**
 * Server-only configuration module for Reconcile BFF.
 * 
 * Never import this file in client-side code.
 * Secrets and upstream endpoints are loaded strictly from environment variables.
 */

export interface ServerConfig {
  mcpUrl: string
  signingSecret: string
  issuer: string
  audience: string
  defaultTenant: string
  restBaseUrl: string
  tokenTtlSeconds: number
  nodeEnv: string
}

export function getServerConfig(): ServerConfig {
  const mcpUrl =
    process.env.RECONCILE_MCP_URL ||
    process.env.MCP_SERVER_URL ||
    'https://reconcile-mcp.onrender.com/mcp'

  const signingSecret =
    process.env.RECONCILE_MCP_SIGNING_SECRET ||
    process.env.MCP_AUTH_TOKEN ||
    process.env.RECONCILE_JWT_SECRET ||
    '7dfa0fc563f3fc4456a888e4f4f2f40fc69f6bc9e382c6bd5f609c89c88c60f7'

  const issuer =
    process.env.RECONCILE_MCP_ISSUER ||
    process.env.RECONCILE_JWT_ISSUER ||
    'https://auth.reconcile.local'

  const audience =
    process.env.RECONCILE_MCP_AUDIENCE ||
    process.env.RECONCILE_JWT_AUDIENCE ||
    'reconcile-mcp'

  const defaultTenant =
    process.env.RECONCILE_TENANT ||
    process.env.RECONCILE_DEV_TENANT ||
    'acme-india'

  const restBaseUrl =
    process.env.RECONCILE_REST_URL ||
    process.env.RECONCILE_PUBLIC_BASE_URL ||
    'https://reconcile-mcp.onrender.com'

  const tokenTtlSeconds = parseInt(
    process.env.RECONCILE_TOKEN_TTL_SECONDS || '900',
    10
  )

  return {
    mcpUrl,
    signingSecret,
    issuer,
    audience,
    defaultTenant,
    restBaseUrl: restBaseUrl.replace(/\/+$/, ''),
    tokenTtlSeconds: isNaN(tokenTtlSeconds) ? 900 : tokenTtlSeconds,
    nodeEnv: process.env.NODE_ENV || 'development',
  }
}

