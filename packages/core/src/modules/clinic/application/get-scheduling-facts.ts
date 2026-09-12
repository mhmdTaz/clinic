import type { BookingWindow } from '@clinic/contracts'
import { NotFoundError } from '../../../errors'
import { clinicRepository } from '../infrastructure/clinic.repository'

export interface SchedulingFacts {
  timezone: string
  /** Calendar dates the clinic is shut: its own closures, plus the branch's own. */
  closedDates: string[]
  /** What the clinic has set; scheduling fills the rest from the defaults (ADR-0022). */
  bookingSettings: Partial<BookingWindow>
}

/**
 * Timezone, closures and booking limits — what scheduling needs to decide a time. It answers a
 * use case rather than a person, so it carries no permission check of its own.
 */
export async function getSchedulingFacts(
  clinicId: string,
  branchId: string | null = null,
): Promise<SchedulingFacts> {
  const [profile, bookingSettings] = await Promise.all([
    clinicRepository.findProfile(clinicId),
    clinicRepository.findBookingWindow(clinicId),
  ])
  if (!profile) throw new NotFoundError(`Clinic ${clinicId}`)

  return {
    timezone: profile.timezone,
    closedDates: profile.holidays
      .filter((holiday) => holiday.branchId === null || holiday.branchId === branchId)
      .map((holiday) => holiday.date),
    bookingSettings,
  }
}

export function findBookingWindow(clinicId: string): Promise<Partial<BookingWindow>> {
  return clinicRepository.findBookingWindow(clinicId)
}

export async function saveBookingWindow(clinicId: string, window: BookingWindow): Promise<void> {
  const saved = await clinicRepository.setBookingWindow(clinicId, window)
  if (!saved) throw new NotFoundError(`Clinic ${clinicId}`)
}
