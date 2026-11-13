/**
 * Server-side JWT signer compatible with Reconcile MCP backend (HS256).
 *
 * All token generation is strictly server-to-server.
 * Secrets never cross the wire to the frontend browser.
 */

import { SignJWT, jwtVerify } from 'jose'
import crypto from 'node:crypto'
import { getServerConfig } from './config.ts'

export interface MintTokenOptions {
  tenant?: string
  sub?: string
  subject?: string
  clientId?: string
  scopes?: string
  ttlSeconds?: number
}

/**
 * Mints a short-lived Bearer JWT for MCP client operations (run, propose, apply, read).
 * Never grants recon:approve to automated agent identities.
 */
export async function mintMcpToken(options: MintTokenOptions = {}): Promise<string> {
  const config = getServerConfig()
  const tenant = options.tenant || config.defaultTenant
  const subject = options.sub || options.subject || 'reconcile-bff-operator'
  const clientId = options.clientId || 'reconcile-mcp-controller'
  const scopes = options.scopes || 'recon:read recon:run recon:propose recon:apply'
  const ttlSeconds = options.ttlSeconds || config.tokenTtlSeconds

  const secretBytes = Buffer.from(config.signingSecret, 'utf-8')

  return await new SignJWT({
    tenant,
    scope: scopes,
    sub: subject,
    azp: clientId,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretBytes)
}

/**
 * Mints an authorized human approver token for four-eyes approval REST operations.
 * Subject is explicitly distinct from the operator/proposer identity to satisfy four-eyes enforcement.
 */
export async function mintApproverToken(options: MintTokenOptions = {}): Promise<string> {
  const config = getServerConfig()
  const tenant = options.tenant || config.defaultTenant
  const subject = options.sub || options.subject || 'controller@acme'
  const clientId = options.clientId || 'approvals-ui'
  const scopes = options.scopes || 'recon:read recon:approve'
  const ttlSeconds = options.ttlSeconds || 300 // 5 minutes max for approval operations

  const secretBytes = Buffer.from(config.signingSecret, 'utf-8')

  return await new SignJWT({
    tenant,
    scope: scopes,
    sub: subject,
    azp: clientId,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretBytes)
}

/**
 * Verifies and decodes a server-minted token to validate signature and claims.
 */
export async function verifyServerToken(token: string): Promise<Record<string, unknown>> {
  const config = getServerConfig()
  const secretBytes = Buffer.from(config.signingSecret, 'utf-8')
  const { payload } = await jwtVerify(token, secretBytes, {
    issuer: config.issuer,
    audience: config.audience,
  })
  return payload
}
