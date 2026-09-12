import { getLocale, getTranslations } from 'next-intl/server'
import type { TicketDetail } from '@clinic/contracts'
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@clinic/ui'
import { formatInstant } from '@/lib/format/dates'

/**
 * The conversation (P9, S11).
 *
 * Internal notes are marked plainly and set apart, because a member of staff scanning a thread
 * has to be able to tell at a glance what the patient can see. They never reach this component
 * for anybody who is not clinic-side — the module filters them out on the way out — so this is
 * about legibility rather than about safety.
 */
export async function TicketThread({
  ticket,
  timeZone,
}: {
  ticket: TicketDetail
  timeZone: string
}) {
  const [t, locale] = await Promise.all([getTranslations('support.thread'), getLocale()])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {ticket.messages.map((message) => (
            <li
              key={message.id}
              data-testid={message.isInternal ? 'internal-note' : 'public-message'}
              className={cn(
                'rounded-lg border p-3',
                message.isInternal
                  ? 'border-warning/40 bg-warning/5 border-dashed'
                  : 'border-border',
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{message.author?.name ?? t('someone')}</span>
                {message.isInternal ? <Badge tone="warning">{t('internal')}</Badge> : null}
                <span className="text-muted-foreground text-xs">
                  {formatInstant(message.createdAt, locale, timeZone)}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
