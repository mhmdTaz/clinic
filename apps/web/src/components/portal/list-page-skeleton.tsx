import { getTranslations } from 'next-intl/server'
import { Skeleton } from '@clinic/ui'

/** The shape of a list page while it loads, so the layout does not jump when the rows arrive. */
export async function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  const t = await getTranslations('common')
  return (
    <div>
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full sm:max-w-sm" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: rows }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
