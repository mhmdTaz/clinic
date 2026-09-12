'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Select } from '@clinic/ui'
import { useRouter } from '@/lib/navigation/use-router'
import { selectableLocales } from '@/i18n/locales'

/**
 * A person's own interface language (section 13.6).
 *
 * **Renders nothing while there is only one finished catalogue**, which is the case today: a
 * "choose your language" control offering one language is a control that wastes somebody's
 * attention. Everything behind it is live — the registry, the cookie, the direction, the per-key
 * English fallback — so completing a translation turns this on by flipping one flag rather than
 * by writing this screen.
 */
export function LanguageCard({ current }: { current: string }) {
  const t = useTranslations('account.language')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState(false)
  const options = selectableLocales()

  if (options.length < 2) return null

  async function choose(locale: string) {
    setFailed(false)
    const response = await fetch('/api/v1/me/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    if (!response.ok) {
      setFailed(true)
      return
    }
    // The whole interface changes, including its direction, so the page is re-rendered rather
    // than patched: a half-swapped layout mid-transition is worse than a moment's wait.
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <label htmlFor="account-language" className="sr-only">
          {t('title')}
        </label>
        <Select
          id="account-language"
          defaultValue={current}
          disabled={pending}
          onChange={(event) => void choose(event.target.value)}
        >
          {options.map((locale) => (
            // Each language named in its own words: a list in English is a list for people who
            // already read English.
            <option key={locale.code} value={locale.code} lang={locale.code}>
              {locale.endonym}
            </option>
          ))}
        </Select>
        {failed ? (
          <p role="alert" className="text-danger text-xs">
            {t('failed')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
