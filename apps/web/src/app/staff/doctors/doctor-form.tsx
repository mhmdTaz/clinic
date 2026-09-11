'use client'

import { useTranslations } from 'next-intl'
import {
  CreateDoctorRequest,
  SLOT_MINUTES,
  UpdateDoctorRequest,
  type DoctorDetail,
} from '@clinic/contracts'
import { Alert } from '@clinic/ui'
import { AutoForm, type AutoFormField, type AutoFormOption } from '@/components/forms/auto-form'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * One form for adding and editing a doctor. Adding asks for the email the account is created
 * with; editing shows it read-only, since it is the doctor's sign-in identity (ADR-0006).
 */
export function DoctorForm({
  doctor,
  specialties,
  branches,
  currency,
  readOnly = false,
}: {
  doctor?: DoctorDetail
  specialties: AutoFormOption[]
  /** Active locations; the field appears only when there is more than one (ADR-0021). */
  branches: AutoFormOption[]
  currency: string
  readOnly?: boolean
}) {
  const t = useTranslations('staff.doctors')
  const tCommon = useTranslations('common')
  const router = useRouter()

  const personFields: AutoFormField[] = [
    {
      name: 'title',
      label: t('form.title'),
      kind: 'text',
      maxLength: 20,
      placeholder: t('form.titlePlaceholder'),
    },
    { name: 'firstName', label: t('form.firstName'), kind: 'text', required: true, maxLength: 80 },
    { name: 'lastName', label: t('form.lastName'), kind: 'text', required: true, maxLength: 80 },
    ...(doctor
      ? []
      : [
          {
            name: 'email',
            label: t('form.email'),
            kind: 'email' as const,
            required: true,
            maxLength: 254,
            hint: t('form.emailHint'),
          },
        ]),
    { name: 'phone', label: t('form.phone'), kind: 'tel', maxLength: 32 },
  ]

  const practiceFields: AutoFormField[] = [
    { name: 'licenseNumber', label: t('form.licenseNumber'), kind: 'text', maxLength: 40 },
    { name: 'yearsOfExperience', label: t('form.experience'), kind: 'number', maxLength: 2 },
    {
      name: 'consultationFee',
      label: t('form.fee'),
      kind: 'money',
      maxLength: 13,
      suffix: currency,
      hint: t('form.feeHint', { currency }),
    },
    {
      name: 'defaultSlotMinutes',
      label: t('form.slot'),
      kind: 'select',
      options: SLOT_MINUTES.map((minutes) => ({
        value: String(minutes),
        label: t('form.slotOption', { minutes }),
      })),
    },
    specialties.length > 0
      ? {
          name: 'specialtyIds',
          label: t('form.specialties'),
          kind: 'checkboxes',
          options: specialties,
          hint: t('form.specialtiesHint'),
          span: 2,
        }
      : {
          name: 'specialtyIds',
          label: t('form.specialties'),
          kind: 'custom',
          span: 2,
          render: () => <Alert tone="info">{t('form.noSpecialties')}</Alert>,
        },
    ...(branches.length > 1
      ? [
          {
            name: 'branchIds',
            label: t('form.branches'),
            kind: 'checkboxes' as const,
            options: branches,
            hint: t('form.branchesHint'),
            span: 2 as const,
          },
        ]
      : []),
    { name: 'bio', label: t('form.bio'), kind: 'textarea', maxLength: 1500, span: 2 },
    { name: 'isAcceptingNew', label: t('form.accepting'), kind: 'checkbox', span: 2 },
  ]

  const sections = [
    { id: 'person', title: t('form.person'), fields: personFields },
    { id: 'practice', title: t('form.practice'), fields: practiceFields },
    ...(doctor
      ? [
          {
            id: 'status',
            title: t('form.status'),
            fields: [
              {
                name: 'isActive',
                label: t('form.isActive'),
                kind: 'checkbox' as const,
                hint: t('form.isActiveHint'),
                span: 2 as const,
              },
            ],
          },
        ]
      : []),
  ]

  const initialValues = doctor
    ? {
        ...doctor,
        consultationFee: doctor.consultationFee?.amount ?? '',
        specialtyIds: doctor.specialties.map((specialty) => specialty.id),
      }
    : { defaultSlotMinutes: 30, isAcceptingNew: true, specialtyIds: [], branchIds: [] }

  return (
    <AutoForm
      schema={doctor ? UpdateDoctorRequest : CreateDoctorRequest}
      sections={sections}
      initialValues={initialValues}
      action={doctor ? `/api/v1/doctors/${doctor.id}` : '/api/v1/doctors'}
      method={doctor ? 'PUT' : 'POST'}
      submitLabel={doctor ? tCommon('save') : t('new.submit')}
      successMessage={doctor ? t('detail.saved') : undefined}
      readOnly={readOnly}
      notice={readOnly ? <Alert tone="info">{t('detail.readOnly')}</Alert> : null}
      onSuccess={(data) => {
        if (doctor) {
          router.refresh()
          return
        }
        const created = data as { doctor: DoctorDetail; invitationSent: boolean }
        router.push(
          `/staff/doctors/${created.doctor.id}?created=${created.invitationSent ? 'sent' : 'unsent'}`,
        )
      }}
    />
  )
}
