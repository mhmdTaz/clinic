import { DomainError } from '@clinic/core'

export class CrossSiteRequestError extends DomainError {
  readonly code = 'CSRF_REJECTED'
  readonly status = 403
  constructor() {
    super('This request came from another site and was refused.')
  }
}

export class PayloadTooLargeError extends DomainError {
  readonly code = 'PAYLOAD_TOO_LARGE'
  readonly status = 413
  constructor(limitBytes: number) {
    super(`The request body exceeds ${limitBytes} bytes.`)
  }
}
