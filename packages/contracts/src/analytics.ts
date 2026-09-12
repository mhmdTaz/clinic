import { z } from 'zod'
import { LocalDate } from './common'

/**
 * The admin analytics dashboard (A8, section 14.3).
 *
 * Four questions, which is the whole feature: what came in, how busy we were, which doctors are
 * carrying the load, and whether new people are arriving. Everything here is derived — no
 * aggregate is stored, so a correction to an invoice or a cancelled appointment is reflected the
 * next time the page is opened rather than waiting for a rollup job to catch up.
 *
 * Money crosses this boundary as a **decimal string**, never a number: a float cannot hold 0.1,
 * and a revenue figure that is wrong in the third decimal place is a revenue figure nobody
 * trusts. See `money.ts`.
 */

export const AnalyticsQuery = z.object({
  /** Defaults to the last 30 days, resolved in the clinic's timezone by the use case. */
  from: LocalDate.optional(),
  to: LocalDate.optional(),
})
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>

export const RevenuePoint = z.object({
  date: LocalDate,
  /** Net of refunds, so a day where more was given back than taken can legitimately be negative. */
  amount: z.string(),
})
export type RevenuePoint = z.infer<typeof RevenuePoint>

export const RevenueSummary = z.object({
  currency: z.string(),
  /** Money that actually arrived, before refunds. */
  collected: z.string(),
  refunded: z.string(),
  net: z.string(),
  /** What was billed in the range — not the same thing, and the gap is the point. */
  invoiced: z.string(),
  /** Still owed on invoices issued in the range. */
  outstanding: z.string(),
  byDay: z.array(RevenuePoint),
})
export type RevenueSummary = z.infer<typeof RevenueSummary>

export const AppointmentPoint = z.object({
  date: LocalDate,
  booked: z.number(),
  completed: z.number(),
  cancelled: z.number(),
  noShow: z.number(),
})
export type AppointmentPoint = z.infer<typeof AppointmentPoint>

export const AppointmentAnalytics = z.object({
  total: z.number(),
  byStatus: z.record(z.number()),
  /** Percentages to one decimal place, as numbers — these are ratios, not money. */
  completionRate: z.number(),
  noShowRate: z.number(),
  cancellationRate: z.number(),
  byDay: z.array(AppointmentPoint),
})
export type AppointmentAnalytics = z.infer<typeof AppointmentAnalytics>

export const DoctorUtilisation = z.object({
  doctorId: z.string(),
  name: z.string(),
  appointments: z.number(),
  completed: z.number(),
  bookedMinutes: z.number(),
  /**
   * Minutes the doctor was rostered for, after time off and clinic holidays. Zero means the
   * doctor has no availability in the range — which is why `utilisationPercent` is nullable
   * rather than 0: "not scheduled to work" and "scheduled and idle" are different findings.
   */
  availableMinutes: z.number(),
  utilisationPercent: z.number().nullable(),
})
export type DoctorUtilisation = z.infer<typeof DoctorUtilisation>

export const PatientMix = z.object({
  /** Seen in the range, registered in the range. */
  newCount: z.number(),
  /** Seen in the range, registered before it. */
  returningCount: z.number(),
  seenCount: z.number(),
  newPercent: z.number(),
})
export type PatientMix = z.infer<typeof PatientMix>

export const AnalyticsOverview = z.object({
  range: z.object({ from: LocalDate, to: LocalDate, days: z.number() }),
  revenue: RevenueSummary,
  appointments: AppointmentAnalytics,
  doctors: z.array(DoctorUtilisation),
  patients: PatientMix,
  /** When the numbers were computed. A secondary read can lag; saying so is cheaper than a bug report. */
  generatedAt: z.string().datetime(),
})
export type AnalyticsOverview = z.infer<typeof AnalyticsOverview>
