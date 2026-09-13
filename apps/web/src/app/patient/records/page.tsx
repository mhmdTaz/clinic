import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { listEncounters } from '@clinic/core/clinical'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { EncounterList } from '@/components/clinical/encounter-list'
import { requirePortal } from '@/lib/auth/server-session'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { collectPages } from '@/lib/server/pages'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.records')
  return { title: t('title') }
}

/**
 * A patient's own record of their care (P4, P10).
 *
 * The visit, its date, its doctor and what it was decided to be are theirs — those are facts
 * about their own care. The note's text is not here at all: a timeline lists visits, and the
 * words are only read on a visit that was signed and shared (ADR-0025).
 */
export default async function PatientRecordsPage() {
  const actor = await requirePortal('patient')
  const [clinic, t, tScheduling] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getTranslations('patient.records'),
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

  const encounters = await collectPages((page) => listEncounters(actor, page), 500)

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <EncounterList
        encounters={encounters.items}
        timeZone={clinic.timezone}
        hrefFor={(encounter) => `/patient/records/${encounter.id}`}
        show={{ doctor: true }}
        emptyTitle={t('emptyTitle')}
        emptyBody={t('emptyBody')}
      />
      <TruncatedNotice shown={encounters.items.length} truncated={encounters.truncated} />
    </>
  )
}
