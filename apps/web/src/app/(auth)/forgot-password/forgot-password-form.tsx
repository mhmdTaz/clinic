'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Alert, Button, Input, Spinner } from '@clinic/ui'
import { Field } from '@/components/forms/field'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'

/**
 * The confirmation is identical whether or not the address has an account, so this form
 * cannot be used to find out who is a patient here.
 */
export function ForgotPasswordForm() {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setState('sending')
    setError(null)
    try {
      await apiFetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email: String(form.get('email') ?? '') },
      })
      setState('sent')
    } catch (caught) {
      setError(errorMessage(caught))
      setState('idle')
    }
  }

  if (state === 'sent') {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="success">{t('auth.forgot.sent')}</Alert>
        <Link href="/login" className="text-primary text-sm font-medium hover:underline">
          {t('common.backToSignIn')}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id="email" label={t('auth.forgot.email')}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </Field>
      <Button type="submit" size="lg" disabled={state === 'sending'} className="w-full">
        {state === 'sending' ? <Spinner /> : null}
        {t('auth.forgot.submit')}
      </Button>
      <Link href="/login" className="text-muted-foreground text-center text-sm hover:underline">
        {t('common.backToSignIn')}
      </Link>
    </form>
  )
}
