import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  PERMISSION_GROUPS,
  getPermissionCatalogue,
  getRole,
  holds,
  permissionLabelKey,
  type PermissionKey,
} from '@clinic/core/access'
import { listUsers } from '@clinic/core/users'
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { ConfirmAction } from '@/components/portal/confirm-action'
import { PageHeader } from '@/components/portal/page-header'
import { UserStatusBadge } from '@/components/portal/status-badges'
import { requirePortal } from '@/lib/auth/server-session'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'
import { PermissionMatrix, type MatrixGroup } from './permission-matrix'
import { RoleDetailsForm } from './role-details-form'

const MEMBER_PREVIEW = 10

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'roleId'>
}): Promise<Metadata> {
  const actor = await requirePortal('admin')
  const role = await getRole(actor, (await params).roleId).catch(() => null)
  return { title: role?.name ?? (await getTranslations('admin.roles'))('title') }
}

export default async function RolePage({ params }: { params: RouteParams<'roleId'> }) {
  const actor = await requirePortal('admin')
  const { roleId } = await params
  const role = await orNotFound(getRole(actor, roleId))

  const [catalogue, members, t, tRoles, tStatus, tAll] = await Promise.all([
    getPermissionCatalogue(actor),
    holds(actor, 'user:read') ? listUsers(actor, { roleId, limit: MEMBER_PREVIEW }) : null,
    getTranslations('admin.roles.detail'),
    getTranslations('admin.roles'),
    getTranslations('status'),
    getTranslations(),
  ])

  // What the editor may hand out: nothing beyond their own reach, portals excepted (grant-rules).
  const groups: MatrixGroup[] = PERMISSION_GROUPS.map((group) => ({
    id: group,
    label: tAll(`permissionGroups.${group}`),
    permissions: catalogue
      .filter((entry) => entry.group === group)
      .map((entry) => {
        const held = actor.permissions.get(entry.key as PermissionKey)
        return {
          ...entry,
          label: tAll(permissionLabelKey(entry.key as PermissionKey)),
          maxScope: entry.key.startsWith('portal.')
            ? ('CLINIC' as const)
            : held === 'GLOBAL'
              ? ('CLINIC' as const)
              : (held ?? null),
        }
      }),
  })).filter((group) => group.permissions.length > 0)

  const canEditGrants = holds(actor, 'role:update')
  const canDelete = holds(actor, 'role:delete') && !role.isSystem

  return (
    <>
      <PageHeader
        title={role.name}
        subtitle={role.description ?? undefined}
        badges={
          <>
            <Badge tone={role.isSystem ? 'info' : 'neutral'}>
              {role.isSystem ? tRoles('system') : tRoles('custom')}
            </Badge>
            <Badge tone="neutral">{tRoles('members', { count: role.memberCount })}</Badge>
          </>
        }
        back={{ href: '/admin/roles', label: t('back') }}
        actions={
          canDelete ? (
            <ConfirmAction
              label={t('delete')}
              title={t('deleteTitle', { name: role.name })}
              body={role.memberCount > 0 ? t('deleteInUse') : t('deleteBody')}
              confirmLabel={t('deleteConfirm')}
              action={`/api/v1/admin/roles/${role.id}`}
              method="DELETE"
              redirectTo="/admin/roles"
              disabled={role.memberCount > 0}
            />
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('matrixTitle')}</CardTitle>
              <CardDescription>{t('matrixSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionMatrix
                roleId={role.id}
                groups={groups}
                granted={role.permissions}
                readOnly={!canEditGrants}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('details')}</CardTitle>
            </CardHeader>
            <CardContent>
              {role.isSystem ? (
                <Alert tone="info">{t('systemNote')}</Alert>
              ) : (
                <RoleDetailsForm role={role} readOnly={!canEditGrants} />
              )}
            </CardContent>
          </Card>

          {members ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('membersTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                {members.items.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('membersEmpty')}</p>
                ) : (
                  <ul className="divide-border flex flex-col divide-y">
                    {members.items.map((member) => (
                      <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                        <Link
                          href={`/admin/users/${member.id}`}
                          className="min-w-0 truncate text-sm font-medium hover:underline"
                        >
                          {member.displayName}
                        </Link>
                        <UserStatusBadge status={member.status} label={tStatus(member.status)} />
                      </li>
                    ))}
                  </ul>
                )}
                {members.nextCursor ? (
                  <p className="text-muted-foreground mt-3 text-xs">
                    {t('membersMore', { count: MEMBER_PREVIEW })}{' '}
                    <Link
                      href={`/admin/users?roleId=${role.id}`}
                      className="text-primary hover:underline"
                    >
                      {tAll('nav.items.users')}
                    </Link>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
