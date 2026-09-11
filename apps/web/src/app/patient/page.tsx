import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { holds } from '@clinic/core/access'
import { getClinicProfile, getClinicSessionInfo } from '@clinic/core/clinic'
import { getMe } from '@clinic/core/session'
import { ClinicContactCard } from '@/components/portal/clinic-contact-card'
import { ClinicHoursCard } from '@/components/portal/clinic-hours-card'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { partOfDay } from '@/lib/format/greeting'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portals')
  return { title: t('patient') }
}

export default async function PatientOverviewPage() {
  const actor = await requirePortal('patient')
  // A portal does not imply clinic:read — a custom role may grant one without the other — so
  // the home page still works without it, just without the clinic cards.
  const [me, session, clinic, t] = await Promise.all([
    getMe(actor),
    getClinicSessionInfo(actor.clinicId),
    holds(actor, 'clinic:read') ? getClinicProfile(actor) : null,
    getTranslations(),
  ])

  return (
    <>
      <PageHeader
        title={t(`greeting.${partOfDay(session.timezone)}`, { name: me.firstName })}
        subtitle={t('patient.overview.subtitle', { clinicName: session.name })}
      />
      {clinic ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ClinicContactCard clinic={clinic} />
          <ClinicHoursCard clinic={clinic} />
        </div>
      ) : null}
    </>
  )
}
