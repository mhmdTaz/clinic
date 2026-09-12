import type { ApiIssue } from '@clinic/contracts'

/**
 * What every failed call throws (section 9.2).
 *
 * One class rather than a hierarchy, because callers branch on `code` — a stable, machine-readable
 * string the server owns — and not on the shape of the error. A hierarchy would tempt a caller to
 * `instanceof NotFoundError`, which breaks the moment the server adds a code the client's build
 * has never heard of.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiIssue[] = [],
    readonly retryAfterSeconds: number | null = null,
    /** The server's request id, which is what support asks for. */
    readonly requestId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /**
   * True when the request failed before it reached the server, or the server fell over.
   *
   * The distinction matters on a phone in a lift: a transport failure is worth retrying quietly
   * and is not worth an error message, while a 400 means the app asked for something wrong and
   * retrying will fail identically.
   */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }

  /** True when the session is gone and the person has to sign in again. */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  /** The field errors a form shows, keyed by field. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const detail of this.details) errors[detail.field] ??= detail.issue
    return errors
  }
}

/**
 * A response whose body did not match the contract.
 *
 * Its own code because the cause is different in kind from anything the server reports: the call
 * succeeded and the payload is not what this build expects. On mobile that usually means an app
 * from the store months older than the server it is talking to, and saying so plainly is the
 * difference between a bug report that names the version and one that says "it crashed".
 */
export class ContractMismatchError extends ApiError {
  constructor(
    readonly path: string,
    readonly issues: string[],
    requestId: string | null = null,
  ) {
    super(
      200,
      'CONTRACT_MISMATCH',
      `The response from ${path} did not match this app's expectations. ` +
        'The app may be out of date.',
      [],
      null,
      requestId,
    )
    this.name = 'ContractMismatchError'
  }
}
