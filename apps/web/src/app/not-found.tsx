import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@clinic/ui'

export default async function NotFound() {
  const t = await getTranslations('errorPage')
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold">{t('notFoundTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('notFoundBody')}</p>
        <Link href="/" className={buttonVariants({ variant: 'primary' })}>
          {t('home')}
        </Link>
      </div>
    </main>
  )
}
