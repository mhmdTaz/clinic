'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { UpdateUserRequest, type UserDetail } from '@clinic/contracts'
import { Alert } from '@clinic/ui'
import { AutoForm } from '@/components/forms/auto-form'

export function UserDetailsForm({ user, readOnly }: { user: UserDetail; readOnly: boolean }) {
  const t = useTranslations('admin.users.detail')
  const tNew = useTranslations('admin.users.new')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  const emailLocked = user.status !== 'INVITED'

  return (
    <AutoForm
      schema={UpdateUserRequest}
      sections={[
        {
          id: 'details',
          fields: [
            {
              name: 'firstName',
              label: tNew('firstName'),
              kind: 'text',
              required: true,
              maxLength: 80,
            },
            {
              name: 'lastName',
              label: tNew('lastName'),
              kind: 'text',
              required: true,
              maxLength: 80,
            },
            {
              name: 'email',
              label: tNew('email'),
              kind: 'email',
              required: true,
              maxLength: 254,
              disabled: emailLocked,
              hint: emailLocked ? t('emailLockedHint') : t('emailHint'),
            },
            { name: 'phone', label: tNew('phone'), kind: 'tel', maxLength: 32 },
          ],
        },
      ]}
      initialValues={user}
      action={`/api/v1/admin/users/${user.id}`}
      method="PUT"
      submitLabel={tCommon('save')}
      readOnly={readOnly}
      notice={
        readOnly ? (
          <Alert tone="info">{t('readOnly')}</Alert>
        ) : notice ? (
          <Alert tone="success">{notice}</Alert>
        ) : null
      }
      onSuccess={(data) => {
        const { invitationSent } = data as { invitationSent: boolean | null }
        setNotice(invitationSent ? t('savedNewLink') : t('saved'))
        router.refresh()
      }}
    />
  )
}
