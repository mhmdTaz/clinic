import type { ReactNode } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import type { Prescription } from '@clinic/contracts'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { formatCalendarDate, formatInstant } from '@/lib/format/dates'
import { PrescriptionPdfButton } from './prescription-pdf-button'

/** What was prescribed (D8, P7), wherever it is read: the visit, the chart, the patient's own list. */
export async function PrescriptionsCard({
  prescriptions,
  timeZone,
  action,
  title,
  description,
  emptyBody,
}: {
  prescriptions: Prescription[]
  timeZone: string
  /** The builder, for someone who may write one. */
  action?: ReactNode
  title?: string
  description?: string
  emptyBody?: string
}) {
  const [t, locale] = await Promise.all([getTranslations('clinical.prescriptions'), getLocale()])
  const today = new Date().toISOString().slice(0, 10)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{title ?? t('title')}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {prescriptions.length === 0 ? (
          <EmptyState title={t('none')} body={emptyBody} action={action} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {prescriptions.map((prescription) => {
              const expired = Boolean(prescription.validUntil && prescription.validUntil < today)
              return (
                <li key={prescription.id} className="flex flex-col gap-2 py-4 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="tabular-nums">{prescription.number}</span>
                        {expired ? <Badge tone="neutral">{t('expired')}</Badge> : null}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatInstant(prescription.issuedAt, locale, timeZone)} ·{' '}
                        {prescription.doctor.name}
                        {prescription.validUntil
                          ? ` · ${t('validUntilLabel', {
                              date: formatCalendarDate(prescription.validUntil, locale),
                            })}`
                          : ''}
                      </span>
                    </div>
                    <PrescriptionPdfButton prescriptionId={prescription.id} />
                  </div>

                  <ul className="flex flex-col gap-1 text-sm">
                    {prescription.items.map((item) => (
                      <li key={item.id} className="break-words">
                        <span className="font-medium">
                          {[item.drugName, item.strength, item.form].filter(Boolean).join(' · ')}
                        </span>
                        <span className="text-muted-foreground">
                          {' '}
                          — {item.dosage}, {item.frequency}
                          {item.durationDays
                            ? `, ${t('forDays', { count: item.durationDays })}`
                            : ''}
                        </span>
                        {item.instructions ? (
                          <span className="text-muted-foreground block text-xs">
                            {item.instructions}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  {prescription.notes ? (
                    <p className="text-muted-foreground text-sm break-words">
                      {prescription.notes}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
