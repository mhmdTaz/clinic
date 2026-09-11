import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { holds } from '@clinic/core/access'
import { getClinicSettings } from '@clinic/core/clinic'
import { listSpecialties } from '@clinic/core/doctors'
import { Card, CardContent } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'
import { DoctorForm } from '../doctor-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.doctors.new')
  return { title: t('title') }
}

export default async function NewDoctorPage() {
  const actor = await requireActor()
  if (!holds(actor, 'doctor:create')) redirect('/staff/doctors')

  const [settings, specialties, t, tDetail] = await Promise.all([
    getClinicSettings(actor),
    listSpecialties(actor),
    getTranslations('staff.doctors.new'),
    getTranslations('staff.doctors.detail'),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back={{ href: '/staff/doctors', label: tDetail('back') }}
      />
      <Card className="max-w-4xl">
        <CardContent className="pt-5">
          <DoctorForm
            specialties={specialties
              .filter((specialty) => specialty.isActive)
              .map((specialty) => ({ value: specialty.id, label: specialty.name }))}
            branches={settings.branches
              .filter((branch) => branch.isActive)
              .map((branch) => ({ value: branch.id, label: branch.name }))}
            currency={settings.currency}
          />
        </CardContent>
      </Card>
    </>
  )
}
