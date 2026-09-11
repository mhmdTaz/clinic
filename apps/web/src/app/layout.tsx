import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Clinic — Phase 0',
  description: 'Walking skeleton for the clinic management platform.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
