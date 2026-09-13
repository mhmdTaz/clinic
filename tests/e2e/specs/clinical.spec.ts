import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { workingDate } from '../helpers/calendar'
import {
  countAuditEntries,
  findAuditEntry,
  seededDoctorId,
  seededPatientId,
} from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * One browser per person, rather than one browser signing in and out. A signed-in visitor who
 * opens /login is sent to their own portal — correct behaviour, and it means role-switching in a
 * single context never reaches the sign-in form at all.
 */
async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, email, E2E.password)
  return page
}

/**
 * Phase 4's exit criteria, end to end: a doctor completes and signs an encounter; the note becomes
 * immutable; the patient sees exactly what was flagged visible and nothing else; every PHI read
 * appears in the audit log.
 */

/** Books an appointment for the seeded patient so the doctor has a visit to record. */
async function bookForSeededPatient(page: Page, date: string): Promise<string> {
  const doctorId = await seededDoctorId()
  const patientId = await seededPatientId('Karam')

  const startsAt = await page.evaluate(
    async ({ doctorId, date }) => {
      const response = await fetch(`/api/v1/doctors/${doctorId}/slots?from=${date}&to=${date}`, {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as {
        data: Array<{ slots: Array<{ startsAt: string }> }>
      }
      return body.data[0]?.slots[0]?.startsAt ?? ''
    },
    { doctorId, date },
  )
  expect(startsAt).not.toBe('')

  const booked = await page.evaluate(
    async ({ patientId, doctorId, startsAt }) => {
      const response = await fetch('/api/v1/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          patientId,
          doctorId,
          startsAt,
          branchId: null,
          reason: 'Sore throat',
          internalNote: null,
        }),
      })
      const body = (await response.json()) as { data?: { id: string } }
      return { status: response.status, id: body.data?.id ?? '' }
    },
    { patientId, doctorId, startsAt },
  )
  expect(booked.status).toBe(201)
  return booked.id
}

