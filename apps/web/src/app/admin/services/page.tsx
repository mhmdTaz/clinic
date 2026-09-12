import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { listServices } from '@clinic/core/billing'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { ServiceDialog } from './service-dialog'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.services')
  return { title: t('title') }
}

/**
 * The clinic's price list (A6).
 *
 * A service is retired rather than deleted: invoices already written point at it, and their
 * lines are snapshots of what it cost on the day, so raising a price here never restates a bill
 * already issued (section 8.2).
 */
export default async function ServicesPage() {
  const actor = await requirePortal('admin')
  const [services, t, locale] = await Promise.all([
    listServices(actor, { status: 'all' }),
    getTranslations('admin.services'),
    getLocale(),
  ])
  const currency = services[0]?.currency ?? 'USD'

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<ServiceDialog label={t('actions.add')} currency={currency} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('list')}</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <EmptyState title={t('none')} body={t('noneBody')} />
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {services.map((service) => (
                <li
                  key={service.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {service.name}
                      {service.isActive ? null : <Badge tone="neutral">{t('retired')}</Badge>}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {[
                        service.description,
                        service.durationMinutes
                          ? t('minutes', { minutes: service.durationMinutes })
                          : null,
                        service.taxRatePercent === '0'
                          ? null
                          : t('taxAt', { rate: service.taxRatePercent }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Money
                      amount={service.price}
                      currency={service.currency}
                      locale={locale}
                      tone="strong"
                    />
                    <ServiceDialog
                      service={service}
                      currency={service.currency}
                      label={t('actions.edit')}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}
