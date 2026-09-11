'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SetUserRolesRequest } from '@clinic/contracts'
import { Alert } from '@clinic/ui'
import { AutoForm, type AutoFormOption } from '@/components/forms/auto-form'

export function UserRolesForm({
  userId,
  roleIds,
  options,
  readOnly,
  ownAccount,
}: {
  userId: string
  roleIds: string[]
  options: AutoFormOption[]
  readOnly: boolean
  ownAccount: boolean
}) {
  const t = useTranslations('admin.users.detail')
  const tNew = useTranslations('admin.users.new')
  const router = useRouter()

  return (
    <AutoForm
      schema={SetUserRolesRequest}
      sections={[
        {
          id: 'roles',
          fields: [
            {
              name: 'roleIds',
              label: tNew('roles'),
              kind: 'checkboxes',
              options,
              hint: t('noRoleWarning'),
              span: 2,
            },
          ],
        },
      ]}
      initialValues={{ roleIds }}
      action={`/api/v1/admin/users/${userId}/roles`}
      method="PUT"
      submitLabel={t('saveRoles')}
      successMessage={t('rolesSaved')}
      readOnly={readOnly}
      notice={ownAccount ? <Alert tone="info">{t('ownRoles')}</Alert> : null}
      onSuccess={() => router.refresh()}
    />
  )
}
