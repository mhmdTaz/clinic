'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ClinicProfileInput, type ClinicSettings } from '@clinic/contracts'
import { AutoForm, type AutoFormSection } from '@/components/forms/auto-form'
import type { Option } from '@/lib/format/regions'

export function ClinicProfileForm({
  settings,
  countries,
  timezones,
  currencies,
  locales,
  readOnly,
}: {
  settings: ClinicSettings
  countries: Option[]
  timezones: Option[]
  currencies: Option[]
  locales: Option[]
  readOnly: boolean
}) {
  const t = useTranslations('admin.clinic.profile')
  const tCommon = useTranslations('common')
  const router = useRouter()

  const sections: AutoFormSection[] = [
    {
      id: 'identity',
      title: t('identity'),
      fields: [
        {
          name: 'name',
          label: t('name'),
          kind: 'text',
          required: true,
          maxLength: 120,
          span: 2,
          autoComplete: 'organization',
        },
        { name: 'legalName', label: t('legalName'), kind: 'text', maxLength: 160 },
        { name: 'taxId', label: t('taxId'), kind: 'text', maxLength: 64 },
      ],
    },
    {
      id: 'contact',
      title: t('contact'),
      fields: [
        {
          name: 'contact.email',
          label: t('email'),
          kind: 'email',
          maxLength: 254,
          autoComplete: 'email',
        },
        {
          name: 'contact.phone',
          label: t('phone'),
          kind: 'tel',
          maxLength: 32,
          autoComplete: 'tel',
        },
        {
          name: 'address.line1',
          label: t('line1'),
          kind: 'text',
          maxLength: 160,
          span: 2,
          autoComplete: 'address-line1',
        },
        {
          name: 'address.line2',
          label: t('line2'),
          kind: 'text',
          maxLength: 160,
          span: 2,
          autoComplete: 'address-line2',
        },
        {
          name: 'address.city',
          label: t('city'),
          kind: 'text',
          maxLength: 80,
          autoComplete: 'address-level2',
        },
        {
          name: 'address.country',
          label: t('country'),
          kind: 'select',
          options: [{ value: '', label: tCommon('notSet') }, ...countries],
        },
      ],
    },
    {
      id: 'regional',
      title: t('regional'),
      fields: [
        {
          name: 'timezone',
          label: t('timezone'),
          kind: 'select',
          options: timezones,
          hint: t('timezoneHint'),
          span: 2,
          required: true,
        },
        {
          name: 'currency',
          label: t('currency'),
          kind: 'select',
          options: currencies,
          hint: t('currencyHint'),
          required: true,
        },
        { name: 'locale', label: t('locale'), kind: 'select', options: locales, required: true },
      ],
    },
  ]

  return (
    <AutoForm
      schema={ClinicProfileInput}
      sections={sections}
      initialValues={settings}
      action="/api/v1/admin/clinic/profile"
      method="PUT"
      submitLabel={tCommon('save')}
      successMessage={t('saved')}
      onSuccess={() => router.refresh()}
      readOnly={readOnly}
    />
  )
}
