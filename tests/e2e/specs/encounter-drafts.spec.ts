import type { Browser, Locator, Page, Route } from '@playwright/test'
import { E2E } from '../e2e.env'
import { seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Audit F01 and F02: two ways a clinician lost clinical text without being told.
 *
 * F01 — save A, type B, sign: A was frozen and B vanished.
 * F02 — type, click Back to the chart: the draft was gone, with no question asked.
 *
 * Named to run after clinical.spec.ts, whose journeys read "the doctor's newest visit" as the one
 * they recorded. Every visit here belongs to a patient that spec never opens.
 */

async function doctorPage(browser: Browser): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, 'doctor@clinic.local', E2E.password)
  return page
}

/** A fresh visit, opened through the API the workspace uses, with the workspace on screen. */
async function openVisit(page: Page, from = '/doctor/patients'): Promise<string> {
  await page.goto(from)
  const patientId = await seededPatientId('Haddad')
  const id = await page.evaluate(async (patientId) => {
    const response = await fetch('/api/v1/encounters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        patientId,
        appointmentId: null,
        encounterType: 'CONSULTATION',
        chiefComplaint: 'Draft safety',
      }),
    })
    const body = (await response.json()) as { data: { id: string } }
    return body.data.id
  }, patientId)
  await page.goto(`/doctor/encounters/${id}`)
  await expect(page.getByText('Note in progress')).toBeVisible()
  return id
}

