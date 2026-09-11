'use client'

import { useTranslations } from 'next-intl'
import { UpdateRoleRequest, type RoleDetail } from '@clinic/contracts'
import { AutoForm } from '@/components/forms/auto-form'
import { useRouter } from '@/lib/navigation/use-router'

export function RoleDetailsForm({ role, readOnly }: { role: RoleDetail; readOnly: boolean }) {
  const t = useTranslations('admin.roles.new')
  const tDetail = useTranslations('admin.roles.detail')
  const tCommon = useTranslations('common')
  const router = useRouter()

  return (
    <AutoForm
      schema={UpdateRoleRequest}
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
          ],
        },
      ]}
      initialValues={role}
      action={`/api/v1/admin/roles/${role.id}`}
      method="PUT"
      submitLabel={tCommon('save')}
      successMessage={tDetail('saved')}
      readOnly={readOnly}
      onSuccess={() => router.refresh()}
    />
  )
}
