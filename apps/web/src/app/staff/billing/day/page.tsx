import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn, LocalDate } from '@clinic/contracts'
import { dailyReconciliation } from '@clinic/core/billing'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'
import { DayPicker } from './day-picker'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.billing.day')
  return { title: t('title') }
}

/**
 * The day the front desk closes on (S9).
 *
 * Every row is taken, refunded and the net of the two; the footer is the sum of those same
 * rows rather than a second, independent calculation, which is what keeps the report
 * reconciling to the cent no matter how the day went.
 */
export default async function DayEndPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const clinic = await getClinicSessionInfo(actor.clinicId)

  const requested = param(await searchParams, 'date')
  const parsed = requested ? LocalDate.safeParse(requested) : null
  const date = parsed?.success ? parsed.data : localDateIn(clinic.timezone)

  const [report, t, tMethod, locale] = await Promise.all([
    dailyReconciliation(actor, { date }),
    getTranslations('staff.billing.day'),
    getTranslations('billing.methods'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={formatCalendarDate(date, locale)}
        back={{ href: '/staff/billing', label: t('back') }}
        actions={<DayPicker date={date} label={t('date')} />}
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('takings')}</CardTitle>
            <CardDescription>{t('takingsHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('takings')}</caption>
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-start">
                    <th scope="col" className="py-2 text-start font-medium">
                      {t('columns.method')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('columns.count')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('columns.taken')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('columns.refunded')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('columns.net')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {report.byMethod.map((row) => (
                    <tr key={row.method}>
                      <th scope="row" className="py-2 text-start font-normal">
                        {tMethod(row.method)}
                      </th>
                      <td className="py-2 text-end tabular-nums">{row.count}</td>
                      <td className="py-2 text-end">
                        <Money amount={row.taken} currency={report.currency} locale={locale} />
                      </td>
                      <td className="py-2 text-end">
                        <Money
                          amount={row.refunded}
                          currency={report.currency}
                          locale={locale}
                          tone="muted"
                        />
                      </td>
                      <td className="py-2 text-end">
                        <Money
                          amount={row.net}
                          currency={report.currency}
                          locale={locale}
                          tone="strong"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-border border-t-2">
                    <th scope="row" className="py-2 text-start font-semibold">
                      {t('total')}
                    </th>
                    <td className="py-2 text-end font-semibold tabular-nums">{report.count}</td>
                    <td className="py-2 text-end">
                      <Money
                        amount={report.taken}
                        currency={report.currency}
                        locale={locale}
                        tone="strong"
                      />
                    </td>
                    <td className="py-2 text-end">
                      <Money
                        amount={report.refunded}
                        currency={report.currency}
                        locale={locale}
                        tone="strong"
                      />
                    </td>
                    <td className="py-2 text-end" data-testid="day-net">
                      <Money
                        amount={report.net}
                        currency={report.currency}
                        locale={locale}
                        tone="strong"
                      />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('invoiced')}</CardTitle>
            <CardDescription>{t('invoicedHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('columns.count')}</dt>
                <dd className="tabular-nums">{report.invoiceCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('columns.total')}</dt>
                <dd>
                  <Money
                    amount={report.invoiced}
                    currency={report.currency}
                    locale={locale}
                    tone="strong"
                  />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
