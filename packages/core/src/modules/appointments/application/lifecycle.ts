import type { AppointmentStatus } from '@clinic/config'
import type {
  AppointmentDetail,
  CancelAppointmentRequest,
  RescheduleAppointmentRequest,
} from '@clinic/contracts'
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { emitEvent } from '../../outbox'
import { assertCan, type Actor, type PermissionKey } from '../../access'
import { getSchedulingFacts } from '../../clinic'
import { bookingWindowOf, gridCellIds, withinCancellationWindow } from '../../scheduling'
import {
  appointmentRepository,
  isSlotTaken,
  type StoredAppointment,
} from '../infrastructure/appointment.repository'
import { canTransition, holdsSlot } from '../domain/status'
import { prepareBooking } from './booking'
import { toAppointmentDetail } from './directory'
import { appointmentResource, readsWholeClinic } from './scope'

async function load(
  actor: Actor,
  appointmentId: string,
  permission: PermissionKey,
): Promise<StoredAppointment> {
  const appointment = await appointmentRepository.findById(actor.clinicId, appointmentId)
  if (!appointment) throw new NotFoundError('Appointment')
  await assertCan(
    actor,
    permission,
    appointmentResource(actor, {
      id: appointment.id,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
    }),
  )
  return appointment
}

/**
 * The clinic's cutoff binds self-service only (ADR-0022): a grant at OWN scope is a patient
 * acting on their own appointment. Staff and doctors are not held to it.
 */
async function assertChangeAllowed(
  actor: Actor,
  appointment: StoredAppointment,
  permission: PermissionKey,
  now: Date,
): Promise<void> {
  if (actor.permissions.get(permission) !== 'OWN') return
  const { bookingSettings } = await getSchedulingFacts(actor.clinicId, appointment.branchId)
  if (!withinCancellationWindow(appointment.startsAt, bookingWindowOf(bookingSettings), now)) {
    throw new BusinessRuleError(
      'TOO_LATE_TO_CHANGE',
      'That is too close to the appointment to change online. Please call the clinic.',
    )
  }
}

/**
 * Steps only the clinic itself takes: the patient has arrived, the doctor has taken them in,
 * the visit is over, nobody came. `appointment:update` at OWN is a patient acting on their own
 * appointment (ADR-0022) — enough to move it or give it up, never to record what happened in a
 * room they were not in. Without this, granting patients the reschedule they are promised (P5)
 * would also let them close their own visit as completed.
 */
function assertClinicSide(actor: Actor): void {
  if (actor.permissions.get('appointment:update') === 'OWN') {
    throw new ForbiddenError('appointment:update')
  }
}

async function transition(
  actor: Actor,
  appointment: StoredAppointment,
  to: AppointmentStatus,
  patch: Record<string, unknown>,
  reason: string | null,
): Promise<StoredAppointment> {
  if (!canTransition(appointment.status, to)) {
    throw new BusinessRuleError(
      'INVALID_TRANSITION',
      `An appointment that is ${appointment.status.toLowerCase().replace('_', ' ')} cannot become ${to
        .toLowerCase()
        .replace('_', ' ')}.`,
    )
  }

  const history = {
    fromStatus: appointment.status,
    toStatus: to,
    reason,
    changedBy: { id: actor.userId, name: actor.displayName },
    changedAt: new Date(),
  }

  // Time is given back the moment an appointment stops holding it.
  const releases = holdsSlot(appointment.status) && !holdsSlot(to)
  const updated = releases
    ? await runInTransaction(async (tx) => {
        await appointmentRepository.release(actor.clinicId, appointment.id, tx)
        return appointmentRepository.applyChange(
          actor.clinicId,
          appointment.id,
          { ...patch, status: to },
          history,
          tx,
        )
      })
    : await appointmentRepository.applyChange(
        actor.clinicId,
        appointment.id,
        { ...patch, status: to },
        history,
      )

  if (!updated) throw new NotFoundError('Appointment')
  return updated
}

function detailFor(actor: Actor, appointment: StoredAppointment): AppointmentDetail {
  return toAppointmentDetail(appointment, {
    includeInternalNote: readsWholeClinic(actor) || actor.doctorId === appointment.doctorId,
  })
}

