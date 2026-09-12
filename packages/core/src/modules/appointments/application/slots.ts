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
 * The open times themselves, with no permission check: the caller has already decided who is
 * asking and what they may see. Booking and the walk-in desk need the same answer offerSlots
 * gives, and computing it twice in two places is how the two drift apart.
 */
export async function openSlots(
  clinicId: string,
  doctorId: string,
  query: { from: string; to: string; durationMinutes?: number; notBefore: Date },
): Promise<DaySlots[]> {
  const days = eachDate(query.from, query.to)
  const [clinic, doctor] = await Promise.all([
    getSchedulingFacts(clinicId),
    findDoctorForScheduling(clinicId, doctorId),
  ])
  if (!doctor) throw new NotFoundError('Doctor')
  if (!doctor.isActive) return days.map((date) => ({ date, slots: [] }))

  const durationMinutes = query.durationMinutes ?? doctor.defaultSlotMinutes
  const busy: BusyRange[] = await appointmentRepository.busyRanges(
    clinicId,
    doctorId,
    instantOf(query.from, '00:00', clinic.timezone),
    instantOf(nextDate(query.to), '00:00', clinic.timezone),
  )

  return computeSlots({
    from: query.from,
    to: query.to,
    timeZone: clinic.timezone,
    blocks: doctor.availability,
    timeOff: doctor.timeOff,
    closedDates: clinic.closedDates,
    busy,
    durationMinutes,
    notBefore: query.notBefore,
  }).map((day) => ({
    date: day.date,
    slots: day.slots.map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    })),
  }))
}

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

  if (eachDate(query.from, query.to).length > MAX_DAYS) {
    throw new ValidationError('That is a longer stretch than slots are offered for.', [
      { field: 'to', issue: 'RANGE_TOO_LONG' },
    ])
  }

  // A patient booking for themselves is held to the clinic's notice period; the front desk is
  // not, so the same call answers both with the right offers (ADR-0022). Only the self-service
  // path pays for the extra read of the clinic's settings.
  let notBefore = now
  if (actor.permissions.get('appointment:create') === 'OWN') {
    const { bookingSettings } = await getSchedulingFacts(actor.clinicId)
    const { minimumNoticeHours } = bookingWindowOf(bookingSettings)
    notBefore = new Date(now.getTime() + minimumNoticeHours * 3_600_000)
  }

  return openSlots(actor.clinicId, doctorId, { ...query, notBefore })
}
