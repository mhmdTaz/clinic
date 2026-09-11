import { CreateDoctorRequest, DoctorListQuery } from '@clinic/contracts'
import { createDoctor, listDoctors } from '@clinic/core/doctors'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The whole directory: doctors per clinic are bounded, so it is one response, not pages. */
export const GET = withApi(
  { permission: 'doctor:read', query: DoctorListQuery },
  async ({ actor, query }) => ({ data: await listDoctors(actor, query) }),
)

export const POST = withApi(
  { permission: 'doctor:create', body: CreateDoctorRequest },
  async ({ actor, body }) => ({ status: 201, data: await createDoctor(actor, body) }),
)
