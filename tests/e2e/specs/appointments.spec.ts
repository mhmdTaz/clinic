import type { Locator, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { clinicMinutesOfDay, clinicToday, weekdayOfDate, workingDate } from '../helpers/calendar'
import { countAppointmentsAt, seededDoctorId, seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/** The doctor's open times — named by the clock, so they are found by role, not by text. */
function openTimes(within: Page | Locator): Locator {
  return within.getByRole('group', { name: 'Open times' }).getByRole('button')
}

test.describe('scheduling', () => {
  test('the front desk books a patient in, moves the appointment, then cancels it', async ({
    page,
  }) => {
    await signIn(page, 'staff@clinic.local', E2E.password)
    const date = workingDate(3)
    await page.goto(`/staff/appointments?date=${date}`)

    await page.getByRole('button', { name: 'Book an appointment' }).first().click()
    const booking = page.getByRole('dialog')
    await booking.getByLabel('Patient').fill('Fakhoury')
    await booking.getByRole('button', { name: /Omar Fakhoury/ }).click()

    // One seeded doctor, already chosen; the day follows the calendar behind the dialog.
    const first = await openTimes(booking).first().textContent()
    await openTimes(booking).first().click()
    await booking.getByLabel('Reason for the visit').fill('Persistent cough')
    await booking.getByRole('button', { name: 'Book', exact: true }).click()
    await expect(booking).toBeHidden()

    const card = page.getByRole('article').filter({ hasText: 'Omar Fakhoury' })
    await expect(card).toContainText('Persistent cough')
    await expect(card).toContainText(first ?? '')
    await expect(card).toContainText('Scheduled')

    // Moving it keeps the appointment and gives the old time back.
    await card.getByRole('button', { name: 'Reschedule' }).click()
    const move = page.getByRole('dialog')
    await expect(openTimes(move).first()).toBeVisible()
    const second = await openTimes(move).first().textContent()
    await openTimes(move).first().click()
    await move.getByRole('button', { name: 'Move the appointment' }).click()
    await expect(move).toBeHidden()

    await expect(card).toContainText(second ?? '')
    expect(second).not.toBe(first)

    // Cancelling frees the time and says who asked.
    await card.getByRole('button', { name: 'Cancel', exact: true }).click()
    const confirm = page.getByRole('dialog')
    await confirm.getByLabel(/Reason/).fill('Patient called to cancel')
    await confirm.getByRole('button', { name: 'Cancel the appointment' }).click()
    await expect(confirm).toBeHidden()
    await expect(card).toContainText('Cancelled')

    // The released time is offered again.
    await page.getByRole('button', { name: 'Book an appointment' }).first().click()
    const reopened = page.getByRole('dialog')
    await expect(openTimes(reopened).filter({ hasText: second ?? '' })).toHaveCount(1)
  })

  test('a patient books a time for themselves from their own portal', async ({ page }) => {
    await signIn(page, 'patient@clinic.local', E2E.password)
    await page.goto('/patient/appointments')
    await page.getByRole('link', { name: 'Book an appointment' }).first().click()

    await expect(page.getByRole('heading', { name: 'Book an appointment' })).toBeVisible()
    const chosen = await openTimes(page).first().textContent()
    await openTimes(page).first().click()
    await page.getByLabel(/What is it about/).fill('Follow-up on test results')
    await page.getByRole('button', { name: 'Confirm the booking' }).click()

    await expect(page).toHaveURL(/\/patient\/appointments$/)
    const card = page.getByRole('article').filter({ hasText: chosen ?? '' })
    await expect(card).toContainText('Follow-up on test results')
    await expect(card).toContainText('Scheduled')
    // Theirs to move or give up — never to mark as attended (ADR-0022).
    await expect(card.getByRole('button', { name: 'Reschedule' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Check in' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Complete' })).toHaveCount(0)
  })

  test('a walk-in is given the next open time and appears in the waiting room', async ({
    page,
  }) => {
    // A walk-in is always today and always "from now", so the clinic's day has to have time
    // left in it. Rather than depend on the hour CI happens to run, the doctor is opened for
    // the whole of today first — and the last half hour is skipped, not hoped through.
    test.skip(clinicMinutesOfDay() > 23 * 60 + 30, 'the clinic day has no time left for a walk-in')

    await signIn(page, 'staff@clinic.local', E2E.password)
    const doctorId = await seededDoctorId()
    const today = clinicToday()

    await page.goto('/staff/appointments')
    await page.evaluate(
      async ({ doctorId, dayOfWeek }) => {
        const read = await fetch(`/api/v1/doctors/${doctorId}/availability`, {
          credentials: 'same-origin',
        })
        const { data } = (await read.json()) as {
          data: {
            slotMinutes: number
            blocks: Array<{ dayOfWeek: number; startsAt: string; endsAt: string }>
          }
        }
        await fetch(`/api/v1/doctors/${doctorId}/availability`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            slotMinutes: data.slotMinutes,
            blocks: [
              ...data.blocks.filter((block) => block.dayOfWeek !== dayOfWeek),
              { dayOfWeek, startsAt: '00:00', endsAt: '23:59' },
            ],
          }),
        })
      },
      { doctorId, dayOfWeek: weekdayOfDate(today) },
    )

    // Deliberately looking at another day: a walk-in belongs to today regardless.
    await page.goto(`/staff/appointments?date=${workingDate(5)}`)
    await page.getByRole('button', { name: 'Walk-in', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Patient').fill('Haddad')
    await dialog.getByRole('button', { name: /Rana Haddad/ }).click()
    await dialog.getByLabel(/What have they come in for/).fill('Twisted her ankle')
    await dialog.getByRole('button', { name: 'Register and check in' }).click()

    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`date=${today}`))
    await expect(page.getByRole('heading', { name: 'Waiting room' })).toBeVisible()

    const waiting = page.getByRole('article').filter({ hasText: 'Rana Haddad' }).first()
    await expect(waiting).toContainText('Walk-in')
    await expect(waiting).toContainText('Checked in')
    await expect(waiting).toContainText('Twisted her ankle')
    // Already arrived, so the next step is the doctor taking them in.
    await expect(waiting.getByRole('button', { name: 'Start visit' })).toBeVisible()
    await expect(waiting.getByRole('button', { name: 'Check in' })).toHaveCount(0)
  })

  test('two bookings for one slot leave exactly one appointment and one clean refusal', async ({
    browser,
  }) => {
    const [deskOne, deskTwo] = await Promise.all([newPersonPage(browser), newPersonPage(browser)])
    await signIn(deskOne, 'staff@clinic.local', E2E.password)
    await signIn(deskTwo, 'staff@clinic.local', E2E.password)

    const date = workingDate(10)
    const doctorId = await seededDoctorId()
    const [first, second] = await Promise.all([
      seededPatientId('Nassar'),
      seededPatientId('Haddad'),
    ])

    const startsAt = await deskOne.evaluate(
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

    const book = (page: Page, patientId: string) =>
      page.evaluate(
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
              reason: null,
              internalNote: null,
            }),
          })
          const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } }
          return { status: response.status, code: body.error?.code ?? null }
        },
        { patientId, doctorId, startsAt },
      )

    // Both desks press Book on the same slot at the same moment.
    const [one, two] = await Promise.all([book(deskOne, first), book(deskTwo, second)])

    expect([one.status, two.status].sort()).toEqual([201, 409])
    expect([one.code, two.code]).toContain('SLOT_TAKEN')
    // Not "the loser saw an error" — the database holds one appointment for that time.
    expect(await countAppointmentsAt(doctorId, startsAt)).toBe(1)

    await Promise.all([deskOne.context().close(), deskTwo.context().close()])
  })
})
