import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listDoctors } from '@clinic/core/doctors'
import { getPatient } from '@clinic/core/patients'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { ConfirmAction } from '@/components/portal/confirm-action'
import { PageHeader } from '@/components/portal/page-header'
import { BookAppointmentDialog } from '@/components/scheduling/book-appointment-dialog'
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
  const [clinic, doctors, t, tScheduling, locale] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    canBook ? listDoctors(actor, { status: 'active' }) : [],
    getTranslations('staff.patients.detail'),
    getTranslations('scheduling'),
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
    </>
  )
}
