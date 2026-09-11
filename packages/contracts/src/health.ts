import { z } from 'zod'
import { successResponse } from './envelope'

export const DependencyStatus = z.object({
  name: z.string(),
  status: z.enum(['up', 'down']),
  /**
   * A critical dependency down means this instance cannot serve requests and must leave
   * the load balancer. A non-critical one (Redis, for rate limiting) degrades a feature
   * but not the service — pulling every instance over it would turn a degradation into
   * an outage.
   */
  critical: z.boolean(),
  latencyMs: z.number().nullable(),
  detail: z.string().nullish(),
})
export type DependencyStatus = z.infer<typeof DependencyStatus>

export const HealthPayload = z.object({
  status: z.enum(['ok', 'degraded']),
  /** False only when a critical dependency is down. Drives the 200/503 answer. */
  ready: z.boolean(),
  version: z.string(),
  uptimeSeconds: z.number(),
  checkedAt: z.string().datetime(),
  dependencies: z.array(DependencyStatus),
})
export type HealthPayload = z.infer<typeof HealthPayload>

export const HealthResponse = successResponse(HealthPayload)
export type HealthResponse = z.infer<typeof HealthResponse>
