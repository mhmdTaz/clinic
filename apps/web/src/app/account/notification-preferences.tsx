'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  SetNotificationPreferencesRequest,
  type NotificationPreferenceRow,
} from '@clinic/contracts'
import { Alert, Checkbox, Spinner } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * What this person wants to hear about (section 8.12).
 *
 * Saved on every change rather than behind a button, because a preferences screen with a Save
 * people forget is a preferences screen that lies to them.
 *
 * Locked rows are shown disabled with a reason rather than hidden. Somebody looking for "stop
 * telling me about cancellations" should find out that they cannot, not fail to find the row
 * and assume the feature is broken.
 */
export function NotificationPreferences({ rows }: { rows: NotificationPreferenceRow[] }) {
  const t = useTranslations('notifications.preferences')
  const tType = useTranslations('notifications.types')
  const errorMessage = useErrorMessage()

  const [current, setCurrent] = useState(rows)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(type: string, channel: 'inApp' | 'email', enabled: boolean) {
    const next = current.map((row) => (row.type === type ? { ...row, [channel]: enabled } : row))
    setCurrent(next)
    setPending(true)
    setError(null)
    try {
      const parsed = SetNotificationPreferencesRequest.safeParse({
        preferences: next.flatMap((row) => [
          { type: row.type, channel: 'IN_APP', enabled: row.inApp },
          { type: row.type, channel: 'EMAIL', enabled: row.email },
        ]),
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      const saved = await apiFetch<NotificationPreferenceRow[]>(
        '/api/v1/me/notification-preferences',
        { method: 'PUT', body: parsed.data },
      )
      // The server's answer wins: it applies the locks and drops anything matching a default.
      setCurrent(saved)
    } catch (caught) {
      setError(errorMessage(caught))
      setCurrent(current)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead>
            <tr className="text-muted-foreground border-border border-b">
              <th scope="col" className="py-2 text-start font-medium">
                {t('about')}
              </th>
              <th scope="col" className="w-24 py-2 text-center font-medium">
                {t('inApp')}
              </th>
              <th scope="col" className="w-24 py-2 text-center font-medium">
                {t('email')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {current.map((row) => (
              <tr key={row.type}>
                <th scope="row" className="py-2.5 text-start font-normal">
                  <span className="flex flex-col">
                    {tType(row.type)}
                    {row.isLocked ? (
                      <span className="text-muted-foreground text-xs">{t('alwaysOn')}</span>
                    ) : null}
                  </span>
                </th>
                <td className="py-2.5 text-center">
                  <Checkbox
                    checked={row.inApp}
                    disabled={row.isLocked || pending}
                    aria-label={t('inAppFor', { type: tType(row.type) })}
                    onChange={(event) => void toggle(row.type, 'inApp', event.target.checked)}
                  />
                </td>
                <td className="py-2.5 text-center">
                  <Checkbox
                    checked={row.email}
                    disabled={row.isLocked || pending}
                    aria-label={t('emailFor', { type: tType(row.type) })}
                    onChange={(event) => void toggle(row.type, 'email', event.target.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p aria-live="polite" className="text-muted-foreground flex items-center gap-2 text-xs">
        {pending ? <Spinner className="size-3" /> : null}
        {pending ? t('saving') : t('savedAutomatically')}
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}
