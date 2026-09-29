import { getTranslations } from 'next-intl/server'
import { resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import { holds, type Actor } from '@clinic/core/access'
import { listServices } from '@clinic/core/billing'
import { getClinicFacts } from '@clinic/core/clinic'
import { listToothRecords, listTreatmentPlans, listTreatments } from '@clinic/core/dental'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { formatInstant } from '@/lib/format/dates'
import type { OpenWork } from './plan-editor-dialog'
import { TreatmentPlans } from './treatment-plans'

const PLANS_SHOWN = 20
/** A mouth has 52 teeth at most; a hundred open plans on one patient is already a lot. */
const OPEN_WORK_READ = 100

/**
 * Treatment plans on a patient's page (Phase 12), under the same gate as the chart they are
 * drawn from. Everything is read here on the server; the list and its dialogs are interactive.
 *
 * `basePath` is where this portal keeps a plan's own pages — presenting it and printing it.
 */
export async function TreatmentPlansCard({
  actor,
  patientId,
  clinic,
  locale,
  visits,
  basePath,
  editable = true,
}: {
  actor: Actor
  patientId: string
  clinic: { timezone: string; featureFlags: Record<string, boolean> }
  locale: string
  visits: ReadonlyArray<{ id: string; number: string; startedAt: string; status?: string }>
  basePath: string
  editable?: boolean
}) {
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)
  if (!flags.dental || !holds(actor, 'dental:read')) return null

  const canWrite = editable && holds(actor, 'dental:write')
  const [plans, planned, treatments, services, facts, t] = await Promise.all([
    listTreatmentPlans(actor, patientId, { limit: PLANS_SHOWN }),
    canWrite
      ? listToothRecords(actor, patientId, { status: 'PLANNED', limit: OPEN_WORK_READ })
      : { items: [], nextCursor: null },
    canWrite ? listTreatments(actor) : [],
    canWrite && holds(actor, 'service:read') ? listServices(actor, { status: 'all' }) : [],
    getClinicFacts(actor.clinicId),
    getTranslations('dental.plans'),
  ])

  const serviceOf = new Map(treatments.map((treatment) => [treatment.id, treatment.serviceId]))
  const priceOf = new Map(services.map((service) => [service.id, service]))
  const work: OpenWork[] = planned.items
    .filter((record) => !record.completedByRecordId && !record.voided)
    .map((record) => {
      const serviceId = serviceOf.get(record.treatment.id) ?? null
      const service = serviceId ? priceOf.get(serviceId) : undefined
      const priced = service?.isActive ? service : undefined
      return {
        recordId: record.id,
        teeth: record.teeth.map((tooth) => tooth.fdi),
        surfaces: record.surfaces,
        treatmentName: record.treatment.name,
        scope: record.treatment.scope,
        plannedOn: record.performedOn,
        listPrice: priced?.price ?? null,
        taxRatePercent: priced?.taxRatePercent ?? '0',
      }
    })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <TreatmentPlans
          patientId={patientId}
          plans={plans.items}
          work={work}
          visits={visits
            .filter((visit) => visit.status !== 'CANCELLED')
            .map((visit) => ({
              id: visit.id,
              label: `${visit.number} · ${formatInstant(visit.startedAt, locale, clinic.timezone)}`,
            }))}
          currency={facts.currency}
          locale={locale}
          timeZone={clinic.timezone}
          basePath={basePath}
          canWrite={canWrite}
          canBill={canWrite && holds(actor, 'invoice:create')}
        />
        <TruncatedNotice shown={plans.items.length} truncated={plans.nextCursor !== null} />
      </CardContent>
    </Card>
  )
}
