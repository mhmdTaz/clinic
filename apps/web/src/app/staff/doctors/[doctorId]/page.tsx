import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { holds } from '@clinic/core/access'
import { getClinicSettings } from '@clinic/core/clinic'
import { getDoctor, listSpecialties } from '@clinic/core/doctors'
import { Alert, Badge, Card, CardContent } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { UserStatusBadge } from '@/components/portal/status-badges'
import { requireActor } from '@/lib/auth/server-session'
import { orNotFound, param, type RouteParams, type SearchParams } from '@/lib/server/page-helpers'
import { DoctorForm } from '../doctor-form'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'doctorId'>
}): Promise<Metadata> {
  const actor = await requireActor()
  const doctor = await getDoctor(actor, (await params).doctorId).catch(() => null)
  return { title: doctor?.displayName ?? (await getTranslations('staff.doctors'))('title') }
}

export default async function DoctorPage({
  params,
  searchParams,
}: {
  params: RouteParams<'doctorId'>
  searchParams: SearchParams
}) {
  const actor = await requireActor()
  const { doctorId } = await params
  const created = param(await searchParams, 'created')

  const doctor = await orNotFound(getDoctor(actor, doctorId))
  const [settings, specialties, t, tStatus] = await Promise.all([
    getClinicSettings(actor),
    listSpecialties(actor),
    getTranslations('staff.doctors'),
    getTranslations('status'),
  ])
  const assigned = new Set(doctor.specialties.map((specialty) => specialty.id))

  return (
    <>
      <PageHeader
        title={[doctor.title, doctor.displayName].filter(Boolean).join(' ')}
        subtitle={doctor.email}
        badges={
          <>
            <UserStatusBadge status={doctor.accountStatus} label={tStatus(doctor.accountStatus)} />
            {doctor.isActive ? null : <Badge tone="neutral">{t('inactiveBadge')}</Badge>}
          </>
        }
        back={{ href: '/staff/doctors', label: t('detail.back') }}
      />

      {created === 'sent' ? (
        <Alert tone="success" className="mb-4">
          {t('detail.createdSent')}
        </Alert>
      ) : null}
      {created === 'unsent' ? (
        <Alert tone="warning" className="mb-4">
          {t('detail.createdNotSent')}
        </Alert>
      ) : null}

      <Card className="max-w-4xl">
        <CardContent className="pt-5">
          <DoctorForm
            doctor={doctor}
            // A retired specialty stays selectable on a doctor who already has it.
            specialties={specialties
              .filter((specialty) => specialty.isActive || assigned.has(specialty.id))
              .map((specialty) => ({ value: specialty.id, label: specialty.name }))}
            branches={settings.branches
              .filter((branch) => branch.isActive || doctor.branchIds.includes(branch.id))
              .map((branch) => ({ value: branch.id, label: branch.name }))}
            currency={settings.currency}
            readOnly={!holds(actor, 'doctor:update')}
          />
        </CardContent>
      </Card>
    </>
  )
}
