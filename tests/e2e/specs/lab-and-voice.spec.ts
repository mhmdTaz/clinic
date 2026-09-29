import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Phase 13 end to end: lab work and voice charting. The seed has Omar Fakhoury's planned crown on
 * 16 at Beirut Dental Lab, sent five days ago and due in two. Voice charting is off until the
 * administrator turns it on; the browser's speech service is replaced by a stand-in that "hears"
 * a fixed sentence, because the real one sends audio to Google.
 */

async function signedInAs(
  browser: Browser,
  email: string,
  heard: string | null = null,
): Promise<Page> {
  const page = await newPersonPage(browser)
  await page.addInitScript((sentence) => {
    window.localStorage.setItem('clinic.dentalChart.mode', '2d')
    if (sentence === null) return
    class StandInRecognition {
      lang = 'en-US'
      interimResults = false
      maxAlternatives = 1
      continuous = false
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: sentence }]] })
          this.onend?.()
        }, 50)
      }
      stop() {
        this.onend?.()
      }
      abort() {}
    }
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = StandInRecognition
  }, heard)
  await signIn(page, email, E2E.password)
  return page
}

async function openTooth(page: Page, label: string): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 30_000 })
}

test.describe('lab work', () => {
  test('the front desk follows a crown from the lab to the mouth', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local')

    await page.goto('/staff')
    await page.getByRole('complementary').getByRole('link', { name: 'Lab work' }).click()
    await expect(page).toHaveURL(/\/staff\/dental\/lab$/)
    await expect(page.getByRole('row').filter({ hasText: 'Omar Fakhoury' })).toContainText(
      'Beirut Dental Lab',
    )

    await page.goto(`/staff/patients/${patientId}`)
    await openTooth(page, 'Tooth 16 · upper right first molar')
    await expect(page.getByRole('list', { name: 'Lab work on this tooth' })).toContainText(
      'At Beirut Dental Lab',
    )

    const order = page.getByRole('listitem', {
      name: 'Porcelain-fused-to-metal crown — Beirut Dental Lab',
    })
    await expect(order).toContainText('At the lab')
    await order.getByRole('button', { name: 'Mark as received' }).click()
    await expect(order).toContainText('Back, not fitted')
    await order.getByRole('button', { name: 'Mark as fitted' }).click()
    await expect(order).toContainText('Fitted')
    await expect(order.getByRole('button')).toHaveCount(0)
  })

  test('planned work is sent to a lab with the day it is due back', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto(`/staff/patients/${patientId}`)
    await page.evaluate(async (id) => {
      const treatments = (await fetch('/api/v1/dental/treatments').then((r) => r.json())) as {
        data: Array<{ id: string; code: string }>
      }
      const crown = treatments.data.find((t) => t.code === 'CROWN_ZIRCONIA')!
      await fetch(`/api/v1/patients/${id}/tooth-records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teeth: [{ fdi: '27', role: null }],
          treatmentId: crown.id,
          status: 'PLANNED',
        }),
      })
    }, patientId)
    await page.reload()

    await expect(async () => {
      await page.getByRole('button', { name: 'Send to lab' }).click()
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 30_000 })
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: 'Zirconia crown — 27' }).check()
    await dialog.getByLabel('Lab', { exact: true }).fill('Cedar Ceramics')
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole('listitem', { name: 'Zirconia crown — Cedar Ceramics' }),
    ).toContainText('At the lab')
  })
})

test.describe('voice charting', () => {
  test('is turned on knowingly, and a sentence becomes a draft somebody saves', async ({
    browser,
  }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/dental')
    const turnOn = admin.getByRole('button', { name: 'Turn on voice charting' })
    await expect(turnOn).toBeDisabled()
    await admin.getByLabel(/spoken audio is sent to the browser maker/).check()
    await turnOn.click()
    await expect(admin.getByText('Voice charting is on.')).toBeVisible()

    const patientId = await seededPatientId('Fakhoury')
    const desk = await signedInAs(browser, 'staff@clinic.local', 'twenty six MO composite done')
    await desk.goto(`/staff/patients/${patientId}`)
    await expect(async () => {
      await desk.getByRole('button', { name: 'Chart by voice' }).click()
      await expect(
        desk.getByRole('heading', { name: 'Tooth 26 · upper left first molar', exact: true }),
      ).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })

    await expect(desk.getByText('From voice: “twenty six MO composite done”')).toBeVisible()
    await expect(desk.getByLabel('Status', { exact: true })).toHaveValue('COMPLETED')
    // Nothing is written until a person saves it.
    await desk.getByRole('button', { name: 'Save to the chart' }).click()
    await expect(desk.getByText('Composite filling (MO)')).toBeVisible()
  })
})
