import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { holds } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getTicket } from '@clinic/core/support'
import { listUsers } from '@clinic/core/users'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { ReplyForm } from '@/components/support/reply-form'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/support/ticket-badges'
import { TicketThread } from '@/components/support/ticket-thread'
import { TriageControls } from '@/components/support/triage-controls'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { formatInstant } from '@/lib/format/dates'
import { orNotFound, type RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata({
  params,
}: {
  params: RouteParams<'ticketId'>
}): Promise<Metadata> {
  const actor = await requirePortal('staff')
  const ticket = await getTicket(actor, (await params).ticketId).catch(() => null)
  const t = await getTranslations('staff.support')
  return { title: ticket ? ticket.subject : t('title') }
}

/**
 * One conversation, from the clinic's side (S11).
 *
 * This is the only view where internal notes appear at all — the module returns them for
 * `ticket:manage` and strips them for everybody else, so what is on this page and what is on the
 * patient's are two different answers from one query rather than one answer filtered twice.
 */
export default async function StaffTicketPage({ params }: { params: RouteParams<'ticketId'> }) {
  const actor = await requirePortal('staff')
  const { ticketId } = await params

  const ticket = await orNotFound(getTicket(actor, ticketId))
  const canManage = holds(actor, 'ticket:manage')
  const [clinic, colleagues, t, tStatus, tPriority, locale] = await Promise.all([
    getClinicSessionInfo(actor.clinicId),
    canManage ? listUsers(actor, { status: 'ACTIVE', limit: 50 }) : null,
    getTranslations('staff.support'),
    getTranslations('support.statuses'),
    getTranslations('support.priorities'),
    getLocale(),
  ])

  const assignees = (colleagues?.items ?? []).map((person) => ({
    id: person.id,
    name: `${person.firstName} ${person.lastName}`.trim(),
  }))

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.number} · ${ticket.requester.name}`}
        badges={
          <span className="flex flex-wrap items-center gap-1.5">
            <TicketPriorityBadge priority={ticket.priority} label={tPriority(ticket.priority)} />
            <TicketStatusBadge status={ticket.status} label={tStatus(ticket.status)} />
          </span>
        }
        back={{ href: '/staff/support', label: t('back') }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <TicketThread ticket={ticket} timeZone={clinic.timezone} />
          {ticket.status === 'CLOSED' ? null : (
            <ReplyForm ticketId={ticket.id} canWriteInternal={canManage} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('triage')}</CardTitle>
              </CardHeader>
              <CardContent>
                <TriageControls ticket={ticket} assignees={assignees} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('about')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('requester')}</dt>
                  <dd>{ticket.requester.name}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('opened')}</dt>
                  <dd>
                    {ticket.createdAt
                      ? formatInstant(ticket.createdAt, locale, clinic.timezone)
                      : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('firstReply')}</dt>
                  <dd data-testid="first-reply">
                    {ticket.awaitingFirstReply ? t('stillWaiting') : t('answered')}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
