import type { ReactNode } from 'react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { localDateIn, type AppointmentSummary } from '@clinic/contracts'
import { Badge } from '@clinic/ui'
import { AppointmentStatusBadge } from '@/components/portal/status-badges'
import { formatCalendarDate, formatTimeRange } from '@/lib/format/dates'

/**
 * One appointment, wherever it is shown: the clinic's calendar, a doctor's day, a patient's own
 * list. Times are always drawn in the clinic's timezone (ADR-0010) — a patient travelling is
 * told the time they must be at the clinic, not the time it is where they are standing.
 */
export async function AppointmentCard({
  appointment,
  locale,
  timeZone,
  href,
  show,
  actions,
}: {
  appointment: AppointmentSummary
  locale: string
  timeZone: string
  /** Links to the detail page where there is one to link to. */
  href?: string
  /**
   * `date` is for lists that run across days. A calendar column already names its day, and
   * repeating it on every card there would only be noise.
   */
  show: { patient?: boolean; doctor?: boolean; recordNumber?: boolean; date?: boolean }
  actions?: ReactNode
}) {
  const t = await getTranslations('scheduling')
  const title = show.patient
    ? appointment.patient.name
    : t('withDoctor', {
        doctor: appointment.doctor.name,
      })

  return (
    <article className="border-border bg-card flex flex-col gap-2 rounded-[var(--radius-card)] border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-muted-foreground text-sm">
            {show.date ? (
              <>
                {formatCalendarDate(localDateIn(timeZone, new Date(appointment.startsAt)), locale)}
                {' · '}
              </>
            ) : null}
            <span className="tabular-nums">
              {formatTimeRange(appointment.startsAt, appointment.endsAt, locale, timeZone)}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 font-medium break-words">
            {href ? (
              <Link href={href} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
            {/* Worth saying anywhere it shows: this person arrived without an appointment. */}
            {appointment.source === 'WALK_IN' ? (
              <Badge tone="neutral">{t('sources.WALK_IN')}</Badge>
            ) : null}
          </span>
          {show.doctor && show.patient ? (
            <span className="text-muted-foreground text-xs">
              {t('withDoctor', { doctor: appointment.doctor.name })}
            </span>
          ) : null}
          {show.recordNumber ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {appointment.patient.medicalRecordNo}
              {appointment.patient.phone ? ` · ${appointment.patient.phone}` : ''}
            </span>
          ) : null}
        </div>
        <AppointmentStatusBadge
          status={appointment.status}
          label={t(`statuses.${appointment.status}`)}
        />
      </div>

      {appointment.reason ? <p className="text-sm break-words">{appointment.reason}</p> : null}
      {actions}
    </article>
  )
}
