import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { ResetPasswordForm } from './reset-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.reset')
  return { title: t('title'), referrer: 'no-referrer' }
}

export default async function ResetPasswordPage() {
  const t = await getTranslations('auth.reset')
  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <ResetPasswordForm />
    </AuthCard>
  )
}