async function storedVisit(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/encounters/${id}`, { credentials: 'same-origin' })
    const body = (await response.json()) as {
      data: {
        revision: number
        note: { subjective: string | null; status: string; isPatientVisible: boolean }
        vitals: { temperatureC: string | null } | null
      }
    }
    return body.data
  }, id)
}

/** Types the way a person does, so the browser counts it as a user having been here. */
async function typeInto(field: Locator, text: string) {
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.press('Backspace')
  await field.pressSequentially(text)
}

const subjective = (page: Page) => page.getByLabel('Subjective')
const openSigning = async (page: Page) => {
  await page.getByRole('button', { name: 'Sign the note' }).first().click()
  return page.getByRole('dialog')
}
const confirmSign = (dialog: Locator) => dialog.getByRole('button', { name: 'Sign the note' })
const saveNote = async (page: Page) => {
  await page.getByRole('button', { name: 'Save the note' }).click()
  await expect(page.getByText('Note saved.')).toBeVisible()
}

/** Makes the next note save fail (or answer slowly) without touching any other request. */
async function interceptNoteSave(page: Page, id: string, answer: (route: Route) => Promise<void>) {
  await page.route(`**/api/v1/encounters/${id}`, async (route) => {
    if (route.request().method() === 'PATCH') await answer(route)
    else await route.continue()
  })
}

test.describe('signing only what was saved (F01)', () => {
  test('saved A, typed B: signing waits, and then signs exactly B', async ({ browser }) => {
    const page = await doctorPage(browser)
    const id = await openVisit(page)

    await typeInto(subjective(page), 'A: saved first.')
    await saveNote(page)
    await typeInto(subjective(page), 'B: the version on screen.')

    // The dialog refuses, says why, and offers the way to the unsaved part.
    let dialog = await openSigning(page)
    await expect(dialog.getByText('Save your changes before signing.')).toBeVisible()
    await expect(dialog.getByText('Clinical note', { exact: true })).toBeVisible()
    await expect(confirmSign(dialog)).toBeDisabled()
    await dialog.getByRole('button', { name: 'Go to Clinical note' }).click()
    await expect(dialog).toBeHidden()
    await expect(subjective(page)).toBeFocused()
    await expect(subjective(page)).toHaveValue('B: the version on screen.')

    await saveNote(page)
    dialog = await openSigning(page)
    // What will be frozen is shown before it is.
    await expect(dialog.getByText('You are signing the note as it was last saved:')).toBeVisible()
    await expect(dialog.getByText('B: the version on screen.')).toBeVisible()
    await confirmSign(dialog).click()
    await expect(dialog).toBeHidden()

    await expect(page.getByText('Note signed')).toBeVisible()
    await expect(page.getByText('B: the version on screen.')).toBeVisible()
    await expect(page.getByText('A: saved first.')).toHaveCount(0)
    const stored = await storedVisit(page, id)
    expect(stored.note).toMatchObject({ status: 'SIGNED', subjective: 'B: the version on screen.' })
    await page.context().close()
  })

  test('an unsaved sharing choice, vitals or diagnoses hold the signature too', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    await openVisit(page)
    await typeInto(subjective(page), 'Something to sign.')
    await saveNote(page)

    const blockedBy = async (section: string) => {
      const dialog = await openSigning(page)
      await expect(dialog.getByText('Save your changes before signing.')).toBeVisible()
      await expect(dialog.getByText(section, { exact: true })).toBeVisible()
      await expect(confirmSign(dialog)).toBeDisabled()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    }
    const notBlocked = async () => {
      const dialog = await openSigning(page)
      await expect(dialog.getByText('Save your changes before signing.')).toHaveCount(0)
      await expect(confirmSign(dialog)).toBeEnabled()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
    }

    const share = page.getByLabel(/Share this note with the patient/)
    await share.check()
    await blockedBy('Clinical note')
    await share.uncheck()
    await notBlocked()

    const temperature = page.getByLabel(/Temperature/)
    await typeInto(temperature, '37.2')
    await blockedBy('Vitals')
    await typeInto(temperature, '')
    await notBlocked()

    await page.getByRole('button', { name: 'Add a diagnosis' }).click()
    await page.getByRole('textbox', { name: 'Code' }).fill('J06.9')
    await blockedBy('Diagnoses')
    await page.getByRole('button', { name: 'Remove J06.9' }).click()
    await notBlocked()
    await page.context().close()
  })

  test('a failed save keeps the draft and the block; a slow one cannot be signed around', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    const id = await openVisit(page)
    await typeInto(subjective(page), 'Saved before the network failed.')
    await saveNote(page)

    // Failed: the text stays, an error says so, and signing still refuses.
    await interceptNoteSave(page, id, (route) => route.abort('failed'))
    await typeInto(subjective(page), 'Typed while offline.')
    await page.getByRole('button', { name: 'Save the note' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: /connection|reach|wrong/i }),
    ).toBeVisible()
    await expect(subjective(page)).toHaveValue('Typed while offline.')
    const blocked = await openSigning(page)
    await expect(confirmSign(blocked)).toBeDisabled()
    await blocked.getByRole('button', { name: 'Cancel' }).click()
    await page.unroute(`**/api/v1/encounters/${id}`)

    // Slow: while the save is in flight the dialog says so and still refuses.
    await interceptNoteSave(page, id, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    await page.getByRole('button', { name: 'Save the note' }).click()
    const dialog = await openSigning(page)
    await expect(dialog.getByText('Clinical note (saving…)')).toBeVisible()
    await expect(confirmSign(dialog)).toBeDisabled()
    // Once the server has it, the same dialog allows it — showing what it now holds.
    await expect(dialog.getByText('Typed while offline.')).toBeVisible({ timeout: 10_000 })
    await page.unroute(`**/api/v1/encounters/${id}`)

    // Repeated clicks send one signature.
    const signatures: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith(`/api/v1/encounters/${id}/sign`)) signatures.push(request.method())
    })
    await confirmSign(dialog).click({ clickCount: 3 })
    await expect(page.getByText('Note signed')).toBeVisible()
    expect(signatures).toEqual(['POST'])
    expect((await storedVisit(page, id)).note.subjective).toBe('Typed while offline.')
    await page.context().close()
  })

  test('a visit changed elsewhere after this screen loaded is not signed unseen', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    const id = await openVisit(page)
    await typeInto(subjective(page), 'What this tab saved.')
    await saveNote(page)

    // Another tab, or the doctor's phone, saves over it.
    await page.evaluate(async (id) => {
      await fetch(`/api/v1/encounters/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ note: { subjective: 'What the other tab saved.' } }),
      })
    }, id)

    const dialog = await openSigning(page)
    await confirmSign(dialog).click()
    await expect(dialog.getByText(/changed after you opened it/)).toBeVisible()
    expect((await storedVisit(page, id)).note.status).toBe('DRAFT')

    // Reviewing brings the newer text onto the screen; nothing was typed here to lose.
    await dialog.getByRole('button', { name: 'Load the latest version' }).click()
    await expect(dialog).toBeHidden()
    await expect(subjective(page)).toHaveValue('What the other tab saved.')
    await expect(page.getByText('Note in progress')).toBeVisible()

    const again = await openSigning(page)
    await expect(again.getByText('What the other tab saved.')).toBeVisible()
    await confirmSign(again).click()
    await expect(page.getByText('Note signed')).toBeVisible()
    expect((await storedVisit(page, id)).note.subjective).toBe('What the other tab saved.')
    await page.context().close()
  })
})

