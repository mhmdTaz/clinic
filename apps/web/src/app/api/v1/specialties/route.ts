import { CreateSpecialtyRequest } from '@clinic/contracts'
import { createSpecialty, listSpecialties } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi({ permission: 'doctor:read' }, async ({ actor }) => ({
  data: await listSpecialties(actor),
}))

export const POST = withApi(
  { permission: 'specialty:manage', body: CreateSpecialtyRequest },
  async ({ actor, body }) => ({ status: 201, data: await createSpecialty(actor, body) }),
)
