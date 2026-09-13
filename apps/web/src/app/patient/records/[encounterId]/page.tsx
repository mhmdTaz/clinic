import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import type { Prescription, StoredFile } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getEncounter } from '@clinic/core/clinical'
import { listFiles } from '@clinic/core/files'
import { listPrescriptions } from '@clinic/core/prescriptions'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { DocumentsCard } from '@/components/clinical/documents-card'
import { PrescriptionsCard } from '@/components/clinical/prescriptions-card'
import { requirePortal } from '@/lib/auth/server-session'
import { collectPages, noItems } from '@/lib/server/pages'
import { formatInstant } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('patient.records')
  return { title: t('visitTitle') }
}

/**
 * One visit, as the patient may read it (P4, ADR-0025).
 *
 * The note's words appear only when the doctor signed it and chose to share it. When they did
 * not, the page says so plainly — "your doctor has not shared the notes from this visit" is an
 * answer; an empty panel is a bug report waiting to happen.
 */
export default async function PatientVisitPage({ params }: { params: RouteParams<'encounterId'> }) {
  const actor = await requirePortal('patient')
  const { encounterId } = await params

  const encounter = await orNotFound(getEncounter(actor, encounterId))
  const [clinic, prescriptions, files, locale, t] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    holds(actor, 'prescription:read')
      ? collectPages((page) => listPrescriptions(actor, { encounterId, ...page }), 500)
      : noItems<Prescription>(),
    holds(actor, 'file:read')
      ? collectPages(
          (page) => listFiles(actor, { ownerType: 'ENCOUNTER', ownerId: encounterId, ...page }),
          500,
        )
      : noItems<StoredFile>(),
    getLocale(),
    getTranslations('patient.records'),
  ])

  // The server already withheld the text; this decides what to say about the gap.
  const sharedNote = SECTIONS.some((section) => encounter.note[section])

  return (
    <>
      <PageHeader
        title={t('visitWith', { doctor: encounter.doctor.name })}
        subtitle={formatInstant(encounter.startedAt, locale, clinic.timezone)}
        back={{ href: '/patient/records', label: t('title') }}
      />

      <div className="flex flex-col gap-4">
        {encounter.chiefComplaint || encounter.diagnoses.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('summary')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {encounter.chiefComplaint ? (
                <p className="text-sm break-words">{encounter.chiefComplaint}</p>
              ) : null}
              {encounter.diagnoses.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {encounter.diagnoses.map((diagnosis) => (
                    <li key={diagnosis.id}>
                      <Badge tone={diagnosis.isPrimary ? 'info' : 'neutral'}>
                        {diagnosis.description}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('notes')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {sharedNote ? (
              SECTIONS.map((section) =>
                encounter.note[section] ? (
                  <div key={section} className="flex flex-col gap-1">
                    <h2 className="text-sm font-semibold">{t(`sections.${section}`)}</h2>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {encounter.note[section]}
                    </p>
                  </div>
                ) : null,
              )
            ) : (
              <Alert tone="info">{t('notesNotShared')}</Alert>
            )}
          </CardContent>
        </Card>

        {prescriptions.items.length > 0 ? (
          <PrescriptionsCard prescriptions={prescriptions.items} timeZone={clinic.timezone} />
        ) : null}

        {files.items.length > 0 ? (
          <DocumentsCard
            files={files.items}
            timeZone={clinic.timezone}
            canShare={false}
            canDelete={false}
          />
        ) : null}
      </div>
    </>
  )
}
