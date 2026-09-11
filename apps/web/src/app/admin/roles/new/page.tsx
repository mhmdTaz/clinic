import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { holds, listRoleSummaries } from '@clinic/core/access'
import { Card, CardContent } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { CreateRoleForm } from './create-role-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.roles.new')
  return { title: t('title') }
}

export default async function NewRolePage() {
  const actor = await requirePortal('admin')
  if (!holds(actor, 'role:create')) redirect('/admin/roles')

  const [roles, t, tDetail] = await Promise.all([
    listRoleSummaries(actor),
    getTranslations('admin.roles.new'),
    getTranslations('admin.roles.detail'),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back={{ href: '/admin/roles', label: tDetail('back') }}
      />
      <Card className="max-w-2xl">
        <CardContent className="pt-5">
          <CreateRoleForm
            copyOptions={[
              { value: '', label: t('startEmpty') },
              ...roles.map((role) => ({ value: role.id, label: t('copyOf', { name: role.name }) })),
            ]}
          />
        </CardContent>
      </Card>
    </>
  )
}
