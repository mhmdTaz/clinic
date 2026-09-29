import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PlanPresentationPage } from '@/components/dental/plans/plan-page'
import { requirePortal } from '@/lib/auth/server-session'
import type { RouteParams } from '@/lib/server/page-helpers'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('dental.plans.presentation'))('pageTitle') }
}

export default async function PresentPlanPage({
  params,
}: {
  params: RouteParams<'patientId' | 'planId'>
}) {
  const actor = await requirePortal('staff')
  const { patientId, planId } = await params
  return (
    <PlanPresentationPage
      actor={actor}
      patientId={patientId}
      planId={planId}
      patientHref={`/staff/patients/${patientId}`}
    />
  )
}
