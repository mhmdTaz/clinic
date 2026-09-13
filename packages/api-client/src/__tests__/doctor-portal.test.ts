import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../client'
import { ContractMismatchError } from '../errors'
import { invalidatedBy, queryKeys } from '../query-keys'
import { doctorPortal } from '../resources/doctor-portal'
import { memoryTokenStore } from '../tokens'

function stub(body: unknown, meta: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchStub = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: body, meta: { requestId: 'req-1', ...meta } }),
    } as unknown as Response
  })
  const client = createClient({
    baseUrl: 'https://clinic.test',
    tokens: memoryTokenStore({
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      refreshToken: 'r',
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    fetch: fetchStub as unknown as typeof fetch,
  })
  return { portal: doctorPortal(client), calls }
}

const summary = {
  id: 'p1',
  medicalRecordNo: 'MRN-000001',
  firstName: 'Sara',
  lastName: 'Karam',
  dateOfBirth: '1990-04-02',
  gender: 'FEMALE',
  phone: null,
  email: null,
  isActive: true,
  hasPortalAccount: true,
  updatedAt: null,
}

describe('the doctor portal', () => {
  /**
   * The regression this pins: the first client parsed a caseload as full records. A patient's
   * session gets an empty array from the endpoint, and an empty array satisfies any array schema,
   * so the only way to see the bug was to be a doctor with patients.
   */
  it('reads the caseload as summaries, which is what the endpoint returns', async () => {
    const { portal } = stub([summary])
    const patients = await portal.patientsITreat()
    expect(patients.items[0]?.medicalRecordNo).toBe('MRN-000001')
  })

  it('pages through the caseload with the cursor the envelope carried', async () => {
    const { portal, calls } = stub([summary], { nextCursor: 'next-1', hasMore: true })
    const first = await portal.patientsITreat({ limit: 1 })
    expect(first.nextCursor).toBe('next-1')
    expect(first.hasMore).toBe(true)

    await portal.patientsITreat({ cursor: 'next-1', limit: 1 })
    expect(calls[1]?.url).toBe('https://clinic.test/api/v1/me/patients?cursor=next-1&limit=1')
  })

  it('still refuses a caseload that is not the contract', async () => {
    const { portal } = stub([{ id: 'p1' }])
    await expect(portal.patientsITreat()).rejects.toBeInstanceOf(ContractMismatchError)
  })

  it('writes the draft with PATCH and signs with POST', async () => {
    const { portal, calls } = stub(null)
    // The schema will reject a null body; the call shape is what is under test here.
    await portal.updateEncounter('e1', { note: { plan: 'Rest' } }).catch(() => undefined)
    await portal.signNote('e1', { signature: 'Dr Nabil Saad' }).catch(() => undefined)

    expect(calls[0]?.url).toBe('https://clinic.test/api/v1/encounters/e1')
    expect(calls[0]?.init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ note: { plan: 'Rest' } })

    expect(calls[1]?.url).toBe('https://clinic.test/api/v1/encounters/e1/sign')
    expect(calls[1]?.init.method).toBe('POST')
  })

  it('asks for the visits of a day’s appointments as one comma-separated parameter', async () => {
    // A repeated parameter would reach the server as its last value alone: the API reads a query
    // into one object, so all but one appointment would silently go unmatched.
    const { portal, calls } = stub([])
    await portal.encounters({ appointmentIds: ['a1', 'a2', 'a3'], limit: 100 })
    const url = new URL(calls[0]?.url ?? '')
    expect(url.pathname).toBe('/api/v1/encounters')
    expect(url.searchParams.getAll('appointmentIds')).toEqual(['a1,a2,a3'])
    expect(url.searchParams.get('limit')).toBe('100')
  })

  it('leaves the appointment filter out when there is none', async () => {
    const { portal, calls } = stub([])
    await portal.encounters({ patientId: 'p1' })
    expect(calls[0]?.url).toBe('https://clinic.test/api/v1/encounters?patientId=p1')
  })

  it('narrows the visit list by the day, as the query string', async () => {
    const { portal, calls } = stub([])
    await portal.encounters({ from: '2026-09-14', to: '2026-09-14' })
    expect(calls[0]?.url).toBe(
      'https://clinic.test/api/v1/encounters?from=2026-09-14&to=2026-09-14',
    )
  })
})

describe('the shared cache keys', () => {
  it('keeps a doctor’s caseload out of the `me` subtree the app keeps offline', () => {
    expect(queryKeys.patientsITreat()[0]).not.toBe('me')
  })

  it('refreshes the day and the chart when a visit is opened', () => {
    const prefixes = invalidatedBy.visitOpened().map((key) => key[0])
    expect(prefixes).toEqual(expect.arrayContaining(['encounters', 'appointments', 'patients']))
  })
})
