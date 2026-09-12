import { useTranslations } from 'next-intl'
import type { ChainStatus } from '@clinic/contracts'
import { Alert } from '@clinic/ui'

/**
 * Whether the log can be trusted, at the top of the log (section 11.5).
 *
 * A green line saying "verified" every time somebody opens the page would become invisible
 * within a week, so a healthy chain gets one quiet sentence and a broken one gets an alert with
 * the entry named. The asymmetry is the point: this banner exists for the day it is red.
 */
export function ChainStatusBanner({ status }: { status: ChainStatus }) {
  const t = useTranslations('admin.audit.chain')

  if (status.ok) {
    return (
      // `auto` rather than inheriting: while a locale is only partly translated this sentence may
      // still be English, and an English sentence beginning with a number renders with the number
      // thrown to the far end of an RTL paragraph.
      <p dir="auto" className="text-muted-foreground mb-4 text-xs">
        {t('ok', { count: status.checked })}
        {status.unchained > 0 ? ` ${t('unchained', { count: status.unchained })}` : ''}
      </p>
    )
  }

  return (
    <Alert tone="danger" title={t('brokenTitle')} className="mb-4">
      <p>{t(`reason.${status.reason ?? 'UNKNOWN'}`)}</p>
      {status.brokenAt ? (
        <p className="mt-2 text-sm">
          {t('brokenAt', { action: status.brokenAt.action, id: status.brokenAt.id })}
        </p>
      ) : null}
      <p className="mt-2 text-sm">{t('brokenAdvice', { count: status.checked })}</p>
    </Alert>
  )
}
