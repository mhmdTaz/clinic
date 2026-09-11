'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Laptop } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import type { SessionSummary } from '@clinic/contracts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { describeUserAgent } from '@/lib/format/user-agent'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

export function SessionsCard({
  sessions,
  timeZone,
}: {
  sessions: SessionSummary[]
  timeZone: string
}) {
  const t = useTranslations('account.sessions')
  const format = useFormatter()
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone })

  const deviceLabel = (session: SessionSummary) => {
    const device = describeUserAgent(session.userAgent)
    if (session.deviceName) return session.deviceName
    if (device?.browser && device.os) return t('device', { browser: device.browser, os: device.os })
    return device?.browser ?? device?.os ?? t('unknownDevice')
  }

  async function revoke(session: SessionSummary) {
    setBusy(session.id)
    setError(null)
    try {
      await apiFetch(`/api/v1/me/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
      if (session.current) window.location.assign('/login')
      else router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function revokeAll() {
    setBusy('all')
    setError(null)
    try {
      await apiFetch('/api/v1/me/sessions', { method: 'DELETE' })
      window.location.assign('/login')
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(null)
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <ul className="divide-border flex flex-col divide-y">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Laptop
                  className="text-muted-foreground mt-0.5 size-5 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {deviceLabel(session)}
                    {session.current ? <Badge tone="success">{t('current')}</Badge> : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {session.lastUsedAt
                      ? t('lastActive', { date: when(session.lastUsedAt) })
                      : null}
                    {session.lastUsedAt ? ' · ' : null}
                    {t('started', { date: when(session.startedAt) })}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {session.ipAddress ?? t('ipUnknown')}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void revoke(session)}
                className="self-start sm:self-auto"
              >
                {t('revoke')}
              </Button>
            </li>
          ))}
        </ul>

        <div className="border-border flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">{t('revokeAllNote')}</p>
          <Button
            variant="danger"
            size="sm"
            disabled={busy !== null}
            onClick={() => void revokeAll()}
            className="self-start sm:self-auto"
          >
            {t('revokeAll')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
