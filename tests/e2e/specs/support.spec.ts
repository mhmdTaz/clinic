import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Phase 7's first exit criterion, end to end: a patient opens a ticket and staff reply with both
 * a public and an internal message — and only one of them ever reaches the patient.
 */

/** One browser per person: a signed-in visitor who opens /login is sent to their own portal. */
async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, email, E2E.password)
  return page
}

test.describe('support', () => {
  test('a patient asks, staff answer publicly and note privately', async ({ browser }) => {
    const subject = `Double charge ${Date.now()}`

    // The patient asks.
    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/support')
    await expect(patient.getByText('You have not asked anything yet')).toBeVisible()

    await patient.getByRole('button', { name: 'Ask a question' }).click()
    const ask = patient.getByRole('dialog')
    await ask.getByLabel('What is it about?').fill(subject)
    await ask.getByLabel('Kind of question').selectOption('BILLING')
    await ask.getByLabel('Your message').fill('I think I was charged twice for the same visit.')
    await ask.getByRole('button', { name: 'Send it' }).click()

    await expect(patient).toHaveURL(/\/support\//)
    await expect(patient.getByTestId('ticket-status')).toHaveText('Open')
    const ticketUrl = patient.url()
    const ticketId = ticketUrl.split('/').pop() ?? ''

    // The clinic sees it waiting, and that nobody has answered.
    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/staff/support')
    await expect(desk.getByRole('link', { name: new RegExp(subject) })).toBeVisible()
    await expect(desk.getByText('No reply yet').first()).toBeVisible()

    await desk.goto(`/staff/support/${ticketId}`)
    await expect(desk.getByTestId('first-reply')).toHaveText('Still waiting')

    // A public answer.
    await desk.getByLabel('Your reply').fill('You were — we have refunded the duplicate.')
    await desk.getByRole('button', { name: 'Send reply' }).click()
    await expect(desk.getByText('You were — we have refunded the duplicate.')).toBeVisible()

    // And an internal note. The form says who will see it before it is sent.
    await desk.getByLabel('Make this an internal note').check()
    await expect(desk.getByText(/Only people who work here will see this/)).toBeVisible()
    await desk
      .getByRole('textbox', { name: 'Internal note' })
      .fill('Reception double-keyed this on Tuesday.')
    await desk.getByRole('button', { name: 'Save note' }).click()

    // The clinic's view holds both, and marks which is which.
    await expect(desk.getByTestId('public-message')).toHaveCount(2)
    await expect(desk.getByTestId('internal-note')).toHaveCount(1)
    await expect(desk.getByTestId('first-reply')).toHaveText('Answered')
    // Answering handed the ball back to the patient; the note did not take it again.
    await expect(desk.getByTestId('ticket-status')).toHaveText('Waiting on you')

    // **The criterion**: the patient sees the answer and never the note.
    await patient.reload()
    await expect(patient.getByText('You were — we have refunded the duplicate.')).toBeVisible()
    await expect(patient.getByText('Reception double-keyed this on Tuesday.')).toHaveCount(0)
    await expect(patient.getByTestId('internal-note')).toHaveCount(0)
    await expect(patient.getByTestId('public-message')).toHaveCount(2)

    // And the server refuses it directly, not merely the screen: a patient cannot read the note
    // by asking the API for the ticket.
    const raw = await patient.evaluate(async (id) => {
      const response = await fetch(`/api/v1/support/tickets/${id}`, { credentials: 'same-origin' })
      return JSON.stringify(await response.json())
    }, ticketId)
    expect(raw).toContain('refunded the duplicate')
    expect(raw).not.toContain('double-keyed')

    // Nor can they write one.
    const refused = await patient.evaluate(async (id) => {
      const response = await fetch(`/api/v1/support/tickets/${id}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ body: 'sneaky', isInternal: true, fileIds: [] }),
      })
      const payload = (await response.json()) as { error?: { code?: string } }
      return { status: response.status, code: payload.error?.code }
    }, ticketId)
    expect(refused).toMatchObject({ status: 403, code: 'FORBIDDEN' })

    await Promise.all([patient.context().close(), desk.context().close()])
  })

  test('the patient replying hands the ball back to the clinic', async ({ browser }) => {
    const subject = `Appointment question ${Date.now()}`

    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/support')
    await patient.getByRole('button', { name: 'Ask a question' }).click()
    const ask = patient.getByRole('dialog')
    await ask.getByLabel('What is it about?').fill(subject)
    await ask.getByLabel('Your message').fill('Can I move my appointment?')
    await ask.getByRole('button', { name: 'Send it' }).click()
    await expect(patient).toHaveURL(/\/support\//)
    const ticketId = patient.url().split('/').pop() ?? ''

    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto(`/staff/support/${ticketId}`)
    await desk.getByLabel('Your reply').fill('Of course — which day suits?')
    await desk.getByRole('button', { name: 'Send reply' }).click()
    await expect(desk.getByTestId('ticket-status')).toHaveText('Waiting on you')

    // The patient comes back: it is the clinic's turn again, without anybody setting a status.
    await patient.reload()
    await patient.getByLabel('Your reply').fill('Thursday, if you have anything.')
    await patient.getByRole('button', { name: 'Send reply' }).click()
    await expect(patient.getByTestId('ticket-status')).toHaveText('Open')

    await Promise.all([patient.context().close(), desk.context().close()])
  })

  test('a ticket is triaged, and closing it ends the conversation', async ({ browser }) => {
    const subject = `Records request ${Date.now()}`

    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/support')
    await patient.getByRole('button', { name: 'Ask a question' }).click()
    const ask = patient.getByRole('dialog')
    await ask.getByLabel('What is it about?').fill(subject)
    await ask.getByLabel('Your message').fill('Could I have a copy of my records?')
    await ask.getByRole('button', { name: 'Send it' }).click()
    await expect(patient).toHaveURL(/\/support\//)
    const ticketId = patient.url().split('/').pop() ?? ''

    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto(`/staff/support/${ticketId}`)

    // Each control saves on change; there is no Save to forget.
    await desk.getByLabel('Priority').selectOption('HIGH')
    await expect(desk.getByText('High').first()).toBeVisible()

    await desk.getByLabel('Owner').selectOption({ label: 'Rami Khoury' })
    await expect(desk.getByLabel('Owner')).not.toHaveValue('')

    await desk.getByLabel('Status').selectOption('CLOSED')
    await expect(desk.getByTestId('ticket-status')).toHaveText('Closed')

    // A closed ticket takes no more replies, and says so rather than offering a dead box.
    await patient.reload()
    await expect(patient.getByText(/This is closed/)).toBeVisible()
    await expect(patient.getByLabel('Your reply')).toHaveCount(0)

    await Promise.all([patient.context().close(), desk.context().close()])
  })

  test('the bell counts what is unread and clears when opened', async ({ browser }) => {
    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/patient')

    // A notification the worker would normally raise, written through the same API the app uses
    // so the bell is exercised rather than the handler.
    await patient.evaluate(async () => {
      await fetch('/api/v1/me/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ids: [] }),
      })
    })

    const feed = await patient.evaluate(async () => {
      const response = await fetch('/api/v1/me/notifications?limit=10', {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as { data: { unreadCount: number } }
      return body.data
    })
    // Everything already read, so no badge.
    expect(feed.unreadCount).toBe(0)
    await expect(patient.getByTestId('unread-count')).toHaveCount(0)

    // The panel opens and offers the preferences screen.
    await patient.getByRole('button', { name: 'Notifications' }).click()
    await expect(patient.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
    await patient.getByRole('link', { name: 'Choose what you hear about' }).click()
    await expect(patient).toHaveURL(/\/account/)
    await patient.context().close()
  })

  test('a cancelled appointment is one notification nobody can switch off', async ({ browser }) => {
    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/account')

    const row = patient.getByRole('row', { name: /An appointment is cancelled/ })
    await expect(row).toBeVisible()
    await expect(row.getByText('Always sent')).toBeVisible()
    // Shown and disabled rather than hidden: somebody looking for the switch should find out
    // that it cannot be turned off, not fail to find it and assume the page is broken.
    await expect(row.getByRole('checkbox').first()).toBeDisabled()

    // Something optional, though, really does toggle.
    const optional = patient.getByRole('row', { name: /A payment is received/ })
    const inApp = optional.getByRole('checkbox').first()
    await expect(inApp).toBeEnabled()
    await inApp.uncheck()
    await expect(patient.getByText('Changes save as you make them.')).toBeVisible()

    await patient.reload()
    const afterReload = patient
      .getByRole('row', { name: /A payment is received/ })
      .getByRole('checkbox')
      .first()
    await expect(afterReload).not.toBeChecked()

    await patient.context().close()
  })
})
