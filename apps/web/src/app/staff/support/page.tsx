import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import type { TicketListQuery } from '@clinic/contracts'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listTickets } from '@clinic/core/support'
import { Badge } from '@clinic/ui'
import { OpenTicketDialog } from '@/components/support/open-ticket-dialog'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/support/ticket-badges'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { param, type SearchParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staff.support')
  return { title: t('title') }
}

const VIEWS = ['open', 'mine', 'unassigned', 'all'] as const
const isView = (value: string | undefined): value is (typeof VIEWS)[number] =>
  value !== undefined && (VIEWS as readonly string[]).includes(value)

/**
 * The inbox (S11).
 *
 * It opens on everything the clinic still owes something on, and the column that matters most is
 * the one saying whether anybody has answered yet — a ticket sitting unanswered for a day is the
 * failure a support queue exists to prevent.
 */
export default async function SupportInboxPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePortal('staff')
  const values = await searchParams
  const view = param(values, 'view')

  const query: Partial<TicketListQuery> & { view: NonNullable<TicketListQuery['view']> } = {
    view: isView(view) ? view : 'open',
    q: param(values, 'q')?.slice(0, 80),
    cursor: param(values, 'cursor'),
    limit: 50,
  }

  const [page, clinic, t, tStatus, tPriority, tCategory, locale] = await Promise.all([
    listTickets(actor, query),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('staff.support'),
    getTranslations('support.statuses'),
    getTranslations('support.priorities'),
    getTranslations('support.categories'),
    getLocale(),
  ])

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<OpenTicketDialog label={t('log')} basePath="/staff/support" />}
      />
      <DataTable
        label={t('title')}
        search={{ placeholder: t('searchHint'), value: query.q ?? '' }}
        columns={[
          { id: 'ticket', header: t('columns.ticket'), priority: 1 },
          { id: 'status', header: t('columns.status'), priority: 2 },
          { id: 'assignee', header: t('columns.assignee'), priority: 3 },
          { id: 'updated', header: t('columns.updated'), priority: 2 },
        ]}
        filters={[
          {
            param: 'view',
            label: t('columns.status'),
            value: query.view,
            options: [
              { value: 'open', label: t('views.open') },
              { value: 'mine', label: t('views.mine') },
              { value: 'unassigned', label: t('views.unassigned') },
              { value: 'all', label: t('views.all') },
            ],
          },
        ]}
        nextCursor={page.nextCursor}
        rows={page.items.map((ticket) => ({
          id: ticket.id,
          href: `/staff/support/${ticket.id}`,
          cells: {
            ticket: (
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{ticket.subject}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  <span className="tabular-nums">{ticket.number}</span> · {ticket.requester.name} ·{' '}
                  {tCategory(ticket.category)}
                </span>
              </span>
            ),
            status: (
              <span className="flex flex-wrap items-center gap-1.5">
                <TicketPriorityBadge
                  priority={ticket.priority}
                  label={tPriority(ticket.priority)}
                />
                <TicketStatusBadge status={ticket.status} label={tStatus(ticket.status)} />
                {ticket.awaitingFirstReply ? <Badge tone="danger">{t('unanswered')}</Badge> : null}
              </span>
            ),
            assignee: ticket.assignee ? (
              ticket.assignee.name
            ) : (
              <span className="text-muted-foreground">{t('unassigned')}</span>
            ),
            updated: ticket.lastMessageAt ? (
              <span className="text-sm">
                {formatInstant(ticket.lastMessageAt, locale, clinic.timezone)}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          },
        }))}
        empty={{ title: t('none'), body: t('noneBody') }}
      />
    </>
  )
}
