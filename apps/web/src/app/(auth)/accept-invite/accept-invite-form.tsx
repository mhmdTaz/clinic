'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { InvitationPreview, SessionResult } from '@clinic/contracts'
import { Alert, Button, Input, Spinner } from '@clinic/ui'
import { Field, describedBy } from '@/components/forms/field'
import { PasswordInput } from '@/components/forms/password-input'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useFragmentToken } from '@/lib/auth/use-fragment-token'
import { useErrorMessage, usePasswordIssues } from '@/lib/i18n/use-error-message'

type Preview =
  | { status: 'checking' }
  | { status: 'invalid'; message?: string }
  | { status: 'ready'; invitation: InvitationPreview }

export function AcceptInviteForm() {
  const t = useTranslations()
  const token = useFragmentToken()
  const errorMessage = useErrorMessage()
  const passwordIssues = usePasswordIssues()
  const [preview, setPreview] = useState<Preview>({ status: 'checking' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [mismatch, setMismatch] = useState(false)

  useEffect(() => {
    if (token === undefined) return
    if (token === null) {
      setPreview({ status: 'invalid' })
      return
    }
    let cancelled = false
    apiFetch<InvitationPreview>('/api/v1/auth/invitations/preview', {
      method: 'POST',
      body: { token },
    })
      .then((invitation) => {
        if (!cancelled) setPreview({ status: 'ready', invitation })
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        const linkDead = caught instanceof ApiError && caught.code === 'INVALID_OR_EXPIRED_LINK'
        setPreview({ status: 'invalid', message: linkDead ? undefined : errorMessage(caught) })
      })
    return () => {
      cancelled = true
    }
    // errorMessage is a fresh closure each render; the preview must run once per token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (preview.status === 'checking') return <Spinner label={t('auth.invite.checking')} />
  if (preview.status === 'invalid') {
    return <Alert tone="danger">{preview.message ?? t('auth.invite.invalid')}</Alert>
  }

  const { invitation } = preview

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
      const result = await apiFetch<SessionResult>('/api/v1/auth/accept-invite', {
        method: 'POST',
        body: { token, password },
      })
      window.location.assign(result.user.landingPath)
    } catch (caught) {
      setError(caught)
      setPending(false)
    }
  }

  const issues = passwordIssues(error, 'password')
  const general = error && issues.length === 0 ? errorMessage(error) : null

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed">
        {t('auth.invite.greeting', {
          firstName: invitation.firstName,
          clinicName: invitation.clinicName,
        })}
      </p>
      {general ? <Alert tone="danger">{general}</Alert> : null}

      <Field id="account" label={t('auth.invite.account')}>
        <Input id="account" value={invitation.email} readOnly autoComplete="username" />
      </Field>

      <Field
        id="password"
        label={t('auth.invite.password')}
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
        label={t('auth.invite.confirm')}
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
        {t('auth.invite.submit')}
      </Button>
    </form>
  )
}
