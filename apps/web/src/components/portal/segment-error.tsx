'use client'

import { useTranslations } from 'next-intl'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'

/**
 * A page that failed to load, shown inside the portal shell: the menu stays, so the person can
 * retry or go somewhere else instead of facing a blank screen.
 */
export function SegmentError({ reset }: { reset: () => void }) {
  const t = useTranslations()
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>{t('errorPage.segmentTitle')}</CardTitle>
        <CardDescription>{t('errorPage.segmentBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={reset}>{t('common.retry')}</Button>
      </CardContent>
    </Card>
  )
}
