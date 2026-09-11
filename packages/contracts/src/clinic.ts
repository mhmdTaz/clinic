import { z } from 'zod'
import { successResponse } from './envelope'

export const BranchSummary = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
})

export const ClinicOverview = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  currency: z.string(),
  locale: z.string(),
  branches: z.array(BranchSummary),
  counts: z.object({ users: z.number().int(), roles: z.number().int() }),
})
export type ClinicOverview = z.infer<typeof ClinicOverview>

export const ClinicOverviewResponse = successResponse(ClinicOverview)
