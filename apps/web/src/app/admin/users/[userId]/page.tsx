import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { holds, listRoleSummaries } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getUser } from '@clinic/core/users'
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { ConfirmAction } from '@/components/portal/confirm-action'
import { PageHeader } from '@/components/portal/page-header'
import { UserStatusBadge } from '@/components/portal/status-badges'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { orNotFound, param, type RouteParams, type SearchParams } from '@/lib/server/page-helpers'
import { UserDetailsForm } from './user-details-form'
import { UserRolesForm } from './user-roles-form'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'userId'>
}): Promise<Metadata> {
  const actor = await requirePortal('admin')
  const user = await getUser(actor, (await params).userId).catch(() => null)
  return { title: user?.displayName ?? (await getTranslations('admin.users'))('title') }
}

export default async function UserPage({
  params,
  searchParams,
}: {
  params: RouteParams<'userId'>
  searchParams: SearchParams
}) {
  const actor = await requirePortal('admin')
  const { userId } = await params
  const created = param(await searchParams, 'created')

  const user = await orNotFound(getUser(actor, userId))
  const [roles, clinic, t, tStatus, tCommon, locale] = await Promise.all([
    holds(actor, 'role:read') ? listRoleSummaries(actor) : Promise.resolve([]),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('admin.users.detail'),
    getTranslations('status'),
    getTranslations('common'),
    getLocale(),
  ])
  const when = (iso: string | null) =>
    iso ? formatInstant(iso, locale, clinic.timezone) : tCommon('never')

  const canSuspend = holds(actor, 'user:suspend') && !user.isSelf
  const canReset = holds(actor, 'user:reset_password') && !user.isSelf && user.status === 'ACTIVE'
  const canResend = holds(actor, 'user:invite') && user.status === 'INVITED'

  return (
    <>
      <PageHeader
        title={user.displayName}
        subtitle={user.email}
        badges={<UserStatusBadge status={user.status} label={tStatus(user.status)} />}
        back={{ href: '/admin/users', label: t('back') }}
      />

      {created === 'sent' ? (
        <Alert tone="success" className="mb-4">
          {t('createdSent')}
        </Alert>
      ) : null}
      {created === 'unsent' ? (
        <Alert tone="warning" className="mb-4">
          {t('createdNotSent')}
        </Alert>
      ) : null}
      {user.isSelf ? (
        <Alert tone="info" className="mb-4">
          {t('self')}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('details')}</CardTitle>
            </CardHeader>
            <CardContent>
              <UserDetailsForm user={user} readOnly={!holds(actor, 'user:update')} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('rolesTitle')}</CardTitle>
              <CardDescription>{t('rolesSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <UserRolesForm
                userId={user.id}
                roleIds={user.roles.map((role) => role.id)}
                options={roles.map((role) => ({ value: role.id, label: role.name }))}
                readOnly={user.isSelf || !holds(actor, 'role:assign')}
                ownAccount={user.isSelf}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t('account')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('status')}</dt>
              <dd>{tStatus(user.status)}</dd>
              <dt className="text-muted-foreground">{t('lastSignIn')}</dt>
              <dd className="tabular-nums">{when(user.lastLoginAt)}</dd>
              <dt className="text-muted-foreground">{t('created')}</dt>
              <dd className="tabular-nums">{when(user.createdAt)}</dd>
              <dt className="text-muted-foreground">{t('password')}</dt>
              <dd>{user.hasPassword ? t('passwordSet') : t('passwordNotSet')}</dd>
              {user.status === 'INVITED' ? (
                <>
                  <dt className="text-muted-foreground">{t('invitation')}</dt>
                  <dd>
                    {user.invitation
                      ? t('invitationPending', {
                          sentAt: when(user.invitation.sentAt),
                          expiresAt: when(user.invitation.expiresAt),
                        })
                      : t('invitationNone')}
                  </dd>
                </>
              ) : null}
            </dl>

            <div className="border-border flex flex-col items-start gap-2 border-t pt-4">
              {canResend ? (
                <ConfirmAction
                  label={t('resend')}
                  title={t('resend')}
                  body={t('invitationNone')}
                  confirmLabel={t('resend')}
                  tone="primary"
                  action={`/api/v1/admin/users/${user.id}/invitation`}
                />
              ) : null}
              {canReset ? (
                <ConfirmAction
                  label={t('resetPassword')}
                  title={t('resetTitle', { name: user.displayName })}
                  body={t('resetBody')}
                  confirmLabel={t('resetConfirm')}
                  action={`/api/v1/admin/users/${user.id}/password-reset`}
                />
              ) : null}
              {canSuspend && user.status !== 'SUSPENDED' ? (
                <ConfirmAction
                  label={t('suspend')}
                  title={t('suspendTitle', { name: user.displayName })}
                  body={t('suspendBody')}
                  confirmLabel={t('suspendConfirm')}
                  action={`/api/v1/admin/users/${user.id}/status`}
                  payload={{ action: 'suspend' }}
                  withReason
                  triggerVariant="danger"
                />
              ) : null}
              {canSuspend && user.status === 'SUSPENDED' ? (
                <ConfirmAction
                  label={t('restore')}
                  title={t('restoreTitle', { name: user.displayName })}
                  body={t('restoreBody')}
                  confirmLabel={t('restoreConfirm')}
                  action={`/api/v1/admin/users/${user.id}/status`}
                  payload={{ action: 'restore' }}
                  withReason
                  tone="primary"
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
