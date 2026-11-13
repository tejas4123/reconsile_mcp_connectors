export class ApiError extends Error {
  status: number
  code: string
  issues?: unknown[]

  constructor(status: number, message: string, code = 'API_ERROR', issues?: unknown[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = issues
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, issues?: unknown[]) {
    super(400, message, 'BAD_REQUEST', issues)
    this.name = 'BadRequestError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication required or token expired') {
    super(401, message, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Access forbidden: Insufficient authorization scope') {
    super(403, message, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Requested resource not found') {
    super(404, message, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Concurrency conflict: Resource has been modified by another process') {
    super(409, message, 'CONFLICT')
    this.name = 'ConflictError'
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Unprocessable request content', issues?: unknown[]) {
    super(422, message, 'VALIDATION_ERROR', issues)
    this.name = 'ValidationError'
  }
}

export class RateLimitError extends ApiError {
  retryAfter?: number

  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(429, message, 'RATE_LIMITED')
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

export class ServerError extends ApiError {
  constructor(message = 'Internal server error', status = 500) {
    super(status, message, 'SERVER_ERROR')
    this.name = 'ServerError'
  }
}

export class NetworkError extends Error {
  targetUrl: string

  constructor(targetUrl: string, originalError?: Error) {
    super(`Network connection failure when contacting ${targetUrl}`)
    this.name = 'NetworkError'
    this.targetUrl = targetUrl
    if (originalError?.stack) {
      this.stack = originalError.stack
    }
  }
}

export function parseHttpError(status: number, message: string, code?: string, issues?: unknown[]): ApiError {
  switch (status) {
    case 400:
      return new BadRequestError(message, issues)
    case 401:
      return new UnauthorizedError(message)
    case 403:
      return new ForbiddenError(message)
    case 404:
      return new NotFoundError(message)
    case 409:
      return new ConflictError(message)
    case 422:
      return new ValidationError(message, issues)
    case 429:
      return new RateLimitError(message)
    default:
      if (status >= 500) {
        return new ServerError(message, status)
      }
      return new ApiError(status, message, code || `ERROR_${status}`, issues)
  }
}

