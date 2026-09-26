import { getTranslations } from 'next-intl/server'
import { resolveFeatureFlags, type FeatureFlags } from '@clinic/config'
import { localDateIn, type DentalSymbol } from '@clinic/contracts'
import { holds, type Actor } from '@clinic/core/access'
import { listPatientLabOrders, listToothRecords } from '@clinic/core/dental'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { TruncatedNotice } from '@/components/portal/truncated-notice'
import { LabOrders, type LabWork } from './lab-orders'

const ORDERS_SHOWN = 20
const WORK_READ = 100
/** What a dental lab makes. A filling or an extraction is not sent anywhere. */
const LAB_SYMBOLS: ReadonlySet<DentalSymbol> = new Set([
  'CROWN',
  'BRIDGE',
  'DENTURE',
  'VENEER',
  'IMPLANT',
])

/**
 * A patient's lab work (Phase 13), for a clinic with the chart and lab orders on. Planned work a
 * lab makes — crowns, bridges, dentures, veneers, implant crowns — can be sent from here; each
 * order moves through received, fitted, or back for a remake.
 */
export async function LabOrdersCard({
  actor,
  patientId,
  clinic,
  locale,
  editable = true,
}: {
  actor: Actor
  patientId: string
  clinic: { timezone: string; featureFlags: Record<string, boolean> }
  locale: string
  editable?: boolean
}) {
  const flags = resolveFeatureFlags(clinic.featureFlags as Partial<FeatureFlags>)
  if (!flags.dental || !flags.labOrders || !holds(actor, 'dental:read')) return null

  const canWrite = editable && holds(actor, 'dental:write')
  const [orders, planned, t] = await Promise.all([
    listPatientLabOrders(actor, patientId, { limit: ORDERS_SHOWN }),
    canWrite
      ? listToothRecords(actor, patientId, { status: 'PLANNED', limit: WORK_READ })
      : { items: [], nextCursor: null },
    getTranslations('dental.lab'),
  ])

  const work: LabWork[] = planned.items
    .filter(
      (record) =>
        !record.completedByRecordId && !record.voided && LAB_SYMBOLS.has(record.treatment.symbol),
    )
    .map((record) => ({
      recordId: record.id,
      label: `${record.treatment.name} — ${record.teeth.map((tooth) => tooth.fdi).join(', ')}`,
    }))

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <LabOrders
          patientId={patientId}
          orders={orders.items}
          work={work}
          labNames={[...new Set(orders.items.map((order) => order.labName))]}
          today={localDateIn(clinic.timezone)}
          locale={locale}
          canWrite={canWrite}
        />
        <TruncatedNotice shown={orders.items.length} truncated={orders.nextCursor !== null} />
      </CardContent>
    </Card>
  )
}
