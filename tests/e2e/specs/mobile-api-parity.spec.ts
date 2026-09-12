import { createClient, memoryTokenStore, authResource, patientPortal } from '@clinic/api-client'
import type { ApiClient } from '@clinic/api-client'
import { E2E } from '../e2e.env'
import { expect, test } from './fixtures'

/**
 * **Phase 9's exit criterion**: *"No backend work should be required beyond push registration —
 * that is the test of whether sections 6 and 9 were implemented honestly."*
 *
 * So this is the test. Every call below goes through `@clinic/api-client` over plain HTTP, with a
 * **Bearer token and no cookie**, exactly as a phone would — no Server Action, no React Server
 * Component, no browser. If the patient portal can be driven this way end to end, the mobile app
 * needs no backend; if any step needed something the web computes on the server, it would fail
 * here rather than three months into building an Expo app.
 *
 * It deliberately uses no `page` at all. Playwright is the runner because this suite already has
 * a seeded clinic and a running server; the browser is beside the point.
 */

const api = (): ApiClient =>
  createClient({
    baseUrl: E2E.appUrl,
    // A device's store: nothing but what the sign-in returned.
    tokens: memoryTokenStore(),
    // The whole point is that this works with no ambient browser credentials.
    fetch: (input, init) => fetch(input as string, { ...init, credentials: 'omit' }),
  })

async function signedInPatient() {
  const client = api()
  const auth = authResource(client)
  const session = await auth.signIn({
    email: 'patient@clinic.local',
    password: E2E.password,
    deviceName: 'Pixel 7 (parity suite)',
  })
  return { client, auth, portal: patientPortal(client), session }
}

