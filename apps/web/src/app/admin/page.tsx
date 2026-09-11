import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { APP_VERSION } from '@clinic/config'
import { listRoleSummaries } from '@clinic/core/access'
import { getClinicOverview } from '@clinic/core/clinic'
import { checkHealth } from '@clinic/core/health'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.overview')
  return { title: t('title') }
}

export default async function AdminOverviewPage() {
  const actor = await requireActor()
  const [overview, roles, health, t] = await Promise.all([
    getClinicOverview(actor),
    listRoleSummaries(actor),
    checkHealth(APP_VERSION),
    getTranslations('admin.overview'),
  ])
  const activeBranches = overview.branches.filter((branch) => branch.isActive)

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('clinicTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('name')}</dt>
              <dd className="font-medium">{overview.name}</dd>
              <dt className="text-muted-foreground">{t('timezone')}</dt>
              <dd className="font-medium">{overview.timezone}</dd>
              <dt className="text-muted-foreground">{t('currency')}</dt>
              <dd className="font-medium">{overview.currency}</dd>
              <dt className="text-muted-foreground">{t('locale')}</dt>
              <dd className="font-medium uppercase">{overview.locale}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('peopleTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: t('users'), value: overview.counts.users },
                { label: t('roles'), value: overview.counts.roles },
                { label: t('branches'), value: activeBranches.length },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-muted rounded-[var(--radius-control)] px-2 py-3"
                >
                  <dd className="text-2xl font-semibold tabular-nums">{stat.value}</dd>
                  <dt className="text-muted-foreground text-xs">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('healthTitle')}</CardTitle>
              <Badge tone={health.status === 'ok' ? 'success' : 'danger'}>
                {health.status === 'ok' ? t('healthOk') : t('healthDegraded')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {health.dependencies.map((dependency) => (
              <div
                key={dependency.name}
                className="bg-muted flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm"
              >
                <span className="font-mono">{dependency.name}</span>
                <span className="flex items-center gap-3">
                  {dependency.latencyMs !== null ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {dependency.latencyMs} ms
                    </span>
                  ) : null}
                  <Badge tone={dependency.status === 'up' ? 'success' : 'danger'}>
                    {dependency.status === 'up' ? t('up') : t('down')}
                  </Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('rolesTitle')}</CardTitle>
          <CardDescription>{t('rolesSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Table from 768px; stacked rows below it (section 14.4). */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-start text-xs">
                <th scope="col" className="py-2 text-start font-medium">
                  {t('role')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('members')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  {t('permissions')}
                </th>
                <th scope="col" className="py-2 text-end font-medium">
                  <span className="sr-only">{t('system')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {roles.map((role) => (
                <tr key={role.id}>
                  <td className="py-3">
                    <p className="font-medium">{role.name}</p>
                    {role.description ? (
                      <p className="text-muted-foreground text-xs">{role.description}</p>
                    ) : null}
                  </td>
                  <td className="py-3 text-end tabular-nums">{role.memberCount}</td>
                  <td className="py-3 text-end tabular-nums">{role.grantCount}</td>
                  <td className="py-3 text-end">
                    <Badge tone={role.isSystem ? 'info' : 'neutral'}>
                      {role.isSystem ? t('system') : t('custom')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-border flex flex-col divide-y md:hidden">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-col gap-1 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{role.name}</span>
                  <Badge tone={role.isSystem ? 'info' : 'neutral'}>
                    {role.isSystem ? t('system') : t('custom')}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('members')}: {role.memberCount} · {t('permissions')}: {role.grantCount}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}