/** Moving an appointment keeps its number and its history; the slot moves with it. */
export async function rescheduleAppointment(
  actor: Actor,
  appointmentId: string,
  input: RescheduleAppointmentRequest,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  const appointment = await load(actor, appointmentId, 'appointment:update')
  if (!holdsSlot(appointment.status)) {
    throw new BusinessRuleError(
      'INVALID_TRANSITION',
      'Only an appointment still holding its time can be moved.',
    )
  }
  await assertChangeAllowed(actor, appointment, 'appointment:update', now)

  const prepared = await prepareBooking(actor, {
    doctorId: appointment.doctorId,
    patientId: appointment.patientId,
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes ?? appointment.durationMinutes,
    branchId: appointment.branchId,
  })

  const moved = await runInTransaction(async (tx) => {
    await appointmentRepository.release(actor.clinicId, appointment.id, tx)
    try {
      await appointmentRepository.reserve(
        {
          clinicId: actor.clinicId,
          doctorId: appointment.doctorId,
          appointmentId: appointment.id,
          cellIds: gridCellIds(appointment.doctorId, prepared.startsAt, prepared.endsAt),
        },
        tx,
      )
    } catch (error) {
      if (isSlotTaken(error)) {
        throw new ConflictError('SLOT_TAKEN', 'That slot was just booked by someone else.')
      }
      throw error
    }

    return appointmentRepository.applyChange(
      actor.clinicId,
      appointment.id,
      {
        startsAt: prepared.startsAt,
        endsAt: prepared.endsAt,
        durationMinutes: prepared.durationMinutes,
      },
      {
        fromStatus: appointment.status,
        toStatus: appointment.status,
        reason: input.reason,
        changedBy: { id: actor.userId, name: actor.displayName },
        changedAt: new Date(),
      },
      tx,
    )
  })

  if (!moved) throw new NotFoundError('Appointment')
  return detailFor(actor, moved)
}

export async function cancelAppointment(
  actor: Actor,
  appointmentId: string,
  input: CancelAppointmentRequest,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  const appointment = await load(actor, appointmentId, 'appointment:cancel')
  await assertChangeAllowed(actor, appointment, 'appointment:cancel', now)

  const cancelled = await transition(
    actor,
    appointment,
    'CANCELLED',
    {
      cancelledAt: now,
      cancelledBy: { id: actor.userId, name: actor.displayName },
      cancelReason: input.reason,
    },
    input.reason,
  )

  // Outside a transaction, because the cancellation above was not in one either: `transition`
  // is a single conditional update, so there is nothing here for an outbox write to be atomic
  // *with*. The backstop sweep is what makes it certain rather than merely likely (13.4).
  await emitEvent(
    actor.clinicId,
    'appointment.cancelled',
    { appointmentId, reason: input.reason ?? undefined },
    undefined,
    now,
  )

  return detailFor(actor, cancelled)
}

export async function checkInAppointment(
  actor: Actor,
  appointmentId: string,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  const appointment = await load(actor, appointmentId, 'appointment:check_in')
  const checkedIn = await transition(actor, appointment, 'CHECKED_IN', { checkedInAt: now }, null)
  return detailFor(actor, checkedIn)
}

export async function startAppointment(
  actor: Actor,
  appointmentId: string,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  const appointment = await load(actor, appointmentId, 'appointment:update')
  assertClinicSide(actor)
  const started = await transition(actor, appointment, 'IN_PROGRESS', { startedAt: now }, null)
  return detailFor(actor, started)
}

export async function completeAppointment(
  actor: Actor,
  appointmentId: string,
  now: Date = new Date(),
): Promise<AppointmentDetail> {
  const appointment = await load(actor, appointmentId, 'appointment:update')
  assertClinicSide(actor)
  const completed = await transition(actor, appointment, 'COMPLETED', { completedAt: now }, null)
  return detailFor(actor, completed)
}

/** The patient did not arrive. The time is released, and the record keeps why. */
export async function markNoShow(
  actor: Actor,
  appointmentId: string,
  reason: string | null = null,
): Promise<AppointmentDetail> {
  const appointment = await load(actor, appointmentId, 'appointment:update')
  assertClinicSide(actor)
  const missed = await transition(actor, appointment, 'NO_SHOW', {}, reason)
  return detailFor(actor, missed)
}
