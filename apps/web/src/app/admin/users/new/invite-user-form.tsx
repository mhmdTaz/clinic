'use client'

import { useTranslations } from 'next-intl'
import { InviteUserRequest, type UserDetail } from '@clinic/contracts'
import { AutoForm, type AutoFormOption } from '@/components/forms/auto-form'
import { useRouter } from '@/lib/navigation/use-router'

export function InviteUserForm({ roles }: { roles: AutoFormOption[] }) {
  const t = useTranslations('admin.users.new')
  const router = useRouter()

  return (
    <AutoForm
      schema={InviteUserRequest}
      sections={[
        {
          id: 'person',
          title: t('person'),
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
              name: 'email',
              label: t('email'),
              kind: 'email',
              required: true,
              maxLength: 254,
              autoComplete: 'off',
            },
            { name: 'phone', label: t('phone'), kind: 'tel', maxLength: 32, autoComplete: 'off' },
          ],
        },
        {
          id: 'access',
          title: t('access'),
          fields: [
            {
              name: 'roleIds',
              label: t('roles'),
              kind: 'checkboxes',
              options: roles,
              hint: t('rolesHint'),
              span: 2,
              required: true,
            },
          ],
        },
      ]}
      action="/api/v1/admin/users/invite"
      method="POST"
      submitLabel={t('submit')}
      onSuccess={(data) => {
        const { user, invitationSent } = data as { user: UserDetail; invitationSent: boolean }
        router.push(`/admin/users/${user.id}?created=${invitationSent ? 'sent' : 'unsent'}`)
      }}
    />
  )
}
