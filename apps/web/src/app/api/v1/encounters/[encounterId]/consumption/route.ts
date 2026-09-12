import { RecordConsumptionRequest } from '@clinic/contracts'
import { listConsumption, recordConsumption } from '@clinic/core/inventory'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'inventory:read' }, async ({ actor, params }) => ({
  data: await listConsumption(actor, params.encounterId ?? ''),
}))

/**
 * Phase 6's exit criterion: recording what a visit used decrements stock, writes a ledger row
 * and reaches the bill, all in one transaction (ADR-0029).
 */
export const POST = withApi(
  { permission: 'inventory:consume', body: RecordConsumptionRequest },
  async ({ actor, body, params }) => ({
    status: 201,
    data: await recordConsumption(actor, params.encounterId ?? '', body),
  }),
)
