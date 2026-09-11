import { rateLimiter } from '../infrastructure/rate-limiter'

/** For the health check. Throws when the rate-limit store cannot be reached. */
export function pingRateLimitStore(): Promise<number> {
  return rateLimiter.ping()
}
