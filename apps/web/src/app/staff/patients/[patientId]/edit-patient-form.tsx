'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { UpdatePatientRequest, type PatientDetail } from '@clinic/contracts'
import { AutoForm } from '@/components/forms/auto-form'
import type { Option } from '@/lib/format/regions'
import { usePatientSections } from '../patient-form-sections'

export function EditPatientForm({
  patient,
  countries,
  today,
  readOnly,
}: {
  patient: PatientDetail
  countries: Option[]
  today: string
  readOnly: boolean
}) {
  const t = useTranslations('staff.patients.detail')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const sections = usePatientSections({ countries, today, withPortalInvite: false })

  return (
    <AutoForm
      schema={UpdatePatientRequest}
      sections={sections}
      initialValues={patient}
      action={`/api/v1/patients/${patient.id}`}
      method="PUT"
      submitLabel={tCommon('save')}
      successMessage={t('saved')}
      readOnly={readOnly}
      onSuccess={() => router.refresh()}
    />
  )
}
