import { BusinessRuleError, ConflictError, ValidationError } from '../../../errors'
import {
  IDEMPOTENCY_TTL_MS,
  IN_FLIGHT_LEASE_MS,
  decide,
  fingerprintOf,
  isReplayable,
  isValidIdempotencyKey,
} from '../domain/idempotency'
import { idempotencyRepository } from '../infrastructure/idempotency.repository'

/**
 * Honouring `Idempotency-Key` (§9.2).
 *
 * The delivery layer calls these around a handler: claim before, complete or release after. Core
 * owns the rules — what counts as the same request, what is kept, when a stuck claim is taken over
 * — so a second delivery mechanism would get identical behaviour without re-deriving any of it.
 */

export interface IdempotencyClaim {
  clinicId: string
  id: string
  claimToken: string
}

export type IdempotencyOutcome =
  { kind: 'proceed'; claim: IdempotencyClaim } | { kind: 'replay'; status: number; body: unknown }

/** The first request with this key is still running. Worth retrying in a moment, not now. */
export class IdempotencyKeyInUseError extends ConflictError {
  readonly retryAfterSeconds = 1
  constructor() {
    super(
      'IDEMPOTENCY_KEY_IN_USE',
      'A request with this key is still being processed. Try again in a moment.',
    )
  }
}

const MAX_ATTEMPTS = 3

export async function claimIdempotencyKey(
  input: { clinicId: string; scope: string; key: string; body: unknown },
  now: Date = new Date(),
): Promise<IdempotencyOutcome> {
  if (!isValidIdempotencyKey(input.key)) {
    throw new ValidationError('The Idempotency-Key header is not valid.', [
      { field: 'Idempotency-Key', issue: 'INVALID_IDEMPOTENCY_KEY' },
    ])
  }

  const fingerprint = fingerprintOf(input.body)
  const lease = () => new Date(now.getTime() + IN_FLIGHT_LEASE_MS)

  // A few attempts, because the row can change between a failed insert and the read that follows:
  // a claim released after a server error, or one expired by the TTL.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const claimed = await idempotencyRepository.claim({
      clinicId: input.clinicId,
      scope: input.scope,
      key: input.key,
      fingerprint,
      lockedUntil: lease(),
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    if (claimed) return { kind: 'proceed', claim: { clinicId: input.clinicId, ...claimed } }

    const existing = await idempotencyRepository.find(input.clinicId, input.scope, input.key)
    if (!existing) continue

    switch (decide(existing, fingerprint, now)) {
      case 'mismatch':
        throw new BusinessRuleError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request.',
          [{ field: 'Idempotency-Key', issue: 'IDEMPOTENCY_KEY_REUSED' }],
        )
      case 'replay':
        return {
          kind: 'replay',
          status: existing.responseStatus ?? 200,
          body: existing.responseBody,
        }
      case 'busy':
        throw new IdempotencyKeyInUseError()
      case 'takeOver': {
        const taken = await idempotencyRepository.takeOver(
          input.clinicId,
          existing.id,
          existing.lockedUntil,
          lease(),
        )
        if (taken) return { kind: 'proceed', claim: { clinicId: input.clinicId, ...taken } }
        // Another retry took it first; the next pass sees what it made of it.
      }
    }
  }
  throw new IdempotencyKeyInUseError()
}

/**
 * Records how the request ended.
 *
 * An answer is kept for replay — a success, or a refusal the domain made. A server error releases
 * the key instead, so the retry that follows runs again rather than being told about a fault that
 * may already have passed (see `isReplayable`).
 */
export async function settleIdempotencyKey(
  claim: IdempotencyClaim,
  response: { status: number; body: unknown },
): Promise<void> {
  if (isReplayable(response.status)) {
    await idempotencyRepository.complete(claim.clinicId, claim.id, claim.claimToken, response)
  } else {
    await idempotencyRepository.release(claim.clinicId, claim.id, claim.claimToken)
  }
}