test.describe('the mobile client, over HTTP with no cookies', () => {
  test('signs in and receives tokens it can store', async () => {
    const { session, client } = await signedInPatient()

    // The device asks for body delivery and gets a pair to keep (§9.1 rule 3).
    expect(session.tokens?.accessToken).toBeTruthy()
    expect(session.tokens?.refreshToken).toBeTruthy()
    expect(session.user.email).toBe('patient@clinic.local')
    // And which record the account is, which every patient screen starts from (ADR-0004).
    expect(session.user.patientId).toBeTruthy()
    expect(session.user.doctorId).toBeNull()

    const stored = await client.tokens.read()
    expect(stored?.accessToken).toBe(session.tokens?.accessToken)
  })

  test('reads the whole patient portal through /api/v1 alone', async () => {
    const { portal, session } = await signedInPatient()

    // Which record am I? The session says so — there is no actor on a device to ask.
    expect(session.user.patientId, 'the session names the record this account is').toBeTruthy()
    const patientId = session.user.patientId!
    const record = await portal.patient(patientId)
    expect(record.id).toBe(patientId)

    // P3 — my appointments, over a window. The diary is read a range at a time.
    const today = new Date().toISOString().slice(0, 10)
    const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const appointments = await portal.appointments({ patientId, from: today, to: inAMonth })
    expect(Array.isArray(appointments)).toBe(true)

    // P7 — my prescriptions.
    const prescriptions = await portal.prescriptions({ patientId })
    expect(Array.isArray(prescriptions)).toBe(true)

    // P8 — my documents.
    const files = await portal.files({ patientId })
    expect(Array.isArray(files)).toBe(true)

    // P9 — what I owe. Money arrives as exact decimal strings, never as floats (money.ts).
    const statement = await portal.statement(patientId)
    expect(statement.outstanding).toMatch(/^-?\d+(\.\d+)?$/)
    expect(statement.currency).toBeTruthy()

    // P12 — my support threads.
    const tickets = await portal.tickets()
    expect(Array.isArray(tickets)).toBe(true)

    // The bell.
    const feed = await portal.notifications({ limit: 20 })
    expect(feed.unreadCount).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(feed.items)).toBe(true)

    // And clearing it, which every bell offers.
    const cleared = await portal.markNotificationsRead()
    expect(cleared.unreadCount).toBe(0)
  })

  test('books and cancels an appointment for itself, idempotently', async () => {
    const { portal, session } = await signedInPatient()
    const patientId = session.user.patientId!

    const doctors = await portal.doctors()
    expect(doctors.length).toBeGreaterThan(0)

    // Find a doctor with an open time in the next fortnight.
    const from = new Date().toISOString().slice(0, 10)
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)

    let chosen: { doctorId: string; startsAt: string } | null = null
    for (const doctor of doctors) {
      const days = await portal.slots(doctor.id, { from, to })
      const day = days.find((entry) => entry.slots.length > 0)
      if (day?.slots[0]) {
        chosen = { doctorId: doctor.id, startsAt: day.slots[0].startsAt }
        break
      }
    }
    expect(chosen, 'the seeded clinic offers at least one open slot').not.toBeNull()

    const key = `parity-${Date.now()}`
    const booking = {
      doctorId: chosen!.doctorId,
      startsAt: chosen!.startsAt,
      reason: 'Booked from the parity suite',
    }
    const booked = await portal.bookForMyself(booking, key)
    expect(booked.status).toBe('SCHEDULED')
    // Booked against this account's own record, without the client naming it: `bookOwnAppointment`
    // resolves the patient from the actor, which is what makes the OWN scope meaningful.
    expect(booked.patient.id).toBe(patientId)

    // The same slot again must not produce a second appointment — the slot is already held, so
    // the server refuses rather than double-booking a patient who tapped twice.
    await expect(portal.bookForMyself(booking, key)).rejects.toMatchObject({
      code: expect.stringMatching(/SLOT_TAKEN|CONFLICT|VALIDATION_FAILED|BOOKING_REFUSED/),
    })

    const cancelled = await portal.cancelAppointment(booked.id, {
      reason: 'Parity suite tidying up',
    })
    expect(cancelled.status).toBe('CANCELLED')
  })

  test('opens a support thread and replies to it', async () => {
    const { portal } = await signedInPatient()
    const subject = `From the phone ${Date.now()}`

    const ticket = await portal.openTicket({
      subject,
      category: 'BILLING',
      priority: 'NORMAL',
      body: 'Asking from a device, over the same API the browser uses.',
      fileIds: [],
      requesterId: null,
    })
    expect(ticket.subject).toBe(subject)

    const replied = await portal.replyToTicket(ticket.id, {
      body: 'And replying to it.',
      isInternal: false,
      fileIds: [],
    })
    expect(replied.messages.length).toBeGreaterThan(1)

    // An internal note is staff-only and must not be offered to a patient's own client (8.12).
    await expect(
      portal.replyToTicket(ticket.id, { body: 'sneaky', isInternal: true, fileIds: [] }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|VALIDATION_FAILED/) })
  })

  test('refuses another patient’s record with the same permission model as the web', async () => {
    const { portal, client } = await signedInPatient()

    // A record this account is not attached to. Scope OWN is enforced in the use case, so the
    // transport makes no difference — which is the property being asserted.
    await expect(portal.patient('not-my-patient-id')).rejects.toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/),
    })

    // And with no token at all, nothing is readable.
    await client.tokens.clear()
    await expect(portal.tickets()).rejects.toMatchObject({ status: 401 })
  })

  test('refreshes an expired access token without the person noticing', async () => {
    const { client, portal, session } = await signedInPatient()
    const before = await client.tokens.read()

    // Force the pre-emptive path: an access token the client believes is spent.
    await client.tokens.write({ ...before!, accessTokenExpiresAt: new Date(0).toISOString() })

    const record = await portal.patient(session.user.patientId!)
    expect(record.id).toBe(session.user.patientId)

    const after = await client.tokens.read()
    expect(after?.accessToken).not.toBe(before?.accessToken)
    // Rotated, which is what makes a stolen refresh token detectable (section 10).
    expect(after?.refreshToken).not.toBe(before?.refreshToken)
  })

  test('signs out, and the tokens stop working', async () => {
    const { client, auth, portal } = await signedInPatient()
    await auth.signOut()

    expect(await client.tokens.read()).toBeNull()
    await expect(portal.tickets()).rejects.toMatchObject({ status: 401 })
  })
})
