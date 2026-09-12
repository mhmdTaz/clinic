import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getTicket } from '@clinic/core/support'
import { ReplyForm } from '@/components/support/reply-form'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/support/ticket-badges'
import { TicketThread } from '@/components/support/ticket-thread'
import { Alert } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requireActor } from '@/lib/auth/server-session'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'ticketId'>
}): Promise<Metadata> {
  const actor = await requireActor()
  const ticket = await getTicket(actor, (await params).ticketId).catch(() => null)
  const t = await getTranslations('support.mine')
  return { title: ticket ? ticket.subject : t('title') }
}

/**
 * One conversation, from the asker's side.
 *
 * Internal notes never arrive here: the module filters them out for anybody who is not
 * clinic-side, so there is no `if` in this file deciding what to hide (ADR-0031).
 */
export default async function MyTicketPage({ params }: { params: RouteParams<'ticketId'> }) {
  const actor = await requireActor()
  const { ticketId } = await params

  const ticket = await orNotFound(getTicket(actor, ticketId))
  const [clinic, t, tStatus, tPriority] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    getTranslations('support.mine'),
    getTranslations('support.statuses'),
    getTranslations('support.priorities'),
  ])

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={ticket.number}
        badges={
          <span className="flex flex-wrap items-center gap-1.5">
            <TicketPriorityBadge priority={ticket.priority} label={tPriority(ticket.priority)} />
            <TicketStatusBadge status={ticket.status} label={tStatus(ticket.status)} />
          </span>
        }
        back={{ href: '/support', label: t('back') }}
      />

      <div className="flex flex-col gap-4">
        {ticket.status === 'CLOSED' ? <Alert tone="info">{t('closed')}</Alert> : null}

        <TicketThread ticket={ticket} timeZone={clinic.timezone} />

        {ticket.status === 'CLOSED' ? null : (
          <ReplyForm ticketId={ticket.id} canWriteInternal={false} />
        )}
      </div>
    </>
  )
}
