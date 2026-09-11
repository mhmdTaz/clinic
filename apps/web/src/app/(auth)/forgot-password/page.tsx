import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { ForgotPasswordForm } from './forgot-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgot')
  return { title: t('title') }
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth.forgot')
  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <ForgotPasswordForm />
    </AuthCard>
  )
}
