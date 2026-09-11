import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { holds, listRoleSummaries } from '@clinic/core/access'
import { Card, CardContent } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { InviteUserForm } from './invite-user-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.users.new')
  return { title: t('title') }
}

export default async function InviteUserPage() {
  const actor = await requirePortal('admin')
  if (!holds(actor, 'user:invite') || !holds(actor, 'role:assign')) redirect('/admin/users')

  const [roles, t, tUsers] = await Promise.all([
    listRoleSummaries(actor),
    getTranslations('admin.users.new'),
    getTranslations('admin.users'),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        back={{ href: '/admin/users', label: tUsers('detail.back') }}
      />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <InviteUserForm
            roles={roles.map((role) => ({
              value: role.id,
              label: role.description ? `${role.name} — ${role.description}` : role.name,
            }))}
          />
        </CardContent>
      </Card>
    </>
  )
}
