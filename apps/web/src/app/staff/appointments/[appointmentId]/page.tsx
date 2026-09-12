import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { getAppointment } from '@clinic/core/appointments'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { AppointmentStatusBadge } from '@/components/portal/status-badges'
import { AppointmentActions } from '@/components/scheduling/appointment-actions'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate, formatInstant, formatTimeRange } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.appointments')
  return { title: t('detail.title') }
}

export default async function AppointmentDetailPage({
  params,
}: {
  params: RouteParams<'appointmentId'>
}) {
  const actor = await requirePortal('staff')
  const { appointmentId } = await params
  const [appointment, clinic, locale, t, tScheduling, tCommon] = await Promise.all([
    orNotFound(getAppointment(actor, appointmentId)),
    getClinicSessionInfo(actor.clinicId),
    getLocale(),
    getTranslations('staff.appointments'),
    getTranslations('scheduling'),
    getTranslations('common'),
  ])

  const zone = clinic.timezone
  // The clinic's day, not the ISO string's UTC date: 23:30 in Beirut is the next day in UTC.
  const day = formatCalendarDate(localDateIn(zone, new Date(appointment.startsAt)), locale, 'full')
  const facts: Array<{ term: string; value: string }> = [
    {
      term: t('detail.when'),
      value: `${day} · ${formatTimeRange(appointment.startsAt, appointment.endsAt, locale, zone)}`,
    },
    {
      term: t('detail.duration'),
      value: tScheduling('minutes', { count: appointment.durationMinutes }),
    },
    { term: t('detail.doctor'), value: appointment.doctor.name },
    { term: t('detail.source'), value: tScheduling(`sources.${appointment.source}`) },
    { term: t('detail.reason'), value: appointment.reason ?? tCommon('notSet') },
    { term: t('detail.internalNote'), value: appointment.internalNote ?? tCommon('none') },
  ]

  return (
    <>
      <PageHeader
        title={appointment.patient.name}
        subtitle={t('detail.subtitle', { number: appointment.number })}
        back={{ href: '/staff/appointments', label: t('title') }}
        badges={
          <AppointmentStatusBadge
            status={appointment.status}
            label={tScheduling(`statuses.${appointment.status}`)}
          />
        }
      />

      <div className="flex flex-col gap-4">
        <AppointmentActions
          actor={actor}
          appointment={appointment}
          locale={locale}
          timeZone={zone}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {facts.map((fact) => (
                  <div key={fact.term} className="contents">
                    <dt className="text-muted-foreground">{fact.term}</dt>
                    <dd className="min-w-0 break-words">{fact.value}</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground">{t('detail.patient')}</dt>
                <dd className="min-w-0 break-words">
                  <Link
                    href={`/staff/patients/${appointment.patient.id}`}
                    className="font-medium hover:underline"
                  >
                    {appointment.patient.name}
                  </Link>
                  <span className="text-muted-foreground block text-xs tabular-nums">
                    {appointment.patient.medicalRecordNo}
                    {appointment.patient.phone ? ` · ${appointment.patient.phone}` : ''}
                  </span>
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('detail.history')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {appointment.statusHistory.map((entry, index) => (
                  <li key={`${entry.changedAt}-${index}`} className="flex flex-col gap-0.5 text-sm">
                    <span className="font-medium">{tScheduling(`statuses.${entry.toStatus}`)}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatInstant(entry.changedAt, locale, zone)}
                      {entry.changedBy ? ` · ${entry.changedBy.name}` : ''}
                    </span>
                    {entry.reason ? <span className="break-words">{entry.reason}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
