import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import { holds } from '@clinic/core/access'
import { listServices } from '@clinic/core/billing'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listQuickPicks, listTreatments } from '@clinic/core/dental'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { SymbolIcon } from '@/components/dental/symbol-icon'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { QuickPickDialog } from './quick-pick-dialog'
import { TreatmentDialog } from './treatment-dialog'
import { VoiceChartingSetting } from './voice-charting-setting'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.dental')
  return { title: t('title') }
}

/**
 * What the tooth chart offers (Phase 11): the clinic's treatments and the one-tap presets built
 * from them. A treatment is retired rather than deleted, and what it draws is fixed once it
 * exists — every row already charted carries a snapshot of it, and the picture must not change
 * under them.
 */
export default async function DentalSettingsPage() {
  const actor = await requirePortal('admin')
  const [clinic, treatments, quickPicks, services, t, tDental] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    listTreatments(actor),
    listQuickPicks(actor),
    holds(actor, 'service:read') ? listServices(actor, { status: 'active' }) : [],
    getTranslations('admin.dental'),
    getTranslations('dental'),
  ])
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)
  const enabled = flags.dental
  const serviceName = new Map(services.map((service) => [service.id, service.name]))
  const treatmentName = new Map(treatments.map((treatment) => [treatment.id, treatment.name]))
  const serviceOptions = services.map((service) => ({ id: service.id, name: service.name }))
  const treatmentOptions = treatments.map((treatment) => ({
    id: treatment.id,
    name: treatment.name,
    symbol: treatment.symbol,
    scope: treatment.scope,
    isActive: treatment.isActive,
  }))

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {enabled ? null : (
        <Alert tone="info" className="mb-4">
          {t('disabled')}
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('voice.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <VoiceChartingSetting enabled={flags.dentalVoice} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('treatments.title')}</CardTitle>
            <TreatmentDialog services={serviceOptions} label={t('treatments.add')} />
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-3 text-sm">{t('treatments.body')}</p>
            <ul className="divide-border flex flex-col divide-y">
              {treatments.map((treatment) => (
                <li
                  key={treatment.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <SymbolIcon symbol={treatment.symbol} size={18} className="shrink-0" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {treatment.name}
                        {treatment.isActive ? null : <Badge tone="neutral">{t('retired')}</Badge>}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {[
                          treatment.code,
                          tDental(`symbols.${treatment.symbol}`),
                          t(`scopes.${treatment.scope}`),
                          treatment.serviceId
                            ? t('treatments.priced', {
                                service: serviceName.get(treatment.serviceId) ?? t('unknown'),
                              })
                            : t('treatments.unpriced'),
                        ].join(' · ')}
                      </span>
                    </span>
                  </span>
                  <TreatmentDialog
                    treatment={treatment}
                    services={serviceOptions}
                    label={t('edit')}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('quickPicks.title')}</CardTitle>
            <QuickPickDialog treatments={treatmentOptions} label={t('quickPicks.add')} />
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-3 text-sm">{t('quickPicks.body')}</p>
            {quickPicks.length === 0 ? (
              <EmptyState title={t('quickPicks.none')} body={t('quickPicks.noneBody')} />
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {quickPicks.map((pick) => (
                  <li
                    key={pick.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {pick.name}
                        {pick.isActive ? null : <Badge tone="neutral">{t('retired')}</Badge>}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {pick.items
                          .map(
                            (item) =>
                              `${treatmentName.get(item.treatmentId) ?? t('unknown')}` +
                              (item.surfaces.length > 0 ? ` ${item.surfaces.join('')}` : '') +
                              ` (${tDental(`statuses.${item.status}`)})`,
                          )
                          .join(' + ')}
                      </span>
                    </span>
                    <QuickPickDialog pick={pick} treatments={treatmentOptions} label={t('edit')} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
