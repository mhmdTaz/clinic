import { getTranslations } from 'next-intl/server'
import { resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import { localDateIn } from '@clinic/contracts'
import { holds, type Actor } from '@clinic/core/access'
import {
  getDentalChart,
  listQuickPicks,
  listTreatments,
  openLabOrdersFor,
} from '@clinic/core/dental'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { formatInstant } from '@/lib/format/dates'
import { DentalChart } from './dental-chart'

/**
 * The tooth chart on a patient's page (Phase 11), for a clinic that has turned it on and a caller
 * who may read it. Everything the card needs is read here, on the server, in one go; the chart
 * itself is interactive and lives in the client.
 *
 * `visits` are the patient's visits already loaded by the page. The one to chart against defaults
 * to `visitId` when the page is a visit, otherwise to the newest visit started today — the front
 * desk charting after the dentist has finished.
 */
export async function DentalChartCard({
  actor,
  patientId,
  clinic,
  locale,
  visits,
  visitId = null,
  editable = true,
}: {
  actor: Actor
  patientId: string
  clinic: { timezone: string; featureFlags: Record<string, boolean> }
  locale: string
  visits: ReadonlyArray<{ id: string; number: string; startedAt: string }>
  visitId?: string | null
  editable?: boolean
}) {
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)
  if (!flags.dental || !holds(actor, 'dental:read')) return null

  const [chart, treatments, quickPicks, labOrders, t] = await Promise.all([
    getDentalChart(actor, patientId),
    listTreatments(actor),
    listQuickPicks(actor),
    flags.labOrders ? openLabOrdersFor(actor, patientId) : [],
    getTranslations('dental'),
  ])

  const today = localDateIn(clinic.timezone)
  const options = visits.map((visit) => ({
    id: visit.id,
    label: `${visit.number} · ${formatInstant(visit.startedAt, locale, clinic.timezone)}`,
  }))
  const todays = visits.find(
    (visit) => localDateIn(clinic.timezone, new Date(visit.startedAt)) === today,
  )

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <DentalChart
          patientId={patientId}
          chart={chart}
          treatments={treatments}
          quickPicks={quickPicks}
          visits={options}
          defaultVisitId={visitId ?? todays?.id ?? null}
          today={today}
          canWrite={editable && holds(actor, 'dental:write')}
          labOrders={labOrders}
          voice={flags.dentalVoice}
          files={{
            canRead: holds(actor, 'file:read'),
            canUpload: editable && holds(actor, 'file:upload'),
          }}
        />
      </CardContent>
    </Card>
  )
}
