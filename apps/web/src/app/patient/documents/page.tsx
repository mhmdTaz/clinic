import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listFiles } from '@clinic/core/files'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { DocumentsCard } from '@/components/clinical/documents-card'
import { requirePortal } from '@/lib/auth/server-session'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { collectPages } from '@/lib/server/pages'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.documents')
  return { title: t('title') }
}

/**
 * The document vault (P6): everything the clinic chose to share, in one place.
 *
 * The scope does the filtering, not this page — an OWN grant on a file reaches the patient's own
 * documents and only those flagged visible (ADR-0025), so there is nothing here to get wrong.
 */
export default async function PatientDocumentsPage() {
  const actor = await requirePortal('patient')
  const [clinic, t, tScheduling] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getTranslations('patient.documents'),
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

  const files = await collectPages((page) => listFiles(actor, page), 500)

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DocumentsCard
        files={files.items}
        timeZone={clinic.timezone}
        canShare={false}
        canDelete={false}
        title={t('title')}
        emptyBody={t('emptyBody')}
      />
      <TruncatedNotice shown={files.items.length} truncated={files.truncated} />
    </>
  )
}
