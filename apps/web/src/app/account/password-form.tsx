'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@clinic/ui'
import { Field, describedBy } from '@/components/forms/field'
import { PasswordInput } from '@/components/forms/password-input'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, usePasswordIssues } from '@/lib/i18n/use-error-message'

export function PasswordForm() {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  const passwordIssues = usePasswordIssues()
  const [pending, setPending] = useState(false)
  const [changed, setChanged] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [mismatch, setMismatch] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const newPassword = String(form.get('newPassword') ?? '')
    if (newPassword !== String(form.get('confirm') ?? '')) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setPending(true)
    setError(null)
    setChanged(false)
    try {
      await apiFetch('/api/v1/me/password', {
        method: 'PUT',
        body: { currentPassword: String(form.get('currentPassword') ?? ''), newPassword },
      })
      formElement.reset()
      setChanged(true)
    } catch (caught) {
      setError(caught)
    } finally {
      setPending(false)
    }
  }

  const newIssues = passwordIssues(error, 'newPassword')
  const currentWrong = error instanceof ApiError && error.code === 'CURRENT_PASSWORD_INCORRECT'
  const general = error && newIssues.length === 0 && !currentWrong ? errorMessage(error) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.password.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {changed ? <Alert tone="success">{t('account.password.changed')}</Alert> : null}
          {general ? <Alert tone="danger">{general}</Alert> : null}

          <Field
            id="currentPassword"
            label={t('account.password.current')}
            errors={currentWrong ? [t('password.issues.INCORRECT')] : []}
          >
            <PasswordInput
              id="currentPassword"
              name="currentPassword"
              autoComplete="current-password"
              required
              aria-invalid={currentWrong}
              aria-describedby={describedBy('currentPassword', false, currentWrong)}
            />
          </Field>

          <Field
            id="newPassword"
            label={t('account.password.new')}
            hint={t('password.requirements')}
            errors={newIssues}
          >
            <PasswordInput
              id="newPassword"
              name="newPassword"
              autoComplete="new-password"
              required
              aria-invalid={newIssues.length > 0}
              aria-describedby={describedBy('newPassword', true, newIssues.length > 0)}
            />
          </Field>

          <Field
            id="confirm"
            label={t('account.password.confirm')}
            errors={mismatch ? [t('password.mismatch')] : []}
          >
            <PasswordInput
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              required
              aria-invalid={mismatch}
              aria-describedby={describedBy('confirm', false, mismatch)}
            />
          </Field>

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? <Spinner /> : null}
            {t('account.password.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
