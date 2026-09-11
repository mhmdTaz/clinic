import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from './login-form'

type SearchParams = Promise<Record<string, string | string[] | undefined>>
const single = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null)

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login')
  return { title: t('title') }
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const t = await getTranslations('auth.login')
  const reason = single(params.reason)

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <LoginForm
        next={single(params.next)}
        notice={reason === 'ended' || reason === 'reset' ? reason : null}
      />
    </AuthCard>
  )
}
