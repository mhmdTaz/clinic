import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { listAppointments } from '@clinic/core/appointments'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { buttonVariants } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { AppointmentActions } from '@/components/scheduling/appointment-actions'
import { AppointmentCard } from '@/components/scheduling/appointment-card'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate, shiftDate } from '@/lib/format/dates'

/** How far back and forward a patient's own list reaches. */
const HISTORY_DAYS = 365
const AHEAD_DAYS = 365

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.appointments')
  return { title: t('title') }
}

export default async function PatientAppointmentsPage() {
  const actor = await requirePortal('patient')
  const [clinic, locale, t, tScheduling] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getLocale(),
    getTranslations('patient.appointments'),
    getTranslations('scheduling'),
  ])

  // Without a patient record there is nothing to list, and the refusal would be a blank error.
  if (!actor.patientId) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={tScheduling('noPatientProfile')} body={tScheduling('askAnAdmin')} />
      </>
    )
  }

  const today = localDateIn(clinic.timezone)
  const appointments = await listAppointments(actor, {
    from: shiftDate(today, -HISTORY_DAYS),
    to: shiftDate(today, AHEAD_DAYS),
  })

  const now = Date.now()
  const upcoming = appointments.filter((a) => new Date(a.endsAt).getTime() >= now)
  // Most recent first: what happened last week matters more than what happened last year.
  const past = appointments.filter((a) => new Date(a.endsAt).getTime() < now).reverse()

  const book = holds(actor, 'appointment:create') ? (
    <Link href="/patient/appointments/new" className={buttonVariants()}>
      {t('book')}
    </Link>
  ) : null

  const card = (appointment: (typeof appointments)[number], withActions: boolean) => (
    <AppointmentCard
      key={appointment.id}
      appointment={appointment}
      locale={locale}
      timeZone={clinic.timezone}
      show={{ doctor: true, date: true }}
      actions={
        withActions ? (
          <AppointmentActions
            actor={actor}
            appointment={appointment}
            locale={locale}
            timeZone={clinic.timezone}
          />
        ) : null
      }
    />
  )

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={book} />

      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('upcoming')}</h2>
          {upcoming.length === 0 ? (
            <EmptyState title={t('noneUpcoming')} body={t('noneUpcomingBody')} action={book} />
          ) : (
            <div className="flex flex-col gap-3">
              {upcoming.map((appointment) => card(appointment, true))}
            </div>
          )}
        </section>

        {past.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('past')}</h2>
            <p className="text-muted-foreground text-sm">
              {t('pastSince', {
                date: formatCalendarDate(shiftDate(today, -HISTORY_DAYS), locale),
              })}
            </p>
            <div className="flex flex-col gap-3">
              {past.map((appointment) => card(appointment, false))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
