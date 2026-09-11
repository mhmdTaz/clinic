/**
 * One error hierarchy (section 13.2), mapped to HTTP in exactly one place — the
 * interface layer. Nothing below the interface knows what a status code is.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string
  abstract readonly status: number
  readonly details?: Array<{ field: string; issue: string }>

  constructor(message: string, details?: Array<{ field: string; issue: string }>) {
    super(message)
    this.name = new.target.name
    this.details = details
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED'
  readonly status = 400
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED'
  readonly status = 401
  constructor(message = 'Authentication is required.') {
    super(message)
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN'
  readonly status = 403
  constructor(permission: string) {
    super(`Missing permission: ${permission}`)
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND'
  readonly status = 404
  constructor(what: string) {
    super(`${what} was not found.`)
  }
}

export class ConflictError extends DomainError {
  readonly code: string
  readonly status = 409
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export class BusinessRuleError extends DomainError {
  readonly code: string
  readonly status = 422
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError
