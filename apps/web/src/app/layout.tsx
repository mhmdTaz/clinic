import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import './globals.css'

const RTL_LOCALES = new Set(['ar', 'fa', 'he', 'ur'])

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta')
  return { title: { default: t('appName'), template: `%s · ${t('appName')}` } }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
