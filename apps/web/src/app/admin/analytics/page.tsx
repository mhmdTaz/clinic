import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { getAnalyticsOverview } from '@clinic/core/analytics'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { AnalyticsRange } from '@/components/analytics/analytics-range'
import { DoctorUtilisationTable } from '@/components/analytics/doctor-utilisation-table'
import { MiniBarChart } from '@/components/analytics/mini-bar-chart'
import { StatCard } from '@/components/analytics/stat-card'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate } from '@/lib/format/dates'
import { formatMoney } from '@/lib/format/money'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.analytics')
  return { title: t('title') }
}

/**
 * The admin dashboard (A8).
 *
 * Rendered on the server from the use case, so the numbers arrive with the page rather than
 * after four spinners — and every figure is derived on read, so nothing here can disagree with
 * the invoices it came from.
 *
 * The range lives in the address, which makes a particular month a link somebody can send.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('admin')
  const values = await searchParams

  const [overview, clinic, t, locale] = await Promise.all([
    getAnalyticsOverview(actor, { from: param(values, 'from'), to: param(values, 'to') }),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('admin.analytics'),
    getLocale(),
  ])

  const { revenue, appointments, patients, range } = overview
  const money = (amount: string) => formatMoney({ amount, currency: revenue.currency }, locale)

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', {
          from: formatCalendarDate(range.from, locale),
          to: formatCalendarDate(range.to, locale),
        })}
      />

      <div className="flex flex-col gap-6">
        <AnalyticsRange
          from={range.from}
          to={range.to}
          // Today in the clinic's timezone, not in UTC: after 21:00 in Beirut those are
          // different days, and the later one has no data in it yet.
          max={localDateIn(clinic.timezone)}
          labels={{ from: t('range.from'), to: t('range.to'), presets: t('range.presets') }}
          presets={[
            { days: 7, label: t('range.last7') },
            { days: 30, label: t('range.last30') },
            { days: 90, label: t('range.last90') },
          ]}
        />

        <section aria-labelledby="analytics-money" className="flex flex-col gap-3">
          <h2 id="analytics-money" className="text-lg font-semibold">
            {t('money')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('collected')} value={money(revenue.net)} hint={t('collectedHint')} />
            <StatCard
              label={t('invoiced')}
              value={money(revenue.invoiced)}
              hint={t('invoicedHint')}
            />
            <StatCard
              label={t('outstanding')}
              value={money(revenue.outstanding)}
              hint={t('outstandingHint')}
              tone={revenue.outstanding.startsWith('-') ? 'default' : 'warning'}
            />
            <StatCard
              label={t('refunded')}
              value={money(revenue.refunded)}
              hint={t('refundedHint')}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('revenueByDay')}</CardTitle>
            </CardHeader>
            <CardContent>
              <MiniBarChart
                caption={t('revenueCaption')}
                emptyLabel={t('noData')}
                points={revenue.byDay.map((point) => ({
                  label: formatCalendarDate(point.date, locale),
                  value: Number(point.amount),
                  display: money(point.amount),
                }))}
              />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="analytics-appointments" className="flex flex-col gap-3">
          <h2 id="analytics-appointments" className="text-lg font-semibold">
            {t('visits')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('booked')}
              value={String(appointments.total)}
              hint={t('bookedHint')}
            />
            <StatCard
              label={t('completed')}
              value={`${appointments.completionRate}%`}
              hint={t('ofBooked', { count: appointments.byStatus.COMPLETED ?? 0 })}
            />
            <StatCard
              label={t('noShows')}
              value={`${appointments.noShowRate}%`}
              hint={t('ofBooked', { count: appointments.byStatus.NO_SHOW ?? 0 })}
              tone={appointments.noShowRate >= 10 ? 'warning' : 'default'}
            />
            <StatCard
              label={t('cancelled')}
              value={`${appointments.cancellationRate}%`}
              hint={t('ofBooked', { count: appointments.byStatus.CANCELLED ?? 0 })}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('appointmentsByDay')}</CardTitle>
            </CardHeader>
            <CardContent>
              <MiniBarChart
                caption={t('appointmentsCaption')}
                emptyLabel={t('noData')}
                points={appointments.byDay.map((point) => ({
                  label: formatCalendarDate(point.date, locale),
                  value: point.booked,
                  display: String(point.booked),
                }))}
              />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="analytics-doctors" className="flex flex-col gap-3">
          <h2 id="analytics-doctors" className="text-lg font-semibold">
            {t('doctors')}
          </h2>
          <Card>
            <CardContent className="pt-6">
              <DoctorUtilisationTable
                rows={overview.doctors}
                labels={{
                  caption: t('utilisationCaption'),
                  doctor: t('columns.doctor'),
                  appointments: t('columns.appointments'),
                  booked: t('columns.bookedHours'),
                  rostered: t('columns.rosteredHours'),
                  utilisation: t('columns.utilisation'),
                  notRostered: t('notRostered'),
                  empty: t('noDoctors'),
                }}
              />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="analytics-patients" className="flex flex-col gap-3">
          <h2 id="analytics-patients" className="text-lg font-semibold">
            {t('people')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t('seen')} value={String(patients.seenCount)} hint={t('seenHint')} />
            <StatCard
              label={t('newPatients')}
              value={String(patients.newCount)}
              hint={t('newHint', { percent: patients.newPercent })}
            />
            <StatCard
              label={t('returning')}
              value={String(patients.returningCount)}
              hint={t('returningHint')}
            />
          </div>
        </section>
      </div>
    </>
  )
}
