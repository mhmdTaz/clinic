import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getEncounter } from '@clinic/core/clinical'
import { listConsumption, listItems } from '@clinic/core/inventory'
import { listFiles } from '@clinic/core/files'
import { getPatient } from '@clinic/core/patients'
import { listPrescriptions } from '@clinic/core/prescriptions'
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { AddendumForm } from '@/components/clinical/addendum-form'
import { ChartBanner } from '@/components/clinical/chart-banner'
import { DiagnosisEditor } from '@/components/clinical/diagnosis-editor'
import { DocumentsCard } from '@/components/clinical/documents-card'
import { NoteEditor } from '@/components/clinical/note-editor'
import { PrescriptionBuilder } from '@/components/clinical/prescription-builder'
import { PrescriptionsCard } from '@/components/clinical/prescriptions-card'
import { ConsumptionCard } from '@/components/inventory/consumption-card'
import { RecordConsumptionDialog } from '@/components/inventory/record-consumption-dialog'
import { SignNoteDialog } from '@/components/clinical/sign-note-dialog'
import { VitalsForm } from '@/components/clinical/vitals-form'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('doctor.encounter')
  return { title: t('title') }
}

/**
 * The encounter workspace (D6–D9).
 *
 * Two states, not one screen with fields disabled: a draft is written, and a signed note is read.
 * After signing, the only thing that can be added is an addendum beneath it (ADR-0024), and the
 * page says so rather than showing a form that the server would refuse.
 */
export default async function EncounterWorkspacePage({
  params,
}: {
  params: RouteParams<'encounterId'>
}) {
  const actor = await requirePortal('doctor')
  const { encounterId } = await params

  const encounter = await orNotFound(getEncounter(actor, encounterId))
  const [clinic, patient, prescriptions, files, consumed, stock, locale, t, tCommon, tStock] =
    await Promise.all([
      getClinicSessionInfo(actor.clinicId),
      getPatient(actor, encounter.patient.id).catch(() => null),
      holds(actor, 'prescription:read')
        ? listPrescriptions(actor, { encounterId: encounter.id })
        : [],
      holds(actor, 'file:read')
        ? listFiles(actor, { ownerType: 'ENCOUNTER', ownerId: encounter.id })
        : [],
      holds(actor, 'inventory:read') ? listConsumption(actor, encounter.id) : [],
      // The pick-list for the dialog: what is actually on the shelf right now.
      holds(actor, 'inventory:consume') ? listItems(actor, { status: 'active', view: 'all' }) : [],
      getLocale(),
      getTranslations('doctor.encounter'),
      getTranslations('common'),
      getTranslations('inventory.consume'),
    ])

  const signed = encounter.note.status === 'SIGNED'
  const mine = actor.doctorId === encounter.doctor.id
  const canWrite = holds(actor, 'encounter:write') && mine
  const canSign = holds(actor, 'encounter:sign') && mine

  return (
    <>
      <PageHeader
        title={encounter.patient.name}
        subtitle={t('subtitle', {
          number: encounter.number,
          started: formatInstant(encounter.startedAt, locale, clinic.timezone),
        })}
        back={{ href: `/doctor/patients/${encounter.patient.id}`, label: t('backToChart') }}
        badges={
          <>
            <Badge tone={signed ? 'success' : 'warning'}>
              {t(`noteStatuses.${encounter.note.status}`)}
            </Badge>
            {encounter.note.isPatientVisible ? (
              <Badge tone="info">{t('sharedWithPatient')}</Badge>
            ) : null}
          </>
        }
        actions={
          !signed && canSign ? (
            <SignNoteDialog
              encounterId={encounter.id}
              doctorName={encounter.doctor.name}
              label={t('sign')}
            />
          ) : null
        }
      />

      {patient ? (
        <ChartBanner
          patientId={patient.id}
          banner={{ allergies: patient.allergies, chronicConditions: patient.chronicConditions }}
          canEdit={holds(actor, 'patient:update')}
        />
      ) : null}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('note')}</CardTitle>
            <CardDescription>
              {signed
                ? t('signedBy', {
                    name: encounter.note.signedBy?.name ?? '',
                    at: encounter.note.signedAt
                      ? formatInstant(encounter.note.signedAt, locale, clinic.timezone)
                      : '',
                  })
                : t('draftHint')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {signed ? (
              <>
                <Alert tone="info">{t('signedNotice')}</Alert>
                {SECTIONS.map((section) => (
                  <div key={section} className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">{t(`sections.${section}`)}</h3>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {encounter.note[section] ?? (
                        <span className="text-muted-foreground">{tCommon('none')}</span>
                      )}
                    </p>
                  </div>
                ))}

                {encounter.note.addenda.length > 0 ? (
                  <div className="border-border flex flex-col gap-3 border-t pt-4">
                    <h3 className="text-sm font-semibold">{t('addenda')}</h3>
                    {encounter.note.addenda.map((addendum) => (
                      <div key={addendum.id} className="flex flex-col gap-0.5">
                        <span className="text-muted-foreground text-xs">
                          {addendum.author?.name ?? ''}
                          {addendum.createdAt
                            ? ` · ${formatInstant(addendum.createdAt, locale, clinic.timezone)}`
                            : ''}
                        </span>
                        <p className="text-sm break-words whitespace-pre-wrap">{addendum.body}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {canSign ? (
                  <div className="border-border border-t pt-4">
                    <AddendumForm encounterId={encounter.id} />
                  </div>
                ) : null}
              </>
            ) : canWrite ? (
              <NoteEditor
                encounterId={encounter.id}
                note={encounter.note}
                canShare={holds(actor, 'encounter:write')}
              />
            ) : (
              <Alert tone="info">{t('notYours')}</Alert>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('vitals')}</CardTitle>
            </CardHeader>
            <CardContent>
              <VitalsForm
                encounterId={encounter.id}
                vitals={encounter.vitals}
                readOnly={signed || !canWrite}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('diagnoses')}</CardTitle>
              <CardDescription>{t('diagnosesHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <DiagnosisEditor
                encounterId={encounter.id}
                diagnoses={encounter.diagnoses}
                readOnly={signed || !canWrite}
              />
            </CardContent>
          </Card>
        </div>

        <PrescriptionsCard
          prescriptions={prescriptions}
          timeZone={clinic.timezone}
          emptyBody={t('noPrescriptionsBody')}
          action={
            holds(actor, 'prescription:issue') && mine ? (
              <PrescriptionBuilder encounterId={encounter.id} label={t('prescribe')} />
            ) : null
          }
        />

        {holds(actor, 'inventory:read') ? (
          <ConsumptionCard
            movements={consumed}
            timeZone={clinic.timezone}
            action={
              holds(actor, 'inventory:consume') && mine && stock.length > 0 ? (
                <RecordConsumptionDialog
                  encounterId={encounter.id}
                  items={stock}
                  label={tStock('action')}
                />
              ) : null
            }
          />
        ) : null}

        <DocumentsCard
          files={files}
          timeZone={clinic.timezone}
          title={t('attachments')}
          upload={
            holds(actor, 'file:upload')
              ? { ownerType: 'ENCOUNTER', ownerId: encounter.id, defaultCategory: 'LAB_RESULT' }
              : undefined
          }
          canShare={holds(actor, 'file:upload')}
          canDelete={holds(actor, 'file:delete')}
        />

        <p className="text-muted-foreground text-sm">
          <Link href={`/doctor/patients/${encounter.patient.id}`} className="hover:underline">
            {t('backToChart')}
          </Link>
        </p>
      </div>
    </>
  )
}
