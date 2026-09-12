import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listPrescriptions } from '@clinic/core/prescriptions'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { PrescriptionsCard } from '@/components/clinical/prescriptions-card'
import { requirePortal } from '@/lib/auth/server-session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.prescriptions')
  return { title: t('title') }
}

/**
 * A patient's medications (P7): what they are still meant to be taking, and everything before it.
 * Each one prints to the same PDF the clinic would hand them at the desk (ADR-0026).
 */
export default async function PatientPrescriptionsPage() {
  const actor = await requirePortal('patient')
  const [clinic, t, tScheduling] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getTranslations('patient.prescriptions'),
    getTranslations('scheduling'),
  ])

  if (!actor.patientId) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={tScheduling('noPatientProfile')} body={tScheduling('askAnAdmin')} />
      </>
    )
  }

  const [active, all] = await Promise.all([
    listPrescriptions(actor, { active: true }),
    listPrescriptions(actor, {}),
  ])
  const activeIds = new Set(active.map((prescription) => prescription.id))
  const past = all.filter((prescription) => !activeIds.has(prescription.id))

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <PrescriptionsCard
          prescriptions={active}
          timeZone={clinic.timezone}
          title={t('current')}
          emptyBody={t('noneBody')}
        />
        {past.length > 0 ? (
          <PrescriptionsCard prescriptions={past} timeZone={clinic.timezone} title={t('past')} />
        ) : null}
      </div>
    </>
  )
}
