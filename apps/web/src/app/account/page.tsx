import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getNotificationPreferences } from '@clinic/core/notifications'
import { getMe, listMySessions } from '@clinic/core/session'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { summariseAccess } from '@/lib/access-summary'
import { requireActor } from '@/lib/auth/server-session'
import { PasswordForm } from './password-form'
import { ProfileForm } from './profile-form'
import { NotificationPreferences } from './notification-preferences'
import { SessionsCard } from './sessions-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account')
  return { title: t('title') }
}

export default async function AccountPage() {
  const actor = await requireActor()
  const [me, sessions, clinic, notificationRows, t] = await Promise.all([
    getMe(actor),
    listMySessions(actor),
    getClinicSessionInfo(actor.clinicId),
    getNotificationPreferences(actor),
    getTranslations(),
  ])
  const access = summariseAccess(actor.permissions)

  return (
    <>
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileForm
          user={{
            firstName: me.firstName,
            lastName: me.lastName,
            email: me.email,
            phone: me.phone,
            preferredPortal: me.preferredPortal,
          }}
          portals={me.portals.map((key) => ({ key, label: t(`portals.${key}`) }))}
          canEdit={holds(actor, 'user:update')}
        />
        <PasswordForm />
      </div>

      <Card id="notifications" className="mt-4 scroll-mt-20">
        <CardHeader>
          <CardTitle>{t('notifications.preferences.title')}</CardTitle>
          <CardDescription>{t('notifications.preferences.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferences rows={notificationRows} />
        </CardContent>
      </Card>

      <SessionsCard sessions={sessions} timeZone={clinic.timezone} />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('account.access.title')}</CardTitle>
          <CardDescription>{t('account.access.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-sm">{t('account.access.roles')}:</span>
            {me.roles.map((role) => (
              <Badge key={role.key} tone="info">
                {role.name}
              </Badge>
            ))}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {access.map(({ group, count }) => (
              <li
                key={group}
                className="bg-muted flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm"
              >
                <span>{t(`permissionGroups.${group}`)}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t('account.access.permissionCount', { count })}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}
