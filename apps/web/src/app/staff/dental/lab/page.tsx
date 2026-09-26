import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { LAB_ORDER_STATUSES, resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import type { LabOrderStatus } from '@clinic/contracts'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listLabOrders } from '@clinic/core/dental'
import { Badge } from '@clinic/ui'
import { DataTable } from '@/components/data-table/data-table'
import { LAB_TONES } from '@/components/dental/lab/lab-tones'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatCalendarDate } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('dental.lab.board'))('title') }
}

const isStatus = (value: string | undefined): value is LabOrderStatus =>
  value !== undefined && (LAB_ORDER_STATUSES as readonly string[]).includes(value)

/**
 * The lab board (Phase 13): every piece of work out at a lab or back and waiting to be fitted,
 * soonest due first, with the late ones marked. It opens on what is not finished with; a status
 * or "late only" is one filter away.
 */
export default async function LabBoardPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const clinic = await getClinicSessionInfo(actor.clinicId)
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)
  if (!flags.dental || !flags.labOrders) notFound()

  const values = await searchParams
  const view = param(values, 'view') ?? 'open'
  const [page, t, locale] = await Promise.all([
    listLabOrders(actor, {
      status: isStatus(view) ? view : undefined,
      overdue: view === 'late' ? true : undefined,
      cursor: param(values, 'cursor'),
      limit: 50,
    }),
    getTranslations('dental.lab'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader title={t('board.title')} subtitle={t('board.subtitle')} />
      <DataTable
        label={t('board.title')}
        columns={[
          { id: 'patient', header: t('board.columns.patient'), priority: 1 },
          { id: 'work', header: t('board.columns.work'), priority: 1 },
          { id: 'lab', header: t('board.columns.lab'), priority: 2 },
          { id: 'due', header: t('board.columns.due'), priority: 1 },
          { id: 'status', header: t('board.columns.status'), priority: 2 },
        ]}
        filters={[
          {
            param: 'view',
            label: t('board.columns.status'),
            value: view,
            options: [
              { value: 'open', label: t('board.open') },
              { value: 'late', label: t('board.lateOnly') },
              ...LAB_ORDER_STATUSES.map((status) => ({
                value: status,
                label: t(`statuses.${status}`),
              })),
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        rows={page.items.map((order) => ({
          id: order.id,
          href: `/staff/patients/${order.patientId}`,
          cells: {
            patient: (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{order.patient.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {order.patient.medicalRecordNo}
                </span>
              </span>
            ),
            work: (
              <span>
                {order.work.map((entry) => entry.name).join(', ')}
                {order.teeth.length > 0 ? (
                  <span className="text-muted-foreground"> — {order.teeth.join(', ')}</span>
                ) : null}
              </span>
            ),
            lab: order.labName,
            due: <span className="tabular-nums">{formatCalendarDate(order.dueOn, locale)}</span>,
            status: (
              <Badge tone={order.overdue ? 'danger' : LAB_TONES[order.status]}>
                {order.overdue ? t('late') : t(`statuses.${order.status}`)}
              </Badge>
            ),
          },
        }))}
        empty={{ title: t('board.none'), body: t('board.noneBody') }}
      />
      <p className="text-muted-foreground mt-3 text-sm">
        {t('board.hint')}{' '}
        <Link href="/staff/patients" className="underline underline-offset-2">
          {t('board.patients')}
        </Link>
      </p>
    </>
  )
}
