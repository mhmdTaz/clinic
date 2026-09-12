import { getPrescriptionPdf } from '@clinic/core/prescriptions'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A short-lived link to the printable copy, rendered on the first request for it and stored
 * (ADR-0026). The bytes come from object storage, never through this server.
 */
export const GET = withApi({ permission: 'prescription:read' }, async ({ actor, params }) => ({
  data: await getPrescriptionPdf(actor, params.prescriptionId ?? ''),
}))
