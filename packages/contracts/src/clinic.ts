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

export const WorkingHours = z.object({
  /** 0 = Sunday */
  dayOfWeek: z.number().int().min(0).max(6),
  /** "09:00", local to the branch */
  opensAt: z.string(),
  closesAt: z.string(),
})
export type WorkingHours = z.infer<typeof WorkingHours>

/** What every portal may show about the clinic: how to reach it and when it is open. */
export const ClinicProfile = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  locale: z.string(),
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
  address: z.object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
  }),
  branches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      isActive: z.boolean(),
      workingHours: z.array(WorkingHours),
    }),
  ),
})
export type ClinicProfile = z.infer<typeof ClinicProfile>
