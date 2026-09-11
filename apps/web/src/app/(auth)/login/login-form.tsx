'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { SessionResult } from '@clinic/contracts'
import { Alert, Button, Input, Spinner } from '@clinic/ui'
import { Field } from '@/components/forms/field'
import { PasswordInput } from '@/components/forms/password-input'
import { apiFetch } from '@/lib/api/client'
import { postLoginPath } from '@/lib/auth/post-login'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

export function LoginForm({
  next,
  notice,
}: {
  next: string | null
  notice: 'ended' | 'reset' | null
}) {
  const t = useTranslations('auth.login')
  const errorMessage = useErrorMessage()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await apiFetch<SessionResult>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        },
      })
      // A full navigation, so the server renders the portal with the new cookies in place.
      window.location.assign(postLoginPath(next, result.user))
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {notice && !error ? <Alert tone="info">{t(`notices.${notice}`)}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field id="email" label={t('email')}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </Field>

      <Field
        id="password"
        label={t('password')}
        trailing={
          <Link
            href="/forgot-password"
            className="text-primary text-sm font-medium hover:underline"
          >
            {t('forgot')}
          </Link>
        }
      >
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {t('submit')}
      </Button>
    </form>
  )
}
