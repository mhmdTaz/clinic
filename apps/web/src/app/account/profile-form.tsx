'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Spinner } from '@clinic/ui'
import { Field } from '@/components/forms/field'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

type Status = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }

export function ProfileForm({
  user,
  portals,
  canEdit,
}: {
  user: {
    firstName: string
    lastName: string
    email: string
    phone: string | null
    preferredPortal: string | null
  }
  portals: Array<{ key: string; label: string }>
  canEdit: boolean
}) {
  const t = useTranslations('account.profile')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const choosesPortal = portals.length > 1
  const canSubmit = canEdit || choosesPortal

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const patch: Record<string, unknown> = {}
    if (canEdit) {
      patch.firstName = String(form.get('firstName') ?? '').trim()
      patch.lastName = String(form.get('lastName') ?? '').trim()
      const phone = String(form.get('phone') ?? '').trim()
      patch.phone = phone === '' ? null : phone
    }
    if (choosesPortal) patch.preferredPortal = String(form.get('preferredPortal') ?? '')

    setStatus({ kind: 'saving' })
    try {
      await apiFetch('/api/v1/me', { method: 'PATCH', body: patch })
      setStatus({ kind: 'saved' })
      router.refresh()
    } catch (caught) {
      setStatus({ kind: 'error', message: errorMessage(caught) })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {status.kind === 'saved' ? <Alert tone="success">{t('saved')}</Alert> : null}
          {status.kind === 'error' ? <Alert tone="danger">{status.message}</Alert> : null}
          {!canEdit ? <Alert tone="info">{t('readOnly')}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="firstName" label={t('firstName')}>
              <Input
                id="firstName"
                name="firstName"
                defaultValue={user.firstName}
                autoComplete="given-name"
                maxLength={80}
                required
                disabled={!canEdit}
              />
            </Field>
            <Field id="lastName" label={t('lastName')}>
              <Input
                id="lastName"
                name="lastName"
                defaultValue={user.lastName}
                autoComplete="family-name"
                maxLength={80}
                required
                disabled={!canEdit}
              />
            </Field>
          </div>

          <Field id="email" label={t('email')} hint={t('emailNote')}>
            <Input id="email" value={user.email} readOnly aria-describedby="email-hint" />
          </Field>

          <Field id="phone" label={t('phone')}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={user.phone ?? ''}
              autoComplete="tel"
              maxLength={32}
              disabled={!canEdit}
            />
          </Field>

          {choosesPortal ? (
            <Field id="preferredPortal" label={t('preferredPortal')}>
              <select
                id="preferredPortal"
                name="preferredPortal"
                defaultValue={user.preferredPortal ?? portals[0]?.key}
                className="border-input bg-card h-11 w-full rounded-[var(--radius-control)] border px-3 text-base sm:text-sm"
              >
                {portals.map((portal) => (
                  <option key={portal.key} value={portal.key}>
                    {portal.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {canSubmit ? (
            <Button type="submit" disabled={status.kind === 'saving'} className="self-start">
              {status.kind === 'saving' ? <Spinner /> : null}
              {tCommon('save')}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