test.describe('the clinical record', () => {
  test('a doctor records a visit, signs the note, and can then only add to it', async ({
    browser,
  }) => {
    const date = workingDate(14)

    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/staff/appointments')
    await bookForSeededPatient(desk, date)
    await desk.context().close()

    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto(`/doctor/appointments?date=${date}`)
    await page.getByRole('button', { name: 'Record the visit' }).click()

    // Straight into the workspace, on a visit that is open with a draft note.
    await expect(page).toHaveURL(/\/doctor\/encounters\//)
    await expect(page.getByText('Note in progress')).toBeVisible()

    await page.getByLabel('Subjective').fill('Sore throat and fever for three days.')
    await page.getByLabel('Objective').fill('Temperature 38.1. Pharynx red, no exudate.')
    await page.getByLabel('Assessment').fill('Viral pharyngitis.')
    await page.getByLabel('Plan').fill('Fluids and paracetamol. Review in five days.')
    await page.getByLabel(/Share this note with the patient/).check()
    await page.getByRole('button', { name: 'Save the note' }).click()
    await expect(page.getByText('Note saved.')).toBeVisible()

    // Coded, because a diagnosis is what the visit is answerable by later.
    await page.getByRole('button', { name: 'Add a diagnosis' }).click()
    await page.getByRole('textbox', { name: 'Code' }).fill('J06.9')
    await page.getByRole('textbox', { name: 'Diagnosis' }).fill('Acute upper respiratory infection')
    await page.getByRole('button', { name: 'Save diagnoses' }).click()
    await expect(page.getByText('Diagnoses saved.')).toBeVisible()

    // Signing.
    await page.getByRole('button', { name: 'Sign the note' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/cannot be changed by anyone/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Sign the note' }).click()
    await expect(dialog).toBeHidden()

    // The editor is gone — not disabled, gone — and the note reads as a record.
    await expect(page.getByText('Note signed')).toBeVisible()
    await expect(page.getByText(/can no longer be changed/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save the note' })).toHaveCount(0)
    await expect(page.getByLabel('Subjective')).toHaveCount(0)

    // The only thing left is to add to it.
    await page.getByLabel('Add an addendum').fill('Swab negative for streptococcus.')
    await page.getByRole('button', { name: 'Add the addendum' }).click()
    await expect(page.getByText('Swab negative for streptococcus.')).toBeVisible()

    // And the server refuses a direct attempt to rewrite it, not merely the screen.
    const refused = await page.evaluate(async () => {
      const id = window.location.pathname.split('/').pop()
      const response = await fetch(`/api/v1/encounters/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ note: { assessment: 'Bacterial pharyngitis.' } }),
      })
      const body = (await response.json()) as { error?: { code?: string } }
      return { status: response.status, code: body.error?.code }
    })
    expect(refused).toMatchObject({ status: 422, code: 'NOTE_ALREADY_SIGNED' })
    await page.context().close()
  })

  test('the patient sees what was shared, and the visit itself either way', async ({ browser }) => {
    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/patient/records')

    const visit = patient.getByRole('listitem').filter({ hasText: 'Nabil Saad' }).first()
    await expect(visit).toContainText('J06.9')
    await visit.getByRole('link').first().click()

    // Shared and signed: the words are there.
    await expect(patient.getByText('Viral pharyngitis.')).toBeVisible()
    await expect(patient.getByText('Acute upper respiratory infection')).toBeVisible()

    // The doctor stops sharing it.
    const doctor = await signedInAs(browser, 'doctor@clinic.local')
    await doctor.goto('/doctor/appointments')
    const encounterId = await doctor.evaluate(async () => {
      const response = await fetch('/api/v1/encounters', { credentials: 'same-origin' })
      const body = (await response.json()) as { data: Array<{ id: string }> }
      return body.data[0]?.id ?? ''
    })
    await doctor.evaluate(async (id) => {
      await fetch(`/api/v1/encounters/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ isNoteVisibleToPatient: false }),
      })
    }, encounterId)

    // The patient keeps the visit and the diagnosis, and loses the words — with a reason given.
    await patient.goto(`/patient/records/${encounterId}`)
    await expect(patient.getByText(/has not shared the notes/)).toBeVisible()
    await expect(patient.getByText('Viral pharyngitis.')).toHaveCount(0)
    await expect(patient.getByText('Acute upper respiratory infection')).toBeVisible()

    await Promise.all([patient.context().close(), doctor.context().close()])
  })

  test('a prescription prints, and lands in the patient’s own documents', async ({ browser }) => {
    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto('/doctor/appointments')
    const encounterId = await page.evaluate(async () => {
      const response = await fetch('/api/v1/encounters', { credentials: 'same-origin' })
      const body = (await response.json()) as { data: Array<{ id: string }> }
      return body.data[0]?.id ?? ''
    })

    await page.goto(`/doctor/encounters/${encounterId}`)
    await page.getByRole('button', { name: 'Write a prescription' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Medication', exact: true }).fill('Paracetamol')
    await dialog.getByRole('textbox', { name: 'Strength' }).fill('500 mg')
    await dialog.getByRole('textbox', { name: 'Dose' }).fill('One tablet')
    await dialog.getByRole('textbox', { name: 'How often' }).fill('Up to four times a day')
    await dialog.getByRole('button', { name: 'Issue the prescription' }).click()
    await expect(dialog).toBeHidden()
    // Named precisely: the note's plan also mentions paracetamol, in a sentence.
    await expect(page.getByText('Paracetamol · 500 mg').first()).toBeVisible()

    /**
     * From here the prescription is followed by its own number rather than by its drug. A retry
     * of this test issues a second prescription, and "the one with paracetamol on it" then means
     * two things — which is how a green suite turns red on the retry rather than on the bug.
     */
    const issued = await page.evaluate(async (encounterId) => {
      const response = await fetch(`/api/v1/encounters/${encounterId}/prescriptions`, {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as { data: Array<{ id: string; number: string }> }
      return body.data[0] ?? { id: '', number: '' }
    }, encounterId)
    expect(issued.number).toMatch(/^RX-\d{6}$/)

    await page.context().close()

    // The patient can print it, and it is rendered once and stored (ADR-0026).
    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/patient/prescriptions')
    await expect(patient.getByText(issued.number)).toBeVisible()

    const pdf = await patient.evaluate(async (prescriptionId) => {
      const link = await fetch(`/api/v1/prescriptions/${prescriptionId}/pdf`, {
        credentials: 'same-origin',
      })
      const { data } = (await link.json()) as { data: { url: string; fileName: string } }
      // Straight to object storage: the bytes never pass through the application (12.1).
      const file = await fetch(data.url)
      const bytes = new Uint8Array(await file.arrayBuffer())
      return {
        fileName: data.fileName,
        status: file.status,
        header: new TextDecoder().decode(bytes.slice(0, 5)),
      }
    }, issued.id)
    expect(pdf.status).toBe(200)
    expect(pdf.header).toBe('%PDF-')
    expect(pdf.fileName).toBe(`${issued.number}.pdf`)

    await patient.goto('/patient/documents')
    await expect(patient.getByText(pdf.fileName)).toBeVisible()
    await patient.context().close()
  })

  test('every read of a chart is on the record, and a refusal is too', async ({ browser }) => {
    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto('/doctor/appointments')
    const encounterId = await page.evaluate(async () => {
      const response = await fetch('/api/v1/encounters', { credentials: 'same-origin' })
      const body = (await response.json()) as { data: Array<{ id: string }> }
      return body.data[0]?.id ?? ''
    })

    const before = await countAuditEntries({ action: 'encounter.viewed', 'entity.id': encounterId })
    await page.goto(`/doctor/encounters/${encounterId}`)
    await expect(page.getByText('Note signed')).toBeVisible()

    const read = await findAuditEntry({ action: 'encounter.viewed', 'entity.id': encounterId })
    expect(read).not.toBeNull()
    expect(read?.category).toBe('CLINICAL')
    expect(
      await countAuditEntries({ action: 'encounter.viewed', 'entity.id': encounterId }),
    ).toBeGreaterThan(before)

    await page.context().close()

    // A visit that is not theirs answers the same way as one that does not exist (section 13.2).
    const patient = await signedInAs(browser, 'patient@clinic.local')
    // Land somewhere first: signing in is answered before the portal has finished loading, and
    // an evaluate against a page mid-navigation loses its execution context.
    await patient.goto('/patient/records')
    const status = await patient.evaluate(async () => {
      const response = await fetch('/api/v1/encounters/not-an-encounter-of-mine', {
        credentials: 'same-origin',
      })
      return response.status
    })
    expect(status).toBe(404)
    await patient.context().close()
  })

  /**
   * The encounter list filters by the day a visit *started*. A visit opened before its appointment
   * day — the evening before, say — used to be missed by the agenda, which then offered "Record the
   * visit" for an appointment whose note already existed, and the server refused the click. Found
   * by the mobile app in Phase 9.
   *
   * Last in this block on purpose: it adds a newer visit for the seeded patient, and the journeys
   * above read "the newest visit" as the one the first journey recorded.
   */
  test('a visit opened before its appointment day still shows as that appointment’s note', async ({
    browser,
  }) => {
    const date = workingDate(1)

    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/staff/appointments')
    const appointmentId = await bookForSeededPatient(desk, date)
    await desk.context().close()

    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto('/doctor')
    const patientId = await seededPatientId('Karam')
    // Opened today, ahead of the appointment's own day.
    const opened = await page.evaluate(
      async ({ patientId, appointmentId }) => {
        const response = await fetch('/api/v1/encounters', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            patientId,
            appointmentId,
            encounterType: 'CONSULTATION',
            chiefComplaint: 'Opened ahead of the day',
          }),
        })
        return response.status
      },
      { patientId, appointmentId },
    )
    expect(opened).toBe(201)

    await page.goto(`/doctor/appointments?date=${date}`)
    const card = page.getByRole('article').filter({ hasText: 'Sore throat' })
    await expect(card.getByRole('link', { name: 'Open the note' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Record the visit' })).toHaveCount(0)
    await page.context().close()
  })
})
