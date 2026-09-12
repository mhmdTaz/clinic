import { getTranslations } from 'next-intl/server'
import { localDateIn, type AppointmentSummary } from '@clinic/contracts'
import { holds, type Actor } from '@clinic/core/access'
import { canTransition, holdsSlot } from '@clinic/core/appointments'
import { ConfirmAction } from '@/components/portal/confirm-action'
import { QuickAction } from './quick-action'
import { RescheduleDialog } from './reschedule-dialog'

/**
 * What this person may do to this appointment, right now.
 *
 * The answer comes from the same status machine the server enforces (domain/status.ts) crossed
 * with the actor's permissions, so a button is never offered for a move that would be refused —
 * and never hidden for one that would be allowed. The server checks again regardless; this only
 * decides what is worth showing.
 */
function allowedActions(actor: Actor, status: AppointmentSummary['status']) {
  const mayUpdate = holds(actor, 'appointment:update')
  // A grant at OWN is a patient acting on their own appointment. They may move it or give it
  // up; recording what happened in the room is the clinic's, and the server refuses the rest
  // (lifecycle.assertClinicSide, ADR-0022).
  const clinicSide = mayUpdate && actor.permissions.get('appointment:update') !== 'OWN'
  return {
    checkIn: canTransition(status, 'CHECKED_IN') && holds(actor, 'appointment:check_in'),
    start: canTransition(status, 'IN_PROGRESS') && clinicSide,
    complete: canTransition(status, 'COMPLETED') && clinicSide,
    reschedule: holdsSlot(status) && mayUpdate,
    noShow: canTransition(status, 'NO_SHOW') && clinicSide,
    cancel: canTransition(status, 'CANCELLED') && holds(actor, 'appointment:cancel'),
  }
}

export async function AppointmentActions({
  actor,
  appointment,
  locale,
  timeZone,
}: {
  actor: Actor
  appointment: AppointmentSummary
  locale: string
  timeZone: string
}) {
  const allowed = allowedActions(actor, appointment.status)
  if (!Object.values(allowed).some(Boolean)) return null

  const t = await getTranslations('scheduling')
  const base = `/api/v1/appointments/${appointment.id}`
  const who = { patient: appointment.patient.name }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {allowed.checkIn ? (
        <QuickAction label={t('actions.checkIn')} action={`${base}/check-in`} variant="secondary" />
      ) : null}
      {allowed.start ? <QuickAction label={t('actions.start')} action={`${base}/start`} /> : null}
      {allowed.complete ? (
        <QuickAction
          label={t('actions.complete')}
          action={`${base}/complete`}
          variant="secondary"
        />
      ) : null}
      {allowed.reschedule ? (
        <RescheduleDialog
          appointmentId={appointment.id}
          doctorId={appointment.doctor.id}
          date={localDateIn(timeZone, new Date(appointment.startsAt))}
          durationMinutes={appointment.durationMinutes}
          locale={locale}
          timeZone={timeZone}
          label={t('actions.reschedule')}
        />
      ) : null}
      {allowed.noShow ? (
        <ConfirmAction
          label={t('actions.noShow')}
          title={t('confirm.noShowTitle')}
          body={t('confirm.noShowBody', who)}
          confirmLabel={t('confirm.noShowConfirm')}
          action={`${base}/no-show`}
          withReason
        />
      ) : null}
      {allowed.cancel ? (
        <ConfirmAction
          label={t('actions.cancel')}
          title={t('confirm.cancelTitle')}
          body={t('confirm.cancelBody', who)}
          confirmLabel={t('confirm.cancelConfirm')}
          action={`${base}/cancel`}
          withReason
        />
      ) : null}
    </div>
  )
}
