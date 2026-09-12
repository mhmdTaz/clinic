import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getDoctorSchedule } from '@clinic/core/doctors'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { AvailabilityCard } from '@/components/scheduling/availability-card'
import { TimeOffCard } from '@/components/scheduling/time-off-card'
import { requirePortal } from '@/lib/auth/server-session'
import { WEEK_ORDER, weekdayName } from '@/lib/format/weekdays'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('doctor.schedule')
  return { title: t('title') }
}

export default async function DoctorSchedulePage() {
  const actor = await requirePortal('doctor')
  const [clinic, locale, t, tScheduling] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getLocale(),
    getTranslations('doctor.schedule'),
    getTranslations('scheduling'),
  ])

  if (!actor.doctorId) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={tScheduling('noDoctorProfile')} body={tScheduling('askAnAdmin')} />
      </>
    )
  }

  const schedule = await getDoctorSchedule(actor, actor.doctorId)
  const canEdit = holds(actor, 'availability:manage')

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <AvailabilityCard
          doctorId={schedule.doctorId}
          blocks={schedule.blocks}
          slotMinutes={schedule.slotMinutes}
          timezone={clinic.timezone}
          weekdays={WEEK_ORDER.map((day) => ({ day, name: weekdayName(day, locale) }))}
          canEdit={canEdit}
        />
        <TimeOffCard
          doctorId={schedule.doctorId}
          entries={schedule.timeOff}
          today={localDateIn(clinic.timezone)}
          locale={locale}
          canEdit={canEdit}
        />
      </div>
    </>
  )
}
