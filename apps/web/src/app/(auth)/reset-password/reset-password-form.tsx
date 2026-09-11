'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Alert, Button, Spinner } from '@clinic/ui'
import { Field, describedBy } from '@/components/forms/field'
import { PasswordInput } from '@/components/forms/password-input'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useFragmentToken } from '@/lib/auth/use-fragment-token'
import { useErrorMessage, usePasswordIssues } from '@/lib/i18n/use-error-message'

export function ResetPasswordForm() {
  const t = useTranslations()
  const token = useFragmentToken()
  const errorMessage = useErrorMessage()
  const passwordIssues = usePasswordIssues()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [mismatch, setMismatch] = useState(false)

  if (token === undefined) return <Spinner label={t('common.loading')} />

  if (token === null) {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="danger">{t('auth.reset.missingLink')}</Alert>
        <Link href="/forgot-password" className="text-primary text-sm font-medium hover:underline">
          {t('auth.reset.requestNew')}
        </Link>
      </div>
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('confirm') ?? '')) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setPending(true)
    setError(null)
    try {
      await apiFetch('/api/v1/auth/reset-password', { method: 'POST', body: { token, password } })
      window.location.assign('/login?reason=reset')
    } catch (caught) {
      setError(caught)
      setPending(false)
    }
  }

  const issues = passwordIssues(error, 'password')
  const linkDead = error instanceof ApiError && error.code === 'INVALID_OR_EXPIRED_LINK'
  const general = error && issues.length === 0 ? errorMessage(error) : null

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {general ? (
        <Alert tone="danger">
          {general}
          {linkDead ? (
            <>
              {' '}
              <Link href="/forgot-password" className="text-primary font-medium hover:underline">
                {t('auth.reset.requestNew')}
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      <Field
        id="password"
        label={t('auth.reset.password')}
        hint={t('password.requirements')}
        errors={issues}
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          autoFocus
          aria-invalid={issues.length > 0}
          aria-describedby={describedBy('password', true, issues.length > 0)}
        />
      </Field>

      <Field
        id="confirm"
        label={t('auth.reset.confirm')}
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

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {t('auth.reset.submit')}
      </Button>
    </form>
  )
}
