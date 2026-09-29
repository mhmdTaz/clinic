import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { directionOf } from '@/i18n/locales'
import { CLIENT_NAMESPACES, pickMessages } from '@/lib/i18n/client-messages'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta')
  return { title: { default: t('appName'), template: `%s · ${t('appName')}` } }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()])
  return (
    // `dir` on <html> is what makes every logical property in the stylesheet mirror: ps-, me-,
    // start-, end-. The layout was written with those from Phase 0, so switching direction is a
    // single attribute rather than a second stylesheet (section 14.4).
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh">
        {/* Only what client components look up; the rest is rendered on the server. */}
        <NextIntlClientProvider messages={pickMessages(messages, CLIENT_NAMESPACES)}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
