import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { BOOKING_WINDOW_DEFAULTS } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo, getClinicSettings } from '@clinic/core/clinic'
import { listDoctors } from '@clinic/core/doctors'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { shiftDate } from '@/lib/format/dates'
import { BookOwnForm } from './book-own-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.appointments.new')
  return { title: t('title') }
}

export default async function BookAppointmentPage() {
  const actor = await requirePortal('patient')
  const [clinic, settings, doctors, locale, t, tScheduling] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    // A portal does not imply clinic:read; without it the clinic's own defaults apply.
    holds(actor, 'clinic:read') ? getClinicSettings(actor) : null,
    holds(actor, 'doctor:read') ? listDoctors(actor, { status: 'active' }) : [],
    getLocale(),
    getTranslations('patient.appointments.new'),
    getTranslations('scheduling'),
  ])

  const today = localDateIn(clinic.timezone)
  const horizonDays = settings?.booking.horizonDays ?? BOOKING_WINDOW_DEFAULTS.horizonDays

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back={{ href: '/patient/appointments', label: tScheduling('backToAppointments') }}
      />

      {doctors.length === 0 ? (
        <EmptyState title={t('noDoctors')} body={t('noDoctorsBody')} />
      ) : (
        <BookOwnForm
          doctors={doctors.map((doctor) => ({
            id: doctor.id,
            name: [doctor.title, doctor.displayName].filter(Boolean).join(' '),
            specialties: doctor.specialties.map((specialty) => specialty.name).join(', '),
          }))}
          today={today}
          lastBookableDate={shiftDate(today, horizonDays)}
          locale={locale}
          timeZone={clinic.timezone}
        />
      )}
    </>
  )
}
