import type { AppointmentDetail, RegisterWalkInRequest } from '@clinic/contracts'
import { BusinessRuleError, ConflictError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { getSchedulingFacts } from '../../clinic'
import { localMoment } from '../../scheduling'
import { prepareBooking, writeAppointment } from './booking'
import { checkInAppointment } from './lifecycle'
import { openSlots } from './slots'

/**
 * How many of the doctor's next open times to try before giving up. Two desks registering
 * walk-ins at the same moment both aim at the same next slot; one loses the reservation race
 * (ADR-0013) and should simply take the one after it, not read an error about a time nobody
 * chose. Three is enough for a front desk and small enough to stay a bounded retry.
 */
const CANDIDATES = 3

/**
 * A patient who arrived without an appointment (S5, ADR-0023).
 *
 * They are booked into the doctor's next open time today and checked in at once, because they
 * are standing at the desk. The appointment is an ordinary appointment on an ordinary slot —
 * a walk-in never books off the grid, so the reservation documents keep making double-booking
 * impossible for everyone, including the person who walked in.
 */
export async function registerWalkIn(
  actor: Actor,
  input: RegisterWalkInRequest,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  await assertCan(actor, 'appointment:create')
  // Registering one is also checking them in; a desk that may do the first but not the second
  // would leave people waiting in a queue nobody could move.
  await assertCan(actor, 'appointment:check_in')

  const clinic = await getSchedulingFacts(actor.clinicId)
  const today = localMoment(now, clinic.timezone).date
  const [day] = await openSlots(actor.clinicId, input.doctorId, {
    from: today,
    to: today,
    notBefore: now,
  })
  const candidates = (day?.slots ?? []).slice(0, CANDIDATES)

  if (candidates.length === 0) {
    throw new BusinessRuleError(
      'NO_SLOT_TODAY',
      'That doctor has no open time left today. Book a later appointment instead.',
    )
  }

  for (const [index, slot] of candidates.entries()) {
    try {
      const prepared = await prepareBooking(actor, {
        doctorId: input.doctorId,
        patientId: input.patientId,
        startsAt: slot.startsAt,
        branchId: input.branchId,
      })
      const appointment = await writeAppointment(actor, prepared, {
        source: 'WALK_IN',
        reason: input.reason,
        internalNote: input.internalNote,
        branchId: input.branchId,
      })
      return checkInAppointment(actor, appointment.id, now)
    } catch (error) {
      const lost = error instanceof ConflictError && error.code === 'SLOT_TAKEN'
      if (!lost || index === candidates.length - 1) throw error
    }
  }

  // Unreachable: the loop either returns or rethrows on its last candidate.
  throw new BusinessRuleError('NO_SLOT_TODAY', 'That doctor has no open time left today.')
}
