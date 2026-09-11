'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@clinic/ui'

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations()
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div role="alert" className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold">{t('errorPage.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('errorPage.body')}</p>
        <Button onClick={reset}>{t('common.retry')}</Button>
      </div>
    </main>
  )
}
