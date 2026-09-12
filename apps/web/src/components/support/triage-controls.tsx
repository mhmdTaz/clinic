'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { UpdateTicketRequest, type TicketDetail } from '@clinic/contracts'
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@clinic/config'
import { Alert, Label, Select } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Triage (S11): status, priority and who owns it.
 *
 * Each control saves on change rather than behind a button. A front desk working a queue changes
 * one thing and moves on, and a Save they have to remember is a Save they will forget.
 */
export function TriageControls({
  ticket,
  assignees,
}: {
  ticket: TicketDetail
  assignees: Array<{ id: string; name: string }>
}) {
  const t = useTranslations('support.triage')
  const tStatus = useTranslations('support.statuses')
  const tPriority = useTranslations('support.priorities')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [error, setError] = useState<string | null>(null)

  async function save(patch: Record<string, unknown>) {
    setError(null)
    try {
      const parsed = UpdateTicketRequest.safeParse(patch)
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/support/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: parsed.data,
      })
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-status">{t('status')}</Label>
        <Select
          id="ticket-status"
          value={ticket.status}
          onChange={(event) => void save({ status: event.target.value })}
        >
          {TICKET_STATUSES.map((option) => (
            <option key={option} value={option}>
              {tStatus(option)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-priority">{t('priority')}</Label>
        <Select
          id="ticket-priority"
          value={ticket.priority}
          onChange={(event) => void save({ priority: event.target.value })}
        >
          {TICKET_PRIORITIES.map((option) => (
            <option key={option} value={option}>
              {tPriority(option)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ticket-assignee">{t('assignee')}</Label>
        <Select
          id="ticket-assignee"
          value={ticket.assignee?.id ?? ''}
          onChange={(event) => void save({ assigneeId: event.target.value || null })}
        >
          <option value="">{t('unassigned')}</option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}
