import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getClinicProfile } from '@clinic/core/clinic'
import { getMe } from '@clinic/core/session'
import { ClinicContactCard } from '@/components/portal/clinic-contact-card'
import { ClinicHoursCard } from '@/components/portal/clinic-hours-card'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'
import { partOfDay } from '@/lib/format/greeting'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portals')
  return { title: t('doctor') }
}

export default async function DoctorOverviewPage() {
  const actor = await requireActor()
  const [me, clinic, t] = await Promise.all([
    getMe(actor),
    getClinicProfile(actor),
    getTranslations(),
  ])

  return (
    <>
      <PageHeader
        title={t(`greeting.${partOfDay(clinic.timezone)}`, { name: me.firstName })}
        subtitle={t('doctor.overview.subtitle', { clinicName: clinic.name })}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ClinicHoursCard clinic={clinic} />
        <ClinicContactCard clinic={clinic} title={clinic.name} />
      </div>
    </>
  )
}
