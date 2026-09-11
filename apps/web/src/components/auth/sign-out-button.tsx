'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, type ButtonProps } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'

/**
 * If the sign-out call itself fails, the browser still forgets the session through the
 * session-ended route, which clears the cookies. Staying signed in after pressing
 * "Sign out" is the failure a person would notice least and mind most.
 */
export async function signOutAndLeave(): Promise<void> {
  try {
    await apiFetch('/api/v1/auth/logout', { method: 'POST', body: {} })
    window.location.assign('/login')
  } catch {
    window.location.assign('/api/v1/auth/session-ended?next=%2F')
  }
}

export function SignOutButton(props: Omit<ButtonProps, 'onClick'>) {
  const t = useTranslations('common')
  const [pending, setPending] = useState(false)

  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        setPending(true)
        void signOutAndLeave()
      }}
    >
      {t('signOut')}
    </Button>
  )
}
