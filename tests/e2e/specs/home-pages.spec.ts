import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { workingDate } from '../helpers/calendar'
import { seededDoctorId, seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Audit F08: each home page showed the clinic's address and opening hours and nothing a person
 * came to do. Each now leads with that role's next step — and only with what that role may see.
 */

async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, email, E2E.password)
  return page
}

test.describe('home pages lead with the next thing to do', () => {
  test('a patient sees the appointment they booked, and nothing of the clinic’s', async ({
    browser,
  }) => {
    const page = await signedInAs(browser, 'patient@clinic.local')
    await page.goto('/patient/appointments')
    const doctorId = await seededDoctorId()
    const date = workingDate(20)

    const booked = await page.evaluate(
      async ({ doctorId, date }) => {
        const slots = await fetch(`/api/v1/doctors/${doctorId}/slots?from=${date}&to=${date}`, {
          credentials: 'same-origin',
        })
        const days = (await slots.json()) as { data: Array<{ slots: Array<{ startsAt: string }> }> }
        const startsAt = days.data[0]?.slots.at(-1)?.startsAt ?? ''
        const response = await fetch('/api/v1/me/appointments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ doctorId, startsAt, reason: 'Home page check' }),
        })
        const body = (await response.json()) as { data?: { id: string } }
        return { status: response.status, id: body.data?.id ?? '' }
      },
      { doctorId, date },
    )
    expect(booked.status).toBe(201)

    await page.goto('/patient')
    const next = page.getByRole('main')
    await expect(next.getByRole('heading', { name: 'Your next appointment' })).toBeVisible()
    await expect(next.getByText(/Nabil Saad/).first()).toBeVisible()
    // Before the cutoff it says until when; inside it, how to change it instead (F06). Which one
    // depends on what else this run has booked for the patient, so either is right here.
    await expect(next.getByText(/online until|Changes online closed/)).toBeVisible()
    await expect(next.getByRole('link', { name: 'Book an appointment' })).toBeVisible()
    await expect(next.getByRole('heading', { name: 'Bills to pay' })).toBeVisible()

    // Clinic work is not on a patient's home page.
    await expect(next.getByText('Notes to sign')).toHaveCount(0)
    await expect(next.getByText('Today at the clinic')).toHaveCount(0)

    // Leave the diary as it was found.
    const cancelled = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/appointments/${id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'Test clean-up' }),
      })
      return response.status
    }, booked.id)
    expect(cancelled).toBe(200)
    await page.context().close()
  })

  test('a doctor sees their day and the notes still waiting for a signature', async ({
    browser,
  }) => {
    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto('/doctor/patients')
    const patientId = await seededPatientId('Haddad')
    const opened = await page.evaluate(async (patientId) => {
      const response = await fetch('/api/v1/encounters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          patientId,
          appointmentId: null,
          encounterType: 'CONSULTATION',
          chiefComplaint: 'Unsigned on purpose',
        }),
      })
      const body = (await response.json()) as { data: { id: string; number: string } }
      return body.data
    }, patientId)

    await page.goto('/doctor')
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { name: 'Your day' })).toBeVisible()
    await expect(main.getByRole('heading', { name: 'Notes to sign' })).toBeVisible()
    const row = main.getByRole('listitem').filter({ hasText: opened.number })
    await expect(row).toBeVisible()
    await row.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/doctor/encounters/${opened.id}$`))
    await expect(main.getByText('Today at the clinic')).toHaveCount(0)
    await page.context().close()
  })

  test('the front desk sees today’s queue and its shortcuts', async ({ browser }) => {
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto('/staff')
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { name: 'Today at the clinic' })).toBeVisible()
    for (const label of ['Expected', 'Checked in', 'With a doctor', 'Seen']) {
      await expect(main.getByRole('term').filter({ hasText: label })).toBeVisible()
    }
    await main.getByRole('link', { name: 'Register a patient' }).click()
    await expect(page).toHaveURL(/\/staff\/patients\/new$/)
    await page.context().close()
  })
})
