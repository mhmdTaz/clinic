/**
 * Account lockout (section 10.4).
 *
 * The first four consecutive failures are free. From the fifth, each failure locks
 * the account for twice as long as the previous one — 30s, 1m, 2m, 4m, 8m — and from
 * the tenth on the lock is a flat 15 minutes. A successful login resets the count.
 * Failures older than a day are forgiven, so a mistyped password last week does not
 * count against someone today.
 *
 * Per-account lockout complements the per-IP rate limit rather than replacing it: the
 * rate limit slows one machine trying many accounts, lockout slows many machines
 * trying one account.
 */
export const LOCKOUT_POLICY = {
  freeFailures: 4,
  baseLockSeconds: 30,
  maxLockSeconds: 15 * 60,
  hardLockAfter: 10,
  forgiveAfterHours: 24,
} as const

export function lockDurationSeconds(consecutiveFailures: number): number {
  if (consecutiveFailures <= LOCKOUT_POLICY.freeFailures) return 0
  if (consecutiveFailures >= LOCKOUT_POLICY.hardLockAfter) return LOCKOUT_POLICY.maxLockSeconds
  const doublings = consecutiveFailures - LOCKOUT_POLICY.freeFailures - 1
  return Math.min(LOCKOUT_POLICY.baseLockSeconds * 2 ** doublings, LOCKOUT_POLICY.maxLockSeconds)
}

export function lockedUntilAfter(consecutiveFailures: number, now: Date): Date | null {
  const seconds = lockDurationSeconds(consecutiveFailures)
  return seconds === 0 ? null : new Date(now.getTime() + seconds * 1000)
}

/** True when earlier failures are old enough that the count should start again. */
export function failuresAreForgiven(lastFailedAt: Date | null | undefined, now: Date): boolean {
  if (!lastFailedAt) return true
  return now.getTime() - lastFailedAt.getTime() >= LOCKOUT_POLICY.forgiveAfterHours * 3_600_000
}

export function isLocked(lockedUntil: Date | null | undefined, now: Date): boolean {
  return lockedUntil instanceof Date && lockedUntil.getTime() > now.getTime()
}

/** Whole seconds until `until`, never less than 1 — a Retry-After of 0 invites a hammer. */
export function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000))
}
