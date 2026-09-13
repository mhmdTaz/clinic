import { getTranslations } from 'next-intl/server'

/**
 * Said when a list was cut short — the most recent `shown` rows, and no more.
 *
 * Before Phase 10 the repositories cut these lists off silently; a clinic with its 201st invoice
 * simply stopped seeing its oldest. A list that stops early now says so, where the list is.
 */
export async function TruncatedNotice({ shown, truncated }: { shown: number; truncated: boolean }) {
  if (!truncated) return null
  const t = await getTranslations('common')
  return (
    <p role="note" className="text-muted-foreground text-sm">
      {t('truncated', { count: shown })}
    </p>
  )
}
