'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CreateRoleRequest, type RoleDetail } from '@clinic/contracts'
import { AutoForm, type AutoFormOption } from '@/components/forms/auto-form'

export function CreateRoleForm({ copyOptions }: { copyOptions: AutoFormOption[] }) {
  const t = useTranslations('admin.roles.new')
  const router = useRouter()

  return (
    <AutoForm
      schema={CreateRoleRequest}
      sections={[
        {
          id: 'role',
          fields: [
            {
              name: 'name',
              label: t('name'),
              kind: 'text',
              required: true,
              maxLength: 60,
              span: 2,
            },
            {
              name: 'description',
              label: t('description'),
              kind: 'textarea',
              maxLength: 200,
              span: 2,
            },
            {
              name: 'copyFromRoleId',
              label: t('copyFrom'),
              kind: 'select',
              options: copyOptions,
              span: 2,
            },
          ],
        },
      ]}
      initialValues={{ copyFromRoleId: '' }}
      action="/api/v1/admin/roles"
      method="POST"
      submitLabel={t('submit')}
      onSuccess={(data) => router.push(`/admin/roles/${(data as RoleDetail).id}`)}
    />
  )
}
