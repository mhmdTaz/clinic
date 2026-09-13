/** Honouring `Idempotency-Key` on the requests that must not happen twice (§9.2, Phase 10). */
export {
  claimIdempotencyKey,
  settleIdempotencyKey,
  IdempotencyKeyInUseError,
  type IdempotencyClaim,
  type IdempotencyOutcome,
} from './application/keys'
export {
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_TTL_MS,
  IN_FLIGHT_LEASE_MS,
  canonicalJson,
  decide,
  fingerprintOf,
  isReplayable,
  isValidIdempotencyKey,
} from './domain/idempotency'
// NOT exported: the repository.