test.describe('leaving with unsaved work (F02)', () => {
  const leaveDialog = (page: Page) =>
    page.getByRole('dialog').filter({ hasText: 'Leave without saving?' })

  test('a link asks first: Stay keeps every field, Discard leaves only what was saved', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    const id = await openVisit(page)
    await typeInto(subjective(page), 'Saved line.')
    await saveNote(page)
    await typeInto(subjective(page), 'Unsaved line.')
    await typeInto(page.getByLabel(/Temperature/), '36.9')

    await page.getByRole('link', { name: 'Back to the chart' }).first().click()
    const dialog = leaveDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Clinical note', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Vitals', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Stay on this page' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/doctor/encounters/${id}$`))
    await expect(subjective(page)).toHaveValue('Unsaved line.')
    await expect(page.getByLabel(/Temperature/)).toHaveValue('36.9')

    // The navigation menu is held the same way.
    await page.getByRole('link', { name: 'Appointments' }).first().click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Discard and leave' }).click()
    await expect(page).toHaveURL(/\/doctor\/appointments/)

    await page.goto(`/doctor/encounters/${id}`)
    await expect(subjective(page)).toHaveValue('Saved line.')
    await expect(page.getByLabel(/Temperature/)).toHaveValue('')
    await page.context().close()
  })

  test('Save and leave saves everything first; a failed save keeps the doctor there', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    const id = await openVisit(page)

    await typeInto(subjective(page), 'Kept by Save and leave.')
    await typeInto(page.getByLabel(/Temperature/), '37.4')
    await page.getByRole('link', { name: 'Back to the chart' }).first().click()
    await leaveDialog(page).getByRole('button', { name: 'Save and leave' }).click()
    await expect(page).toHaveURL(/\/doctor\/patients\//)
    const stored = await storedVisit(page, id)
    expect(stored.note.subjective).toBe('Kept by Save and leave.')
    expect(stored.vitals?.temperatureC).toBe('37.4')

    await page.goto(`/doctor/encounters/${id}`)
    await interceptNoteSave(page, id, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL', message: 'boom', details: [] } }),
      }),
    )
    await typeInto(subjective(page), 'Must not be lost.')
    await page.getByRole('link', { name: 'Back to the chart' }).first().click()
    await leaveDialog(page).getByRole('button', { name: 'Save and leave' }).click()
    await expect(leaveDialog(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/doctor/encounters/${id}$`))
    await expect(subjective(page)).toHaveValue('Must not be lost.')
    await expect(subjective(page)).toBeFocused()
    await page.context().close()
  })

  test('Back and closing the tab are held; a saved page leaves in one Back press', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    await openVisit(page, '/doctor/appointments')

    await typeInto(subjective(page), 'Held against Back.')
    await page.goBack()
    const dialog = leaveDialog(page)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Stay on this page' }).click()
    await expect(page).toHaveURL(/\/doctor\/encounters\//)
    await expect(subjective(page)).toHaveValue('Held against Back.')

    // Held again after staying, not only the first time.
    await page.goBack()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Stay on this page' }).click()

    // Closing the tab gets the browser's own warning; dismissing it keeps the page.
    const warned = new Promise<string>((resolve) => {
      page.once('dialog', (native) => {
        resolve(native.type())
        void native.dismiss()
      })
    })
    await page.close({ runBeforeUnload: true })
    expect(await warned).toBe('beforeunload')
    expect(page.isClosed()).toBe(false)
    await expect(subjective(page)).toHaveValue('Held against Back.')

    // Saved: Back goes straight to where the doctor came from — no dialog, no extra entry.
    await saveNote(page)
    await page.goBack()
    await expect(page).toHaveURL(/\/doctor\/appointments/)
    await expect(dialog).toHaveCount(0)
    await page.context().close()
  })

  test('a clean visit is left freely', async ({ browser }) => {
    const page = await doctorPage(browser)
    await openVisit(page)
    let asked = false
    page.on('dialog', () => (asked = true))
    await page.getByRole('link', { name: 'Back to the chart' }).first().click()
    await expect(page).toHaveURL(/\/doctor\/patients\//)
    await expect(leaveDialog(page)).toHaveCount(0)
    expect(asked).toBe(false)
    await page.context().close()
  })

  test('saving one section never costs another its draft, even when the page refreshes', async ({
    browser,
  }) => {
    const page = await doctorPage(browser)
    const id = await openVisit(page)
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1))

    await typeInto(subjective(page), 'Note draft, not saved.')
    await typeInto(page.getByLabel(/Temperature/), '36.8')
    await page.getByRole('button', { name: 'Save vitals' }).click()
    await expect(page.getByText('Vitals saved.')).toBeVisible()
    // Past the router's 2.5 s refresh fallback: the page must not have reloaded under the note.
    await page.waitForTimeout(3500)
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1)
    await expect(subjective(page)).toHaveValue('Note draft, not saved.')

    // And the other way round.
    await typeInto(page.getByLabel(/Temperature/), '37.9')
    await saveNote(page)
    await expect(page.getByLabel(/Temperature/)).toHaveValue('37.9')
    const stored = await storedVisit(page, id)
    expect(stored.vitals?.temperatureC).toBe('36.8')
    expect(stored.note.subjective).toBe('Note draft, not saved.')
    await page.context().close()
  })
})
