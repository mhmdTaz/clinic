import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { UserStatus, type UserListQuery } from '@clinic/contracts'
import { holds, listRoleSummaries } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listUsers } from '@clinic/core/users'
import { Badge, buttonVariants } from '@clinic/ui'
import { DataTable, type DataTableRow } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { UserStatusBadge } from '@/components/portal/status-badges'
import { requireActor } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { isInvalidCursor, param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.users')
  return { title: t('title') }
}

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor()
  const values = await searchParams
  const status = UserStatus.safeParse(param(values, 'status'))
  const query: UserListQuery = {
    q: param(values, 'q')?.slice(0, 80),
    status: status.success ? status.data : undefined,
    roleId: param(values, 'roleId'),
    cursor: param(values, 'cursor'),
    limit: 25,
  }

  const page = await listUsers(actor, query).catch((error: unknown) => {
    if (query.cursor && isInvalidCursor(error)) redirect('/admin/users')
    throw error
  })
  const [roles, clinic, t, tStatus, tCommon, locale] = await Promise.all([
    listRoleSummaries(actor),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('admin.users'),
    getTranslations('status'),
    getTranslations('common'),
    getLocale(),
  ])

  const rows: DataTableRow[] = page.items.map((user) => ({
    id: user.id,
    href: `/admin/users/${user.id}`,
    cells: {
      name: (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium break-words">{user.displayName}</span>
          <span className="text-muted-foreground text-xs font-normal break-all">{user.email}</span>
        </span>
      ),
      roles:
        user.roles.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {user.roles.map((role) => (
              <Badge key={role.id} tone="neutral">
                {role.name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('noRoles')}</span>
        ),
      status: <UserStatusBadge status={user.status} label={tStatus(user.status)} />,
      lastSignIn: user.lastLoginAt ? (
        <span className="tabular-nums">
          {formatInstant(user.lastLoginAt, locale, clinic.timezone)}
        </span>
      ) : (
        <span className="text-muted-foreground">{tCommon('never')}</span>
      ),
    },
  }))

  const inviteLink = holds(actor, 'user:invite') ? (
    <Link href="/admin/users/new" className={buttonVariants()}>
      {t('invite')}
    </Link>
  ) : null

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={inviteLink} />
      <DataTable
        label={t('title')}
        columns={[
          { id: 'name', header: t('columns.name'), priority: 1 },
          { id: 'roles', header: t('columns.roles'), priority: 2 },
          { id: 'status', header: t('columns.status'), priority: 2 },
          { id: 'lastSignIn', header: t('columns.lastSignIn'), priority: 3 },
        ]}
        rows={rows}
        search={{ placeholder: t('searchPlaceholder'), value: query.q ?? '' }}
        filters={[
          {
            param: 'status',
            label: t('statusFilter'),
            value: query.status ?? '',
            options: [
              { value: '', label: t('allStatuses') },
              ...UserStatus.options.map((value) => ({ value, label: tStatus(value) })),
            ],
          },
          {
            param: 'roleId',
            label: t('roleFilter'),
            value: query.roleId ?? '',
            options: [
              { value: '', label: t('allRoles') },
              ...roles.map((role) => ({ value: role.id, label: role.name })),
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        empty={{ title: t('emptyTitle'), body: t('emptyBody'), action: inviteLink }}
      />
    </>
  )
}
