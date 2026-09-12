import { getLocale, getTranslations } from 'next-intl/server'
import { TriangleAlert } from 'lucide-react'
import type { ChartBanner as Banner } from '@clinic/contracts'
import { Badge } from '@clinic/ui'
import { formatCalendarDate } from '@/lib/format/dates'
import { ChartBannerEditor } from './chart-banner-editor'

const SEVERITY_TONE = {
  SEVERE: 'danger',
  MODERATE: 'warning',
  MILD: 'neutral',
  UNKNOWN: 'neutral',
} as const

/** Worst first: the one that would kill someone should not be third in a row of badges. */
const SEVERITY_ORDER = { SEVERE: 0, MODERATE: 1, MILD: 2, UNKNOWN: 3 } as const

/**
 * The chart banner (D4) — the first thing on a chart, because it is the part that prevents harm.
 *
 * It costs nothing to render: allergies and chronic conditions are embedded on the patient
 * document, so they arrive with the record rather than in two more queries that could each fail
 * on their own (section 8.6). A banner that sometimes does not appear is worse than none, because
 * people learn to trust it.
 */
export async function ChartBanner({
  patientId,
  banner,
  canEdit,
}: {
  patientId: string
  banner: Banner
  canEdit: boolean
}) {
  const [t, locale] = await Promise.all([getTranslations('clinical.chart'), getLocale()])

  const allergies = [...banner.allergies].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const active = banner.chronicConditions.filter((condition) => !condition.resolvedAt)
  const resolved = banner.chronicConditions.filter((condition) => condition.resolvedAt)
  const dangerous = allergies.some((allergy) => allergy.severity === 'SEVERE')

  return (
    <section
      aria-label={t('bannerLabel')}
      className={[
        'mb-4 flex flex-col gap-3 rounded-[var(--radius-card)] border p-4',
        dangerous ? 'border-danger/40 bg-danger/5' : 'border-border bg-card',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {dangerous ? (
              <TriangleAlert className="text-danger size-4 shrink-0" aria-hidden="true" />
            ) : null}
            <span className="text-sm font-semibold">{t('allergies')}</span>
            {allergies.length === 0 ? (
              <span className="text-muted-foreground text-sm">{t('noAllergies')}</span>
            ) : (
              allergies.map((allergy) => (
                <Badge key={allergy.id} tone={SEVERITY_TONE[allergy.severity]}>
                  {/* Colour and words together, never colour alone (section 14.5). */}
                  {allergy.substance}
                  {allergy.reaction ? ` — ${allergy.reaction}` : ''}
                  {` (${t(`severities.${allergy.severity}`)})`}
                </Badge>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t('conditions')}</span>
            {active.length === 0 ? (
              <span className="text-muted-foreground text-sm">{t('noConditions')}</span>
            ) : (
              active.map((condition) => (
                <Badge key={condition.id} tone="neutral">
                  {condition.code ? `${condition.code} · ` : ''}
                  {condition.description}
                  {condition.diagnosedAt
                    ? ` (${formatCalendarDate(condition.diagnosedAt, locale)})`
                    : ''}
                </Badge>
              ))
            )}
          </div>

          {resolved.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('resolved', {
                list: resolved.map((condition) => condition.description).join(', '),
              })}
            </p>
          ) : null}
        </div>

        {canEdit ? <ChartBannerEditor patientId={patientId} banner={banner} /> : null}
      </div>
    </section>
  )
}
