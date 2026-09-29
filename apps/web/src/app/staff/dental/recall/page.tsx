import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listOverduePlans } from '@clinic/core/dental'
import { listDoctors } from '@clinic/core/doctors'
import { Money } from '@/components/billing/money'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { BookAppointmentDialog } from '@/components/scheduling/book-appointment-dialog'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate, formatInstant } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('dental.recall'))('title') }
}

const WAITED = ['30', '60', '90', '180'] as const

/**
 * Recall (Phase 12): patients who agreed to a plan and have not come back to finish it. The
 * longest-waiting first, and by default only those with nothing booked — the people to phone.
 * One click books them in, from the row.
 */
export default async function DentalRecallPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const clinic = await getClinicSessionInfo(actor.clinicId)
  if (!resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>).dental) notFound()

  const values = await searchParams
  const waited = WAITED.find((option) => option === param(values, 'waited')) ?? '30'
  const booked = param(values, 'booked') === 'all' ? 'all' : 'unbooked'
  const canBook = holds(actor, 'appointment:create') && holds(actor, 'doctor:read')

  const [page, doctors, t, locale] = await Promise.all([
    listOverduePlans(actor, {
      olderThanDays: Number(waited),
      unbooked: booked === 'unbooked',
      cursor: param(values, 'cursor'),
      limit: 50,
    }),
    canBook ? listDoctors(actor, { status: 'active' }) : [],
    getTranslations('dental.recall'),
    getLocale(),
  ])
  const today = localDateIn(clinic.timezone)
  const tScheduling = await getTranslations('scheduling')
  const doctorOptions = doctors.map((doctor) => ({
    id: doctor.id,
    name: [doctor.title, doctor.displayName].filter(Boolean).join(' '),
  }))

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DataTable
        label={t('title')}
        columns={[
          { id: 'patient', header: t('columns.patient'), priority: 1 },
          { id: 'plan', header: t('columns.plan'), priority: 2 },
          { id: 'agreed', header: t('columns.agreed'), priority: 3 },
          { id: 'left', header: t('columns.left'), priority: 2, align: 'end' },
          { id: 'next', header: t('columns.next'), priority: 3 },
          { id: 'book', header: t('columns.book'), priority: 1, align: 'end' },
        ]}
        filters={[
          {
            param: 'waited',
            label: t('filters.waited'),
            value: waited,
            options: WAITED.map((days) => ({ value: days, label: t('filters.days', { days }) })),
          },
          {
            param: 'booked',
            label: t('filters.booked'),
            value: booked,
            options: [
              { value: 'unbooked', label: t('filters.unbooked') },
              { value: 'all', label: t('filters.all') },
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        rows={page.items.map((row) => ({
          id: row.planId,
          cells: {
            patient: (
              <span className="flex min-w-0 flex-col">
                <Link
                  href={`/staff/patients/${row.patient.id}`}
                  className="font-medium break-words underline-offset-2 hover:underline"
                >
                  {row.patient.name}
                </Link>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {[row.patient.medicalRecordNo, row.patient.phone].filter(Boolean).join(' · ')}
                </span>
              </span>
            ),
            plan: (
              <span className="flex flex-col">
                <span>{row.title}</span>
                <span className="text-muted-foreground text-xs">
                  {t('itemsLeft', { open: row.openItems, total: row.totalItems })}
                </span>
              </span>
            ),
            agreed: (
              <span className="tabular-nums">
                {formatCalendarDate(localDateIn(clinic.timezone, new Date(row.acceptedAt)), locale)}
              </span>
            ),
            left: <Money amount={row.remaining} currency={row.currency} locale={locale} />,
            next: row.nextAppointmentAt ? (
              <span className="tabular-nums">
                {formatInstant(row.nextAppointmentAt, locale, clinic.timezone)}
              </span>
            ) : (
              <span className="text-muted-foreground">{t('nothingBooked')}</span>
            ),
            book:
              canBook && doctorOptions.length > 0 ? (
                <BookAppointmentDialog
                  doctors={doctorOptions}
                  patient={{
                    id: row.patient.id,
                    name: row.patient.name,
                    medicalRecordNo: row.patient.medicalRecordNo,
                  }}
                  date={today}
                  locale={locale}
                  timeZone={clinic.timezone}
                  label={tScheduling('actions.book')}
                  triggerVariant="outline"
                />
              ) : null,
          },
        }))}
        empty={{ title: t('none'), body: t('noneBody') }}
      />
    </>
  )
}
