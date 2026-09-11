import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { landingPath } from '@clinic/core/access'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { requireActor } from '@/lib/auth/server-session'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('noAccess')
  return { title: t('title') }
}

/** For a signed-in user whose roles grant no portal — instead of a redirect loop. */
export default async function NoAccessPage() {
  const actor = await requireActor()
  if (actor.portals.length > 0) redirect(landingPath(actor.portals, actor.preferredPortal))

  const t = await getTranslations('noAccess')
  return (
    <main className="bg-muted flex min-h-dvh items-center justify-center px-4">
      <div className="bg-card border-border flex max-w-md flex-col items-center gap-4 rounded-[var(--radius-card)] border p-8 text-center">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('body')}</p>
        <SignOutButton variant="outline" />
      </div>
    </main>
  )
}
