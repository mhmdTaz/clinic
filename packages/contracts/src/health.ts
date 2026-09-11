import { z } from 'zod'
import { successResponse } from './envelope'

export const DependencyStatus = z.object({
  name: z.string(),
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nullable(),
  detail: z.string().nullish(),
})
export type DependencyStatus = z.infer<typeof DependencyStatus>

export const HealthPayload = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
  checkedAt: z.string().datetime(),
  dependencies: z.array(DependencyStatus),
})
export type HealthPayload = z.infer<typeof HealthPayload>

export const HealthResponse = successResponse(HealthPayload)
export type HealthResponse = z.infer<typeof HealthResponse>
