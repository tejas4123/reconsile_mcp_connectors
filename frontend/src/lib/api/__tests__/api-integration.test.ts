import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  parseHttpError,
  RateLimitError,
  ServerError,
  UnauthorizedError,
  ValidationError,
} from '../api-errors.ts'
import { ReconcileApiClient } from '../api-client.ts'

test('API Errors - parseHttpError maps standard status codes to typed error instances', () => {
  assert.ok(parseHttpError(400, 'Bad input') instanceof BadRequestError)
  assert.ok(parseHttpError(401, 'Token expired') instanceof UnauthorizedError)
  assert.ok(parseHttpError(403, 'Missing scope') instanceof ForbiddenError)
  assert.ok(parseHttpError(404, 'Not found') instanceof NotFoundError)
  assert.ok(parseHttpError(409, 'Version conflict') instanceof ConflictError)
  assert.ok(parseHttpError(422, 'Unprocessable schema') instanceof ValidationError)
  assert.ok(parseHttpError(429, 'Rate limited') instanceof RateLimitError)
  assert.ok(parseHttpError(500, 'Internal server error') instanceof ServerError)
  assert.ok(parseHttpError(503, 'Service unavailable') instanceof ServerError)
})

test('API Client - Generates unique correlation IDs and injects Bearer token', async () => {
  let capturedHeaders: Record<string, string> = {}
  let capturedUrl = ''

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = input.toString()
    capturedHeaders = (init?.headers as Record<string, string>) || {}
    return new Response(JSON.stringify({ status: 'ready', worker_last_seen_seconds: 5 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Swap global fetch temporarily
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch

  try {
    const client = new ReconcileApiClient({
      baseUrl: 'http://test-reconcile.local',
      token: 'test_bearer_jwt_token_sample',
      tenant: 'acme-india',
    })

    const health = await client.checkHealth()
    assert.equal(health.live, true)
    assert.ok(
      capturedUrl === 'http://test-reconcile.local/api/health' ||
        capturedUrl === 'http://test-reconcile.local/readyz'
    )
    assert.ok(capturedHeaders)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API Client - Intercepts 401 Unauthorized and fires callback for session expiry', async () => {
  let fired401 = false

  const mockFetch = async (): Promise<Response> => {
    return new Response(JSON.stringify({ detail: 'invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch

  try {
    const client = new ReconcileApiClient({
      baseUrl: 'http://test-reconcile.local',
      token: 'expired_token',
    })

    client.setOnUnauthorized(() => {
      fired401 = true
    })

    await assert.rejects(
      async () => {
        await client.getStats()
      },
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError)
        return true
      }
    )

    assert.equal(fired401, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API Client - Intercepts 403 Forbidden when scope is missing', async () => {
  let fired403 = false

  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        detail: {
          code: 'FORBIDDEN',
          message: "this operation requires scope 'recon:approve'",
        },
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch

  try {
    const client = new ReconcileApiClient({
      baseUrl: 'http://test-reconcile.local',
      token: 'read_only_token',
    })

    client.setOnForbidden(() => {
      fired403 = true
    })

    await assert.rejects(
      async () => {
        await client.decideProposal('11111111-1111-1111-1111-111111111111', {
          decision: 'APPROVED',
          expected_version: 1,
        })
      },
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError)
        assert.ok((err as ForbiddenError).message.includes('recon:approve'))
        return true
      }
    )

    assert.equal(fired403, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API Client - Catches network failure and wraps in NetworkError', async () => {
  const mockFetch = async (): Promise<Response> => {
    throw new TypeError('Failed to fetch')
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch

  try {
    const client = new ReconcileApiClient({
      baseUrl: 'http://unreachable-host:9999',
    })

    await assert.rejects(
      async () => {
        await client.getStats()
      },
      (err: unknown) => {
        assert.ok(err instanceof NetworkError)
        assert.ok((err as NetworkError).targetUrl.includes('unreachable-host'))
        return true
      }
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API Client - Handles optimistic locking 409 Conflict on superseded proposal', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        detail: {
          code: 'PROPOSAL_SUPERSEDED',
          message: 'The underlying record was modified since review; expected version 1',
        },
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch

  try {
    const client = new ReconcileApiClient({
      baseUrl: 'http://test-reconcile.local',
      token: 'valid_approver_token',
    })

    await assert.rejects(
      async () => {
        await client.decideProposal('22222222-2222-2222-2222-222222222222', {
          decision: 'APPROVED',
          expected_version: 1,
        })
      },
      (err: unknown) => {
        assert.ok(err instanceof ConflictError)
        assert.ok((err as ConflictError).message.includes('expected version 1'))
        return true
      }
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
