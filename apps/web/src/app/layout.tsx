import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import { directionOf } from '@/i18n/locales'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta')
  return { title: { default: t('appName'), template: `%s · ${t('appName')}` } }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    // `dir` on <html> is what makes every logical property in the stylesheet mirror: ps-, me-,
    // start-, end-. The layout was written with those from Phase 0, so switching direction is a
    // single attribute rather than a second stylesheet (section 14.4).
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
