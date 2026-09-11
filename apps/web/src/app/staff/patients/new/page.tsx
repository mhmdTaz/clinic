import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Card, CardContent } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'
import { countryOptions } from '@/lib/format/regions'
import { RegisterPatientForm } from './register-patient-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.patients.new')
  return { title: t('title') }
}

export default async function RegisterPatientPage() {
  const actor = await requireActor()
  if (!holds(actor, 'patient:create')) redirect('/staff/patients')

  const [clinic, t, tDetail, locale] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getTranslations('staff.patients.new'),
    getTranslations('staff.patients.detail'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back={{ href: '/staff/patients', label: tDetail('back') }}
      />
      <Card className="max-w-4xl">
        <CardContent className="pt-5">
          <RegisterPatientForm
            countries={countryOptions(locale)}
            today={localDateIn(clinic.timezone)}
            locale={locale}
          />
        </CardContent>
      </Card>
    </>
  )
}
