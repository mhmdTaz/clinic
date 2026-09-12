import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSettings } from '@clinic/core/clinic'
import { getDoctor, getDoctorSchedule, listSpecialties } from '@clinic/core/doctors'
import { Alert, Badge, Card, CardContent } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { UserStatusBadge } from '@/components/portal/status-badges'
import { AvailabilityCard } from '@/components/scheduling/availability-card'
import { TimeOffCard } from '@/components/scheduling/time-off-card'
import { requirePortal } from '@/lib/auth/server-session'
import { WEEK_ORDER, weekdayName } from '@/lib/format/weekdays'
import { orNotFound, param, type RouteParams, type SearchParams } from '@/lib/server/page-helpers'
import { DoctorForm } from '../doctor-form'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'doctorId'>
}): Promise<Metadata> {
  const actor = await requirePortal('staff')
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
  const actor = await requirePortal('staff')
  const { doctorId } = await params
  const created = param(await searchParams, 'created')

  const doctor = await orNotFound(getDoctor(actor, doctorId))
  const [settings, specialties, schedule, locale, t, tStatus] = await Promise.all([
    getClinicSettings(actor),
    listSpecialties(actor),
    // Availability is a separate grant: the front desk may keep the diary without being able
    // to edit the profile, and a role may have the profile without the diary.
    holds(actor, 'availability:read') ? getDoctorSchedule(actor, doctorId) : null,
    getLocale(),
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

      {schedule ? (
        <div className="mt-4 flex max-w-4xl flex-col gap-4">
          <AvailabilityCard
            doctorId={doctor.id}
            blocks={schedule.blocks}
            slotMinutes={schedule.slotMinutes}
            timezone={settings.timezone}
            weekdays={WEEK_ORDER.map((day) => ({ day, name: weekdayName(day, locale) }))}
            canEdit={holds(actor, 'availability:manage')}
          />
          <TimeOffCard
            doctorId={doctor.id}
            entries={schedule.timeOff}
            today={localDateIn(settings.timezone)}
            locale={locale}
            canEdit={holds(actor, 'availability:manage')}
          />
        </div>
      ) : null}
    </>
  )
}
