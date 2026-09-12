import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listEncounters } from '@clinic/core/clinical'
import { listFiles } from '@clinic/core/files'
import { getPatient } from '@clinic/core/patients'
import { listPrescriptions } from '@clinic/core/prescriptions'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { ChartBanner } from '@/components/clinical/chart-banner'
import { DocumentsCard } from '@/components/clinical/documents-card'
import { EncounterList } from '@/components/clinical/encounter-list'
import { PrescriptionsCard } from '@/components/clinical/prescriptions-card'
import { StartEncounterButton } from '@/components/clinical/start-encounter-button'
import { requirePortal } from '@/lib/auth/server-session'
import { ageOn, formatCalendarDate } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('doctor.chart')
  return { title: t('title') }
}

/**
 * The patient chart (D4): the banner first, then who they are, then everything that has happened.
 *
 * A doctor reaches this chart because they have treated this patient. What they can read *inside*
 * it stays strict per row — a colleague's note is still out of reach — which is the line ADR-0004
 * draws and the reason chart-wide scope was rejected.
 */
export default async function PatientChartPage({ params }: { params: RouteParams<'patientId'> }) {
  const actor = await requirePortal('doctor')
  const { patientId } = await params

  const patient = await orNotFound(getPatient(actor, patientId))
  const [clinic, encounters, prescriptions, files, locale, t, tCommon] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    listEncounters(actor, { patientId }),
    holds(actor, 'prescription:read') ? listPrescriptions(actor, { patientId }) : [],
    holds(actor, 'file:read') ? listFiles(actor, { patientId }) : [],
    getLocale(),
    getTranslations('doctor.chart'),
    getTranslations('common'),
  ])

  const today = localDateIn(clinic.timezone)
  const name = `${patient.firstName} ${patient.lastName}`
  const facts = [
    {
      term: t('dateOfBirth'),
      value: patient.dateOfBirth
        ? `${formatCalendarDate(patient.dateOfBirth, locale)} · ${t('years', {
            count: ageOn(patient.dateOfBirth, today),
          })}`
        : tCommon('notSet'),
    },
    { term: t('bloodType'), value: patient.bloodType },
    { term: t('phone'), value: patient.contact.phone ?? tCommon('notSet') },
  ]

  return (
    <>
      <PageHeader
        title={name}
        subtitle={patient.medicalRecordNo}
        back={{ href: '/doctor/patients', label: t('back') }}
        actions={
          holds(actor, 'encounter:write') ? (
            <StartEncounterButton patientId={patient.id} label={t('startVisit')} />
          ) : null
        }
      />

      <ChartBanner
        patientId={patient.id}
        banner={{ allergies: patient.allergies, chronicConditions: patient.chronicConditions }}
        canEdit={holds(actor, 'patient:update')}
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('about')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {facts.map((fact) => (
                <div key={fact.term} className="contents">
                  <dt className="text-muted-foreground">{fact.term}</dt>
                  <dd className="min-w-0 break-words">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('visits')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EncounterList
              encounters={encounters}
              timeZone={clinic.timezone}
              hrefFor={(encounter) => `/doctor/encounters/${encounter.id}`}
              show={{ doctor: true }}
              emptyTitle={t('noVisits')}
              emptyBody={t('noVisitsBody')}
            />
          </CardContent>
        </Card>

        <PrescriptionsCard prescriptions={prescriptions} timeZone={clinic.timezone} />

        <DocumentsCard
          files={files}
          timeZone={clinic.timezone}
          upload={
            holds(actor, 'file:upload') ? { ownerType: 'PATIENT', ownerId: patient.id } : undefined
          }
          canShare={holds(actor, 'file:upload')}
          canDelete={holds(actor, 'file:delete')}
        />
      </div>
    </>
  )
}
