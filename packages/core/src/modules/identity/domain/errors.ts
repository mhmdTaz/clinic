import { DomainError } from '../../../errors'
import type { PasswordIssue } from './password-policy'

/**
 * Deliberately identical for an unknown email and a wrong password, so the response
 * never reveals whether an account exists.
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS'
  readonly status = 401
  constructor() {
    super('The email or password is incorrect.')
  }
}

/** Covers both the per-IP rate limit and per-account lockout, again without telling them apart. */
export class TooManyAttemptsError extends DomainError {
  readonly code = 'TOO_MANY_ATTEMPTS'
  readonly status = 429
  readonly retryAfterSeconds: number
  constructor(retryAfterSeconds: number) {
    super('Too many attempts. Please wait before trying again.')
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Only ever shown after the correct password, so it reveals nothing to a guesser. */
export class AccountDisabledError extends DomainError {
  readonly code = 'ACCOUNT_DISABLED'
  readonly status = 403
  constructor() {
    super('This account has been disabled. Contact the clinic.')
  }
}

/** Distinct from UNAUTHENTICATED so a client knows a silent refresh is worth trying. */
export class TokenExpiredError extends DomainError {
  readonly code = 'TOKEN_EXPIRED'
  readonly status = 401
  constructor() {
    super('The session token has expired.')
  }
}

export class InvalidLinkError extends DomainError {
  readonly code = 'INVALID_OR_EXPIRED_LINK'
  readonly status = 400
  constructor() {
    super('This link is invalid or has expired. Request a new one.')
  }
}

export class PasswordPolicyError extends DomainError {
  readonly code = 'PASSWORD_POLICY'
  readonly status = 422
  readonly issues: PasswordIssue[]
  constructor(issues: PasswordIssue[], field = 'password') {
    super(
      'The password does not meet the requirements.',
      issues.map((issue) => ({ field, issue })),
    )
    this.issues = issues
  }
}

export class CurrentPasswordIncorrectError extends DomainError {
  readonly code = 'CURRENT_PASSWORD_INCORRECT'
  readonly status = 400
  constructor() {
    super('The current password is incorrect.', [{ field: 'currentPassword', issue: 'INCORRECT' }])
  }
}
