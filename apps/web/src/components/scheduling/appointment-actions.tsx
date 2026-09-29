import { Phone } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { localDateIn, type AppointmentSummary } from '@clinic/contracts'
import { holds, type Actor, type PermissionKey } from '@clinic/core/access'
import { buttonVariants } from '@clinic/ui'
import { canTransition, holdsSlot } from '@clinic/core/appointments'
import { ConfirmAction } from '@/components/portal/confirm-action'
import { formatInstant } from '@/lib/format/dates'
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

/**
 * A patient changing their own appointment is held to the clinic's cutoff (ADR-0022); the clinic's
 * staff are not. The deadline itself comes from the server on the appointment, so this compares it
 * with the clock and keeps no copy of the rule. The server refuses a late change regardless — the
 * cutoff can pass while the page is open.
 */
function selfServiceClosed(
  actor: Actor,
  permission: PermissionKey,
  appointment: AppointmentSummary,
  now: number,
): boolean {
  if (actor.permissions.get(permission) !== 'OWN') return false
  const until = appointment.changeableOnlineUntil
  return until !== null && now > new Date(until).getTime()
}

export async function AppointmentActions({
  actor,
  appointment,
  locale,
  timeZone,
  clinicPhone = null,
}: {
  actor: Actor
  appointment: AppointmentSummary
  locale: string
  timeZone: string
  /** Offered as the way to change an appointment once it is too late to do it online. */
  clinicPhone?: string | null
}) {
  const offered = allowedActions(actor, appointment.status)
  const now = Date.now()
  const closedToReschedule =
    offered.reschedule && selfServiceClosed(actor, 'appointment:update', appointment, now)
  const closedToCancel =
    offered.cancel && selfServiceClosed(actor, 'appointment:cancel', appointment, now)
  const allowed = {
    ...offered,
    reschedule: offered.reschedule && !closedToReschedule,
    cancel: offered.cancel && !closedToCancel,
  }
  const closed = closedToReschedule || closedToCancel
  // Said before anyone opens a dialog or types a reason (audit F06): until when, and after that,
  // how instead.
  const selfService =
    (allowed.cancel && actor.permissions.get('appointment:cancel') === 'OWN') ||
    (allowed.reschedule && actor.permissions.get('appointment:update') === 'OWN')
  if (!Object.values(allowed).some(Boolean) && !closed) return null

  const t = await getTranslations('scheduling')
  const until = appointment.changeableOnlineUntil
    ? formatInstant(appointment.changeableOnlineUntil, locale, timeZone)
    : null
  const base = `/api/v1/appointments/${appointment.id}`
  const who = { patient: appointment.patient.name }

  return (
    <div className="flex flex-col gap-2">
      {closed ? (
        <div className="flex flex-col gap-2 text-sm" role="note">
          <p className="text-muted-foreground">{t('changeClosed', { until: until ?? '' })}</p>
          {clinicPhone ? (
            <a
              href={`tel:${clinicPhone.replace(/[^+\d]/g, '')}`}
              className={buttonVariants({
                variant: 'outline',
                size: 'sm',
                className: 'self-start',
              })}
            >
              <Phone className="size-4" aria-hidden="true" />
              {t('callClinic', { phone: clinicPhone })}
            </a>
          ) : (
            <p className="text-muted-foreground">{t('contactClinic')}</p>
          )}
        </div>
      ) : selfService && until ? (
        <p className="text-muted-foreground text-xs">{t('changeOpenUntil', { until })}</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        {allowed.checkIn ? (
          <QuickAction
            label={t('actions.checkIn')}
            action={`${base}/check-in`}
            variant="secondary"
          />
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
    </div>
  )
}
