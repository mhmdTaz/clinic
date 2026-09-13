import { createHash } from 'node:crypto'

/**
 * The rules for honouring `Idempotency-Key` (§9.2), apart from any storage so they can be tested
 * on their own.
 */

/** A retry a day later is a new request. The TTL index removes the row. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * How long a claim holds while its request runs.
 *
 * Long enough for any booking or payment to finish; short enough that a request which died
 * mid-flight — a crashed process, a killed container — does not lock its key for a day. After the
 * lease, a retry takes the key over and runs.
 */
export const IN_FLIGHT_LEASE_MS = 60 * 1000

/** Letters, digits and `._:-`: a UUID, a ULID, or anything a client sensibly mints. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export const isValidIdempotencyKey = (key: string): boolean => IDEMPOTENCY_KEY_PATTERN.test(key)

/**
 * JSON with object keys sorted, so the same body with its fields in another order is the same body.
 * A client re-serialising a retry is not sending a different request.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(',')}}`
}

export const fingerprintOf = (body: unknown): string =>
  createHash('sha256').update(canonicalJson(body)).digest('hex')

export interface KeyRecord {
  state: 'IN_FLIGHT' | 'DONE'
  fingerprint: string
  lockedUntil: Date | null
}

export type KeyDecision =
  /** The same request already answered: send that answer again. */
  | 'replay'
  /** The same key on a different body: refuse, rather than replay an answer to another question. */
  | 'mismatch'
  /** The first request is still running: ask the client to wait. */
  | 'busy'
  /** The first request died mid-flight and its lease ran out: run this one instead. */
  | 'takeOver'

/**
 * What to do with a request whose key is already recorded.
 *
 * **The body is compared before anything else.** A different body under the same key is refused
 * even while the first is running or after it finished, because either way the client has reused
 * a key for a second request — and answering it with the first request's appointment would tell
 * somebody they booked a time they did not choose.
 */
export function decide(record: KeyRecord, fingerprint: string, now: Date): KeyDecision {
  if (record.fingerprint !== fingerprint) return 'mismatch'
  if (record.state === 'DONE') return 'replay'
  if (record.lockedUntil && record.lockedUntil.getTime() > now.getTime()) return 'busy'
  return 'takeOver'
}

/**
 * Whether an outcome is kept for replay.
 *
 * A success, and a refusal the domain made — `SLOT_TAKEN`, `BEYOND_HORIZON`, a validation the use
 * case applied — are answers: the same request would get the same one. A server error is not an
 * answer, it is a failure to give one, and keeping it would turn a transient fault into a
 * permanent one for that key. So those release the key, and a retry runs again.
 */
export const isReplayable = (status: number): boolean => status >= 200 && status < 500
