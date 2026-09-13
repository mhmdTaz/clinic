import { ApiError } from '@clinic/api-client'

/**
 * What to tell somebody about a failure, in one place.
 *
 * The server words its own refusals — "That appointment can no longer be cancelled online" — and
 * those are shown as they are: the clinic can change the rule behind them, and a second copy of the
 * wording here would drift. What the server cannot word is a failure that never reached it, and
 * the raw text of those ("Network request failed") means nothing to a patient.
 */
export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Please try again.'
  }
  switch (error.code) {
    case 'NETWORK_UNREACHABLE':
      return 'The clinic could not be reached. Check your connection and try again.'
    case 'CONTRACT_MISMATCH':
      return 'This version of the app is out of date. Please update it to carry on.'
    // The server's code, not a guess at one: the first sign-in screen checked for 'RATE_LIMITED',
    // which no endpoint sends, so its "try again in N minutes" could never appear.
    case 'TOO_MANY_ATTEMPTS': {
      if (!error.retryAfterSeconds) return 'Too many attempts. Try again shortly.'
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60))
      return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
  }
  if (error.status >= 500) {
    return 'Something went wrong at the clinic’s end. Try again shortly.'
  }
  return error.message || 'That did not work. Please try again.'
}

/** Sign-in's one deliberately unhelpful sentence (§16.1: no account enumeration). */
export function signInMessageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'That email and password do not match.'
  }
  return messageFor(error)
}
