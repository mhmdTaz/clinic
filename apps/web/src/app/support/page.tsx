import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { listTickets } from '@clinic/core/support'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { OpenTicketDialog } from '@/components/support/open-ticket-dialog'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/support/ticket-badges'
import { EmptyState } from '@/components/portal/empty-state'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { collectPages } from '@/lib/server/pages'
import { formatInstant } from '@/lib/format/dates'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('support.mine')
  return { title: t('title') }
}

/**
 * "I need to ask the clinic something" (P9, D16).
 *
 * One page for a patient and a doctor alike: whoever opens it sees the tickets they opened, and
 * the narrowing happens in the use case rather than here. That is why this sits outside both
 * portal folders — the question is the same whichever door you came in by.
 */
export default async function MyTicketsPage() {
  const actor = await requireActor()
  const [mine, clinic, t, tStatus, tPriority, locale] = await Promise.all([
    collectPages((page) => listTickets(actor, { view: 'all', ...page }), 500),
    getClinicSessionInfo(actor.clinicId),
    getTranslations('support.mine'),
    getTranslations('support.statuses'),
    getTranslations('support.priorities'),
    getLocale(),
  ])

  const tickets = mine.items

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        // On an empty page the action belongs to the empty state, which explains it. Rendering
        // it in both places puts two identical primary buttons on the same screen.
        actions={
          tickets.length > 0 ? <OpenTicketDialog label={t('ask')} basePath="/support" /> : null
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('yours')}</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <EmptyState
              title={t('none')}
              body={t('noneBody')}
              action={<OpenTicketDialog label={t('ask')} basePath="/support" />}
            />
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/support/${ticket.id}`}
                    className="hover:bg-muted -mx-2 flex flex-wrap items-start justify-between gap-3 rounded-md px-2 py-3"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium break-words">{ticket.subject}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {ticket.number}
                        {ticket.lastMessageAt
                          ? ` · ${formatInstant(ticket.lastMessageAt, locale, clinic.timezone)}`
                          : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <TicketPriorityBadge
                        priority={ticket.priority}
                        label={tPriority(ticket.priority)}
                      />
                      <TicketStatusBadge status={ticket.status} label={tStatus(ticket.status)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <TruncatedNotice shown={tickets.length} truncated={mine.truncated} />
        </CardContent>
      </Card>
    </>
  )
}
