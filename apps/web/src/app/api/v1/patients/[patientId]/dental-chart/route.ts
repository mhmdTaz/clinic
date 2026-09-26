import { DentalChartQuery } from '@clinic/contracts'
import { getDentalChart } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The picture: every tooth of the patient's dentition and what it shows (ADR-0035). `asOf`
 * replays the chart as it stood at the end of that day, which is how the time slider works.
 */
export const GET = withApi(
  { permission: 'dental:read', query: DentalChartQuery },
  async ({ actor, query, params }) => ({
    data: await getDentalChart(actor, params.patientId ?? '', query),
  }),
)
