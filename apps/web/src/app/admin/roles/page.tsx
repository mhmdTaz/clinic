import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { holds, listRoleSummaries } from '@clinic/core/access'
import { Badge, buttonVariants } from '@clinic/ui'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.roles')
  return { title: t('title') }
}

export default async function RolesPage() {
  const actor = await requireActor()
  const [roles, t] = await Promise.all([listRoleSummaries(actor), getTranslations('admin.roles')])

  const newRole = holds(actor, 'role:create') ? (
    <Link href="/admin/roles/new" className={buttonVariants()}>
      {t('newRole')}
    </Link>
  ) : null

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={newRole} />
      <DataTable
        label={t('title')}
        columns={[
          { id: 'role', header: t('columns.role'), priority: 1 },
          { id: 'members', header: t('columns.members'), priority: 2 },
          { id: 'permissions', header: t('columns.permissions'), priority: 3 },
          { id: 'type', header: t('columns.type'), priority: 2 },
        ]}
        rows={roles.map((role) => ({
          id: role.id,
          href: `/admin/roles/${role.id}`,
          cells: {
            role: (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{role.name}</span>
                {role.description ? (
                  <span className="text-muted-foreground text-xs font-normal">
                    {role.description}
                  </span>
                ) : null}
              </span>
            ),
            members: (
              <span className="tabular-nums">{t('members', { count: role.memberCount })}</span>
            ),
            permissions: (
              <span className="tabular-nums">
                {t('permissionCount', { count: role.grantCount })}
              </span>
            ),
            type: (
              <Badge tone={role.isSystem ? 'info' : 'neutral'}>
                {role.isSystem ? t('system') : t('custom')}
              </Badge>
            ),
          },
        }))}
        empty={{ title: t('title'), action: newRole }}
      />
    </>
  )
}
