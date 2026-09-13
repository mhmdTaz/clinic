import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../client'
import { collectByIds, collectPages } from '../pages'
import { patientPortal } from '../resources/patient-portal'
import { memoryTokenStore } from '../tokens'

/** A collection of `total` numbered rows, served a page at a time the way the API serves it. */
function collection(total: number) {
  const rows = Array.from({ length: total }, (_, index) => index)
  const requests: Array<{ cursor: string | undefined; limit: number }> = []
  const fetchPage = vi.fn(async (page: { cursor: string | undefined; limit: number }) => {
    requests.push(page)
    const start = page.cursor ? Number(page.cursor) : 0
    const items = rows.slice(start, start + page.limit)
    const next = start + page.limit
    return { items, nextCursor: next < total ? String(next) : null }
  })
  return { fetchPage, requests }
}

describe('reading a bounded list whole', () => {
  it('follows the cursor to the end and says it did not stop short', async () => {
    const { fetchPage, requests } = collection(230)
    const listed = await collectPages(fetchPage, 500)

    expect(listed.items).toHaveLength(230)
    expect(listed.items.at(-1)).toBe(229)
    expect(listed.truncated).toBe(false)
    // Full pages while they last; never more than the API's own ceiling.
    expect(requests.map((request) => request.limit)).toEqual([100, 100, 100])
  })

  it('stops at the cap, asks for no more than it needs, and says so', async () => {
    const { fetchPage, requests } = collection(1000)
    const listed = await collectPages(fetchPage, 250)

    expect(listed.items).toHaveLength(250)
    expect(listed.truncated).toBe(true)
    expect(requests.map((request) => request.limit)).toEqual([100, 100, 50])
  })

  it('is not truncated when the list is exactly the cap', async () => {
    const { fetchPage } = collection(200)
    const listed = await collectPages(fetchPage, 200)
    // The second page came back with no cursor, so there is nothing past the cap.
    expect(listed).toMatchObject({ truncated: false })
    expect(listed.items).toHaveLength(200)
  })

  it('reads an empty collection as empty, in one request', async () => {
    const { fetchPage } = collection(0)
    expect(await collectPages(fetchPage, 500)).toEqual({ items: [], truncated: false })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

describe('reading by a long list of ids', () => {
  it('asks in slices the filter accepts, once per id', async () => {
    const ids = Array.from({ length: 230 }, (_, index) => `a${index}`)
    const slices: string[][] = []
    const rows = await collectByIds([...ids, 'a0', 'a1'], async (slice) => {
      slices.push(slice)
      return { items: slice.map((id) => ({ appointmentId: id })) }
    })

    expect(slices.map((slice) => slice.length)).toEqual([100, 100, 30])
    expect(rows).toHaveLength(230)
  })

  it('asks for nothing when there are no ids — the filter refuses an empty list', async () => {
    const fetchSlice = vi.fn()
    expect(await collectByIds([], fetchSlice)).toEqual([])
    expect(fetchSlice).not.toHaveBeenCalled()
  })
})

function patientStub(body: unknown, meta: Record<string, unknown> = {}) {
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
  return { portal: patientPortal(client), calls }
}

describe('the patient portal after Phase 10', () => {
  it('reads the booking window a patient books by', async () => {
    const { portal, calls } = patientStub({
      horizonDays: 60,
      minimumNoticeHours: 2,
      cancellationCutoffHours: 24,
    })
    const window = await portal.bookingWindow()
    expect(window.horizonDays).toBe(60)
    expect(calls[0]?.url).toBe('https://clinic.test/api/v1/clinic/booking-window')
  })

  it('returns the cursor to older notifications beside the feed', async () => {
    const { portal, calls } = patientStub(
      { items: [], unreadCount: 3 },
      { nextCursor: 'older-1', hasMore: true },
    )
    const feed = await portal.notifications({ limit: 30 })
    expect(feed).toEqual({ items: [], unreadCount: 3, nextCursor: 'older-1' })

    await portal.notifications({ limit: 30, cursor: 'older-1' })
    expect(calls[1]?.url).toBe(
      'https://clinic.test/api/v1/me/notifications?limit=30&cursor=older-1',
    )
  })

  it('says a feed has nothing older when the envelope carries no cursor', async () => {
    const { portal } = patientStub({ items: [], unreadCount: 0 })
    expect((await portal.notifications()).nextCursor).toBeNull()
  })

  it('sends the idempotency key with a cancellation when it is given one', async () => {
    const { portal, calls } = patientStub(null)
    await portal.cancelAppointment('ap1', { reason: null }, 'key-1').catch(() => undefined)
    await portal.cancelAppointment('ap1', { reason: null }).catch(() => undefined)

    const sent = (index: number) =>
      (calls[index]?.init.headers as Record<string, string> | undefined)?.['idempotency-key'] ??
      null
    expect(sent(0)).toBe('key-1')
    expect(sent(1)).toBeNull()
  })
})
