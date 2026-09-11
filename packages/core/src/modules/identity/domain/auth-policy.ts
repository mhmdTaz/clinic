/**
 * Authentication policy in one place (section 10.4), so a security review reads one
 * file instead of hunting for magic numbers across use cases.
 */
export const AUTH_POLICY = {
  /** Short, because an access token cannot be revoked once issued — only outlived. */
  accessTokenTtlSeconds: 15 * 60,
  /** Sliding: each refresh extends the session by this much again. */
  refreshTokenTtlDays: 30,
  /**
   * Two browser tabs refreshing at the same moment present the same token twice. Inside
   * this window that is treated as concurrency, not theft; outside it, reuse of a
   * rotated token revokes the whole session family.
   */
  refreshReuseGraceSeconds: 15,
  passwordResetTtlMinutes: 30,
  invitationTtlDays: 7,

  password: {
    minLength: 12,
    maxLength: 128,
  },

  rateLimits: {
    loginPerIp: { limit: 30, windowSeconds: 10 * 60 },
    loginPerEmail: { limit: 10, windowSeconds: 10 * 60 },
    passwordResetPerIp: { limit: 10, windowSeconds: 60 * 60 },
    passwordResetPerEmail: { limit: 3, windowSeconds: 60 * 60 },
    /** Reset-link and invitation-link submissions: guessing tokens must be slow. */
    tokenRedemptionPerIp: { limit: 30, windowSeconds: 10 * 60 },
  },
} as const

export type RateLimitRule = { limit: number; windowSeconds: number }
