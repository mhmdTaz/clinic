import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import type { Actor } from '@clinic/core/access'
import { getClinicSessionInfo } from '@clinic/core/clinic'
import { getDentalChart, getTreatmentPlan } from '@clinic/core/dental'
import { getPatient } from '@clinic/core/patients'
import { orNotFound } from '@/lib/server/page-helpers'
import { PlanDocument } from './plan-document'
import { PlanPresentation } from './plan-presentation'

/**
 * A plan's own pages (Phase 12), the same in the staff and the doctor portal: presenting it to
 * the patient, and printing it. The plan must be this patient's — a plan id pasted under another
 * patient's address is not found, rather than shown under the wrong name.
 */
async function load(actor: Actor, patientId: string, planId: string) {
  const clinic = await getClinicSessionInfo(actor.clinicId)
  if (!resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>).dental) notFound()
  const plan = await orNotFound(getTreatmentPlan(actor, planId))
  if (plan.patientId !== patientId) notFound()
  const [chart, patient, locale] = await Promise.all([
    getDentalChart(actor, patientId),
    orNotFound(getPatient(actor, patientId)),
    getLocale(),
  ])
  return { clinic, plan, chart, patient, locale }
}

export async function PlanPresentationPage({
  actor,
  patientId,
  planId,
  patientHref,
}: {
  actor: Actor
  patientId: string
  planId: string
  patientHref: string
}) {
  const { plan, chart, patient, locale } = await load(actor, patientId, planId)
  return (
    <PlanPresentation
      plan={plan}
      chart={chart}
      patient={{ id: patient.id, name: `${patient.firstName} ${patient.lastName}` }}
      locale={locale}
      closeHref={patientHref}
    />
  )
}

export async function PlanPrintPage({
  actor,
  patientId,
  planId,
  patientHref,
}: {
  actor: Actor
  patientId: string
  planId: string
  patientHref: string
}) {
  const { clinic, plan, chart, patient, locale } = await load(actor, patientId, planId)
  return (
    <PlanDocument
      actor={actor}
      plan={plan}
      chart={chart}
      patient={{
        name: `${patient.firstName} ${patient.lastName}`,
        medicalRecordNo: patient.medicalRecordNo,
        dateOfBirth: patient.dateOfBirth,
      }}
      locale={locale}
      timeZone={clinic.timezone}
      backHref={patientHref}
    />
  )
}
