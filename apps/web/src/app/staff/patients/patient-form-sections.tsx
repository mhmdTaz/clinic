'use client'

import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { BloodType, Gender } from '@clinic/contracts'
import { Button, Input } from '@clinic/ui'
import type { AutoFormSection, CustomControl } from '@/components/forms/auto-form'
import { Field } from '@/components/forms/field'
import type { Option } from '@/lib/format/regions'

interface ContactValue {
  name: string
  relationship: string | null
  phone: string
}

const MAX_CONTACTS = 5

/** The patient record's fields, shared by registration and editing so the two never diverge. */
export function usePatientSections({
  countries,
  today,
  withPortalInvite,
}: {
  countries: Option[]
  today: string
  withPortalInvite: boolean
}): AutoFormSection[] {
  const t = useTranslations('staff.patients.form')
  const tGenders = useTranslations('genders')
  const tBlood = useTranslations('bloodTypes')

  return [
    {
      id: 'identity',
      title: t('identity'),
      fields: [
        {
          name: 'firstName',
          label: t('firstName'),
          kind: 'text',
          required: true,
          maxLength: 80,
          autoComplete: 'off',
        },
        {
          name: 'lastName',
          label: t('lastName'),
          kind: 'text',
          required: true,
          maxLength: 80,
          autoComplete: 'off',
        },
        {
          name: 'dateOfBirth',
          label: t('dateOfBirth'),
          kind: 'date',
          min: '1900-01-01',
          max: today,
        },
        {
          name: 'gender',
          label: t('gender'),
          kind: 'select',
          options: [
            { value: '', label: t('notRecorded') },
            ...Gender.options.map((value) => ({ value, label: tGenders(value) })),
          ],
        },
        {
          name: 'nationalId',
          label: t('nationalId'),
          kind: 'text',
          maxLength: 40,
          autoComplete: 'off',
        },
        {
          name: 'bloodType',
          label: t('bloodType'),
          kind: 'select',
          options: BloodType.options.map((value) => ({
            value,
            label: value === 'UNKNOWN' ? tBlood('UNKNOWN') : value,
          })),
        },
      ],
    },
    {
      id: 'contact',
      title: t('contact'),
      fields: [
        {
          name: 'contact.phone',
          label: t('phone'),
          kind: 'tel',
          maxLength: 32,
          autoComplete: 'off',
        },
        {
          name: 'contact.email',
          label: t('email'),
          kind: 'email',
          maxLength: 254,
          autoComplete: 'off',
        },
        {
          name: 'address.line1',
          label: t('line1'),
          kind: 'text',
          maxLength: 160,
          span: 2,
          autoComplete: 'off',
        },
        {
          name: 'address.city',
          label: t('city'),
          kind: 'text',
          maxLength: 80,
          autoComplete: 'off',
        },
        {
          name: 'address.country',
          label: t('country'),
          kind: 'select',
          options: [{ value: '', label: t('notRecorded') }, ...countries],
        },
      ],
    },
    {
      id: 'emergency',
      title: t('emergency'),
      description: t('emergencyHint'),
      fields: [
        {
          name: 'emergencyContacts',
          label: t('emergency'),
          kind: 'custom',
          span: 2,
          render: (control) => <EmergencyContacts control={control} />,
        },
      ],
    },
    {
      id: 'notes',
      title: t('notes'),
      fields: [
        {
          name: 'adminNotes',
          label: t('adminNotes'),
          kind: 'textarea',
          maxLength: 2000,
          hint: t('adminNotesHint'),
          span: 2,
        },
      ],
    },
    ...(withPortalInvite
      ? [
          {
            id: 'portal',
            title: t('portal'),
            fields: [
              {
                name: 'inviteToPortal',
                label: t('inviteToPortal'),
                kind: 'checkbox' as const,
                hint: t('inviteHint'),
                span: 2 as const,
              },
            ],
          },
        ]
      : []),
  ]
}

function EmergencyContacts({ control }: { control: CustomControl }) {
  const t = useTranslations('staff.patients.form')
  const contacts = Array.isArray(control.value) ? (control.value as ContactValue[]) : []
  const set = (next: ContactValue[]) => control.onChange(next)

  return (
    <div id={control.id} tabIndex={-1} className="flex flex-col gap-3 outline-none">
      {contacts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noEmergency')}</p>
      ) : (
        contacts.map((contact, index) => {
          const id = `${control.id}-${index}`
          const errorsOf = (key: string) => control.errors[`${index}.${key}`] ?? []
          const edit = (patch: Partial<ContactValue>) =>
            set(
              contacts.map((item, position) => (position === index ? { ...item, ...patch } : item)),
            )
          return (
            <div
              key={index}
              className="border-border grid gap-3 rounded-[var(--radius-control)] border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start"
            >
              <Field id={`${id}-name`} label={t('contactName')} errors={errorsOf('name')}>
                <Input
                  id={`${id}-name`}
                  value={contact.name}
                  maxLength={120}
                  disabled={control.disabled}
                  aria-invalid={errorsOf('name').length > 0 || undefined}
                  onChange={(event) => edit({ name: event.target.value })}
                />
              </Field>
              <Field
                id={`${id}-relationship`}
                label={t('relationship')}
                errors={errorsOf('relationship')}
              >
                <Input
                  id={`${id}-relationship`}
                  value={contact.relationship ?? ''}
                  maxLength={40}
                  disabled={control.disabled}
                  onChange={(event) => edit({ relationship: event.target.value })}
                />
              </Field>
              <Field id={`${id}-phone`} label={t('contactPhone')} errors={errorsOf('phone')}>
                <Input
                  id={`${id}-phone`}
                  type="tel"
                  value={contact.phone}
                  maxLength={32}
                  disabled={control.disabled}
                  aria-invalid={errorsOf('phone').length > 0 || undefined}
                  onChange={(event) => edit({ phone: event.target.value })}
                />
              </Field>
              {control.disabled ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-end"
                  aria-label={t('removeContact', { number: index + 1 })}
                  onClick={() => set(contacts.filter((_, position) => position !== index))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          )
        })
      )}
      {!control.disabled && contacts.length < MAX_CONTACTS ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => set([...contacts, { name: '', relationship: '', phone: '' }])}
        >
          {t('addContact')}
        </Button>
      ) : null}
    </div>
  )
}
