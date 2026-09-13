import {
  authResource,
  createClient,
  doctorPortal,
  memoryTokenStore,
  patientPortal,
} from '@clinic/api-client'
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

async function signedInDoctor() {
  const client = api()
  const auth = authResource(client)
  const session = await auth.signIn({
    email: 'doctor@clinic.local',
    password: E2E.password,
    deviceName: 'iPhone 15 (parity suite)',
  })
  return { client, auth, portal: doctorPortal(client), session }
}

/**
 * An appointment with the seeded doctor, booked the way the patient's app books one, so the
 * doctor's app has a visit to record.
 */
async function bookedWithTheDoctor(reason: string) {
  const { portal } = await signedInPatient()
  const doctor = await signedInDoctor()
  const doctorId = doctor.session.user.doctorId!

  const from = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const days = await portal.slots(doctorId, { from, to })
  // The last open slot rather than the first: other journeys book the earliest times, and a
  // collision here would be a flaky test rather than a finding.
  const open = days.flatMap((day) => day.slots)
  const slot = open[open.length - 1]
  expect(slot, 'the seeded doctor has an open slot in the next fortnight').toBeTruthy()

  const booked = await portal.bookForMyself(
    { doctorId, startsAt: slot!.startsAt, reason },
    `parity-doctor-${Date.now()}`,
  )
  return { doctor, appointment: booked, from, to }
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

    // Find a doctor with an open time, starting three days out. The booking is cancelled below, and
    // the clinic refuses a cancellation inside its cutoff (24 hours by default, ADR-0022): searching
    // from today made this test pass or fail by the hour it ran, since tomorrow's first slot is
    // outside the cutoff at dawn and inside it by mid-morning.
    const from = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(Date.now() + 17 * 86_400_000).toISOString().slice(0, 10)

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

  /**
   * Push registration is the one backend addition the phase allows, so it is the one thing this
   * suite most needs to drive over HTTP. It did not, at first — and the POST route turned out never
   * to have been written.
   */
  test('registers this phone for push, recognises it, and detaches it on sign-out', async () => {
    const { portal, auth } = await signedInPatient()
    const pushToken = `ExponentPushToken[parity-${Date.now()}]`
    const registration = {
      token: pushToken,
      platform: 'ios' as const,
      deviceName: 'iPhone 15 (parity suite)',
      appVersion: '1.0.0',
    }

    const device = await portal.registerDevice(registration)
    expect(device.isThisDevice).toBe(true)

    // The app registers on every launch; the second launch is the same device, not another.
    const again = await portal.registerDevice({ ...registration, appVersion: '1.0.1' })
    expect(again.id).toBe(device.id)
    expect(again.appVersion).toBe('1.0.1')

    // Which row is this phone is only knowable by presenting the token, never from the list alone.
    const named = await portal.myDevices(pushToken)
    expect(named.find((entry) => entry.id === device.id)?.isThisDevice).toBe(true)
    const anonymous = await portal.myDevices()
    expect(anonymous.find((entry) => entry.id === device.id)?.isThisDevice).toBe(false)

    // Signing out stops the phone receiving this person's notifications, in the same request.
    await auth.signOut({ pushToken })
    const back = await signedInPatient()
    expect((await back.portal.myDevices()).some((entry) => entry.id === device.id)).toBe(false)
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

  test('signs out, and the session ends on the server rather than only on the phone', async () => {
    const { client, auth, portal } = await signedInPatient()
    const held = (await client.tokens.read())!
    await auth.signOut()

    expect(await client.tokens.read()).toBeNull()
    await expect(portal.tickets()).rejects.toMatchObject({ status: 401 })

    // The local check above passes whatever the server did, because the tokens are simply gone.
    // What matters is that a copy of them — a backup, a stolen keychain — is now worthless.
    const copy = api()
    await copy.tokens.write(held)
    expect((await copy.refreshSession()).outcome).toBe('rejected')
  })

  /**
   * The case a phone actually hits. An access token lives fifteen minutes; somebody who opens
   * the app after lunch and taps "sign out" is holding a lapsed one. The server cannot read a
   * session from it, so unless the client sends the refresh token the session outlives the
   * sign-out by thirty days.
   */
  test('signs out on the server even when the access token has lapsed', async () => {
    const { client, auth } = await signedInPatient()
    const held = (await client.tokens.read())!

    // A token the server will not accept, standing in for one that expired in a pocket.
    await client.tokens.write({ ...held, accessToken: 'lapsed-after-fifteen-minutes' })
    await auth.signOut()

    const copy = api()
    await copy.tokens.write(held)
    expect((await copy.refreshSession()).outcome).toBe('rejected')
  })
})

/**
 * The second half of the exit criterion: *"then the doctor portal (my day, chart read, note
 * capture)"*.
 *
 * This half is the stronger test. The web's doctor pages are server components that call the use
 * cases directly, so nothing in the browser ever exercised these endpoints as a whole — a gap here
 * would have been invisible until a phone needed it.
 */
test.describe('the doctor’s client, over HTTP with no cookies', () => {
  test('signs in as a doctor and is told which doctor', async () => {
    const { session } = await signedInDoctor()

    expect(session.tokens?.accessToken).toBeTruthy()
    expect(session.user.portals).toContain('doctor')
    // The doctor's own diary and notes hang off this id (ADR-0004), as a patient's hang off theirs.
    expect(session.user.doctorId).toBeTruthy()
    expect(session.user.patientId).toBeNull()
  })

  test('reads the day, opens a visit, writes and signs the note, and adds an addendum', async () => {
    const { doctor, appointment, from, to } = await bookedWithTheDoctor('Parity: note capture')
    const { portal, session } = doctor

    // My day — the appointments in a window, scoped by the server to this doctor's diary.
    const day = await portal.appointments({ from, to })
    const listed = day.find((entry) => entry.id === appointment.id)
    expect(listed, 'the doctor sees the appointment booked with them').toBeTruthy()
    expect(day.every((entry) => entry.doctor.id === session.user.doctorId)).toBe(true)

    // Which appointments already have a visit — how the day decides "open note" or "start".
    const before = await portal.encounters({ from, to })
    expect(before.some((encounter) => encounter.appointmentId === appointment.id)).toBe(false)

    const opened = await portal.openEncounter({
      patientId: appointment.patient.id,
      appointmentId: appointment.id,
      encounterType: 'CONSULTATION',
      chiefComplaint: 'Parity: note capture',
    })
    expect(opened.note.status).toBe('DRAFT')
    expect(opened.appointmentId).toBe(appointment.id)

    // A second tap on "start visit" — a retry on a weak connection — must not open a second
    // visit. The refusal is what lets the app go and find the one that exists.
    await expect(
      portal.openEncounter({
        patientId: appointment.patient.id,
        appointmentId: appointment.id,
        encounterType: 'CONSULTATION',
        chiefComplaint: null,
      }),
    ).rejects.toMatchObject({ code: 'ENCOUNTER_EXISTS' })
    const after = await portal.encounters({ from, to })
    expect(after.filter((encounter) => encounter.appointmentId === appointment.id)).toHaveLength(1)

    // Note capture. Sections are written in the order a doctor thinks, not all at once.
    const drafted = await portal.updateEncounter(opened.id, {
      note: { subjective: 'Sore throat for three days.', plan: 'Fluids and rest.' },
    })
    expect(drafted.note.subjective).toBe('Sore throat for three days.')
    const shared = await portal.updateEncounter(opened.id, {
      note: { assessment: 'Viral pharyngitis.' },
      isNoteVisibleToPatient: true,
    })
    // A partial update leaves the other sections alone.
    expect(shared.note.subjective).toBe('Sore throat for three days.')
    expect(shared.note.assessment).toBe('Viral pharyngitis.')
    expect(shared.note.isPatientVisible).toBe(true)

    const signed = await portal.signNote(opened.id, { signature: session.user.displayName })
    expect(signed.note.status).toBe('SIGNED')
    expect(signed.note.signedAt).toBeTruthy()

    // Signed means frozen, over this transport exactly as over the browser's (ADR-0024).
    await expect(
      portal.updateEncounter(opened.id, { note: { plan: 'Changed my mind.' } }),
    ).rejects.toMatchObject({ code: expect.any(String) })
    const reread = await portal.encounter(opened.id)
    expect(reread.note.plan).toBe('Fluids and rest.')

    const amended = await portal.addAddendum(opened.id, { body: 'Advised to return if fever.' })
    expect(amended.note.addenda.map((addendum) => addendum.body)).toContain(
      'Advised to return if fever.',
    )

    const completed = await portal.completeEncounter(opened.id)
    expect(completed.status).toBe('COMPLETED')
  })

  test('reads the chart: the record, its banner, its visits, prescriptions and documents', async () => {
    const { doctor, appointment } = await bookedWithTheDoctor('Parity: chart read')
    const { portal } = doctor

    await portal.openEncounter({
      patientId: appointment.patient.id,
      appointmentId: appointment.id,
      encounterType: 'FOLLOW_UP',
      chiefComplaint: 'Parity: chart read',
    })

    // The caseload — summaries, which is what the endpoint returns. This is the call that failed
    // contract validation before the client was corrected.
    const caseload = await portal.patientsITreat()
    const mine = caseload.find((patient) => patient.id === appointment.patient.id)
    expect(mine, 'a patient the doctor has seen is on their list').toBeTruthy()

    const chart = await portal.patient(appointment.patient.id)
    expect(chart.medicalRecordNo).toBe(appointment.patient.medicalRecordNo)
    // The banner is embedded, never a second request — it is the part that prevents harm.
    expect(Array.isArray(chart.allergies)).toBe(true)
    expect(Array.isArray(chart.chronicConditions)).toBe(true)

    const visits = await portal.encounters({ patientId: chart.id })
    expect(visits.length).toBeGreaterThan(0)
    expect(visits.every((visit) => visit.patient.id === chart.id)).toBe(true)

    expect(Array.isArray(await portal.prescriptions({ patientId: chart.id }))).toBe(true)
    expect(Array.isArray(await portal.files({ patientId: chart.id }))).toBe(true)
  })

  test('refuses a note written by anyone but the doctor, whatever the transport', async () => {
    const { doctor, appointment } = await bookedWithTheDoctor('Parity: scope')
    const opened = await doctor.portal.openEncounter({
      patientId: appointment.patient.id,
      appointmentId: appointment.id,
      encounterType: 'CONSULTATION',
      chiefComplaint: null,
    })

    // The patient reads their own visits and writes none of them.
    const { client } = await signedInPatient()
    const asPatient = doctorPortal(client)
    await expect(
      asPatient.updateEncounter(opened.id, { note: { plan: 'Written by the patient' } }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) })
  })
})
