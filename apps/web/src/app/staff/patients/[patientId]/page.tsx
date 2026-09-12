import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listInvoices } from '@clinic/core/billing'
import { listEncounters } from '@clinic/core/clinical'
import { listDoctors } from '@clinic/core/doctors'
import { listFiles } from '@clinic/core/files'
import { getPatient } from '@clinic/core/patients'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { ConfirmAction } from '@/components/portal/confirm-action'
import { PageHeader } from '@/components/portal/page-header'
import { BookAppointmentDialog } from '@/components/scheduling/book-appointment-dialog'
import { CreateInvoiceButton } from '@/components/billing/create-invoice-button'
import { PatientInvoicesCard } from '@/components/billing/patient-invoices-card'
import { ChartBanner } from '@/components/clinical/chart-banner'
import { DocumentsCard } from '@/components/clinical/documents-card'
import { EncounterList } from '@/components/clinical/encounter-list'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { countryOptions } from '@/lib/format/regions'
import { orNotFound, param, type RouteParams, type SearchParams } from '@/lib/server/page-helpers'
import { EditPatientForm } from './edit-patient-form'
import { PortalInviteButton } from './portal-invite-button'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'patientId'>
}): Promise<Metadata> {
  const actor = await requirePortal('staff')
  const patient = await getPatient(actor, (await params).patientId).catch(() => null)
  const t = await getTranslations('staff.patients')
  return { title: patient ? `${patient.firstName} ${patient.lastName}` : t('title') }
}

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: RouteParams<'patientId'>
  searchParams: SearchParams
}) {
  const actor = await requirePortal('staff')
  const { patientId } = await params
  const registered = param(await searchParams, 'registered')

  const patient = await orNotFound(getPatient(actor, patientId))
  const canBook =
    patient.isActive && holds(actor, 'appointment:create') && holds(actor, 'doctor:read')
  const [
    clinic,
    doctors,
    encounters,
    files,
    invoices,
    t,
    tScheduling,
    tClinical,
    tBilling,
    locale,
  ] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    canBook ? listDoctors(actor, { status: 'active' }) : [],
    // The front desk sees that visits happened and what they were coded as; the note's text is
    // never read for this page, whoever is looking (ADR-0025).
    holds(actor, 'encounter:read') ? listEncounters(actor, { patientId }) : [],
    holds(actor, 'file:read') ? listFiles(actor, { patientId }) : [],
    holds(actor, 'invoice:read') ? listInvoices(actor, { patientId }) : [],
    getTranslations('staff.patients.detail'),
    getTranslations('scheduling'),
    getTranslations('clinical.encounters'),
    getTranslations('billing.invoice'),
    getLocale(),
  ])
  const name = `${patient.firstName} ${patient.lastName}`
  const canUpdate = holds(actor, 'patient:update')
  const account = patient.portalAccount

  return (
    <>
      <PageHeader
        title={name}
        subtitle={patient.medicalRecordNo}
        badges={
          patient.isActive ? null : (
            <Badge tone="neutral">{(await getTranslations('staff.patients'))('archived')}</Badge>
          )
        }
        back={{ href: '/staff/patients', label: t('back') }}
        actions={
          doctors.length > 0 ? (
            <BookAppointmentDialog
              doctors={doctors.map((doctor) => ({
                id: doctor.id,
                name: [doctor.title, doctor.displayName].filter(Boolean).join(' '),
              }))}
              patient={{
                id: patient.id,
                name,
                medicalRecordNo: patient.medicalRecordNo,
              }}
              date={localDateIn(clinic.timezone)}
              locale={locale}
              timeZone={clinic.timezone}
              label={tScheduling('actions.book')}
            />
          ) : null
        }
      />

      {registered ? (
        <Alert tone={registered === 'unsent' ? 'warning' : 'success'} className="mb-4">
          {t('registered')}{' '}
          {registered === 'sent'
            ? t('invitationSent')
            : registered === 'unsent'
              ? t('invitationNotSent')
              : null}
        </Alert>
      ) : null}
      {patient.isActive ? null : (
        <Alert tone="info" className="mb-4">
          {t('archivedNote')}
        </Alert>
      )}

      <ChartBanner
        patientId={patient.id}
        banner={{ allergies: patient.allergies, chronicConditions: patient.chronicConditions }}
        canEdit={canUpdate && patient.isActive}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('record')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EditPatientForm
              patient={patient}
              countries={countryOptions(locale)}
              today={localDateIn(clinic.timezone)}
              readOnly={!canUpdate || !patient.isActive}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('portalTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="text-sm">
                {!account
                  ? t('portalNone')
                  : account.status === 'INVITED'
                    ? t('portalPending')
                    : account.status === 'ACTIVE'
                      ? t('portalActive')
                      : t('portalSuspended')}
              </p>
              {canUpdate && patient.isActive && (!account || account.status === 'INVITED') ? (
                patient.contact.email ? (
                  <PortalInviteButton
                    patientId={patient.id}
                    label={account ? t('resend') : t('invite')}
                  />
                ) : (
                  <p className="text-muted-foreground text-xs">{t('emailRequired')}</p>
                )
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col items-start gap-3 pt-5">
              {patient.createdAt ? (
                <p className="text-muted-foreground text-xs">
                  {patient.createdBy
                    ? t('meta', {
                        date: formatInstant(patient.createdAt, locale, clinic.timezone),
                        name: patient.createdBy.name,
                      })
                    : t('metaNoName', {
                        date: formatInstant(patient.createdAt, locale, clinic.timezone),
                      })}
                </p>
              ) : null}
              {holds(actor, 'patient:delete') ? (
                patient.isActive ? (
                  <ConfirmAction
                    label={t('archive')}
                    title={t('archiveTitle', { name })}
                    body={t('archiveBody')}
                    confirmLabel={t('archiveConfirm')}
                    action={`/api/v1/patients/${patient.id}/archive`}
                  />
                ) : (
                  <ConfirmAction
                    label={t('restore')}
                    title={t('restore')}
                    body={t('archivedNote')}
                    confirmLabel={t('restore')}
                    tone="primary"
                    action={`/api/v1/patients/${patient.id}/restore`}
                  />
                )
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {holds(actor, 'encounter:read') ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('visits')}</CardTitle>
            </CardHeader>
            <CardContent>
              <EncounterList
                encounters={encounters}
                timeZone={clinic.timezone}
                show={{ doctor: true }}
                emptyTitle={tClinical('noneForPatient')}
              />
            </CardContent>
          </Card>
        ) : null}

        {holds(actor, 'invoice:read') ? (
          <PatientInvoicesCard
            invoices={invoices}
            action={
              holds(actor, 'invoice:create') && patient.isActive ? (
                <CreateInvoiceButton
                  patientId={patient.id}
                  visits={encounters.map((encounter) => ({
                    id: encounter.id,
                    label: `${encounter.number} · ${formatInstant(
                      encounter.startedAt,
                      locale,
                      clinic.timezone,
                    )}`,
                  }))}
                  label={tBilling('create.action')}
                />
              ) : null
            }
          />
        ) : null}

        {holds(actor, 'file:read') ? (
          <DocumentsCard
            files={files}
            timeZone={clinic.timezone}
            upload={
              holds(actor, 'file:upload') && patient.isActive
                ? { ownerType: 'PATIENT', ownerId: patient.id }
                : undefined
            }
            canShare={holds(actor, 'file:upload')}
            canDelete={holds(actor, 'file:delete')}
          />
        ) : null}
      </div>
    </>
  )
}
