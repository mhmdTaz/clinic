import type { DaySlots, SlotQuery } from '@clinic/contracts'
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getSchedulingFacts } from '../../clinic'
import { findDoctorForScheduling } from '../../doctors'
import {
  bookingWindowOf,
  computeSlots,
  eachDate,
  instantOf,
  nextDate,
  type BusyRange,
} from '../../scheduling'
import { appointmentRepository } from '../infrastructure/appointment.repository'

/** A calendar asks for a week and the patient portal for a fortnight; this caps the ask. */
const MAX_DAYS = 62

/**
 * What a doctor can be booked into (S4, P5).
 *
 * Computed on every call from the doctor's week, the clinic's closures and the appointments
 * already made — never stored, so there is nothing to invalidate when any of the three changes
 * (section 8.7).
 */
export async function offerSlots(
  actor: Actor,
  doctorId: string,
  query: SlotQuery,
  now: Date = new Date(),
): Promise<DaySlots[]> {
  await assertCan(actor, 'availability:read')
  // A doctor holding only OWN reads their own week, not a colleague's.
  if (actor.permissions.get('availability:read') === 'OWN' && actor.doctorId !== doctorId) {
    throw new ForbiddenError('availability:read')
  }

  const days = eachDate(query.from, query.to)
  if (days.length > MAX_DAYS) {
    throw new ValidationError('That is a longer stretch than slots are offered for.', [
      { field: 'to', issue: 'RANGE_TOO_LONG' },
    ])
  }

  const [clinic, doctor] = await Promise.all([
    getSchedulingFacts(actor.clinicId),
    findDoctorForScheduling(actor.clinicId, doctorId),
  ])
  if (!doctor) throw new NotFoundError('Doctor')
  if (!doctor.isActive) return days.map((date) => ({ date, slots: [] }))

  const durationMinutes = query.durationMinutes ?? doctor.defaultSlotMinutes
  const from = instantOf(query.from, '00:00', clinic.timezone)
  const to = instantOf(nextDate(query.to), '00:00', clinic.timezone)
  const busy: BusyRange[] = await appointmentRepository.busyRanges(
    actor.clinicId,
    doctorId,
    from,
    to,
  )

  // A patient booking for themselves is held to the clinic's notice period; the front desk is
  // not, so the same call answers both with the right offers (ADR-0022).
  const selfService = actor.permissions.get('appointment:create') === 'OWN'
  const window = bookingWindowOf(clinic.bookingSettings)
  const notBefore = selfService
    ? new Date(now.getTime() + window.minimumNoticeHours * 3_600_000)
    : now

  return computeSlots({
    from: query.from,
    to: query.to,
    timeZone: clinic.timezone,
    blocks: doctor.availability,
    timeOff: doctor.timeOff,
    closedDates: clinic.closedDates,
    busy,
    durationMinutes,
    notBefore,
  }).map((day) => ({
    date: day.date,
    slots: day.slots.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    })),
  }))
}
