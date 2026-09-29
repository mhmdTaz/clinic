import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Phase 12 end to end: a plan the patient can say yes to. The seed gives Omar Fakhoury an agreed
 * plan, six weeks old and untouched — the crown on 16 and the wisdom tooth — and prices the
 * dental treatments through the price list. These journeys draw up a plan of their own, so they
 * do not depend on what the tooth-chart journeys did to his chart first.
 */

async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  // The flat chart: it draws at once, and the journeys are about the plan, not the jaw.
  await page.addInitScript(() => window.localStorage.setItem('clinic.dentalChart.mode', '2d'))
  await signIn(page, email, E2E.password)
  return page
}

/** Plans a composite on one surface of a tooth, through the API, and returns the row's id. */
async function planFilling(page: Page, patientId: string, fdi: string): Promise<string> {
  return page.evaluate(
    async ({ id, tooth }) => {
      const treatments = (await fetch('/api/v1/dental/treatments').then((r) => r.json())) as {
        data: Array<{ id: string; code: string }>
      }
      const filling = treatments.data.find((t) => t.code === 'FILLING_COMPOSITE')!
      const response = await fetch(`/api/v1/patients/${id}/tooth-records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teeth: [{ fdi: tooth, role: null }],
          surfaces: ['O'],
          treatmentId: filling.id,
          status: 'PLANNED',
        }),
      })
      return ((await response.json()) as { data: { id: string } }).data.id
    },
    { id: patientId, tooth: fdi },
  )
}

test.describe('treatment plans', () => {
  test('the front desk draws up a plan, the patient signs it, and the done work is billed once', async ({
    browser,
  }, testInfo) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto(`/staff/patients/${patientId}`)
    // A retry plans on another tooth: the first attempt's filling is already on the chart, and the
    // editor would offer both.
    const tooth = testInfo.retry === 0 ? '37' : '38'
    const recordId = await planFilling(page, patientId, tooth)
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Treatment plans' })).toBeVisible()
    // The seeded plan, agreed six weeks ago.
    await expect(
      page.getByRole('article', { name: 'Finish the upper right, then the wisdom tooth' }),
    ).toContainText('Agreed')

    // Draw up a plan with just the new filling in it, priced from the price list.
    await expect(async () => {
      await page.getByRole('button', { name: 'New plan' }).click()
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 30_000 })
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title', { exact: true }).fill(`Filling on ${tooth}`)
    for (const box of await dialog.getByRole('checkbox').all()) await box.uncheck()
    await dialog.getByRole('checkbox', { name: `Composite filling (O) — ${tooth}` }).check()
    await expect(dialog.getByText('Total')).toContainText('60.00')
    await dialog.getByRole('button', { name: 'Save plan' }).click()
    await expect(dialog).toBeHidden()

    const plan = page.getByRole('article', { name: `Filling on ${tooth}` })
    await expect(plan).toContainText('Draft')
    await expect(plan).toContainText('60.00')

    // Presented at the chair: the patient signs on the screen.
    // The card is re-rendered by the refresh after saving; a click that lands on the old one is lost.
    await expect(async () => {
      await plan.getByRole('link', { name: 'Present' }).click()
      await expect(page).toHaveURL(/\/plans\/[^/]+\/present$/, { timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await page.getByRole('button', { name: 'I agree to this plan' }).click()
    const pad = page.getByRole('img', { name: 'Sign here' })
    const box = (await pad.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + box.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(box.x + 30 + step * 20, box.y + box.height / 2 + (step % 2 ? 18 : -18))
    }
    await page.mouse.up()
    await page.getByRole('button', { name: 'Sign and agree' }).click()
    await expect(page.getByText('Agreed by Omar Fakhoury. Thank you.')).toBeVisible()
    await page.getByRole('link', { name: 'Done' }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/patients/${patientId}$`))
    await expect(plan).toContainText('Agreed')

    // The dentist does the filling in today's visit; the plan hears it from the chart.
    const visitId = await page.evaluate(async (id) => {
      const body = (await fetch(`/api/v1/encounters?patientId=${id}`).then((r) => r.json())) as {
        data: Array<{ id: string }>
      }
      return body.data[0]?.id ?? ''
    }, patientId)
    expect(visitId).not.toBe('')
    const completed = await page.evaluate(
      async ({ record, visit }) =>
        (
          await fetch(`/api/v1/tooth-records/${record}/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ encounterId: visit }),
          })
        ).status,
      { record: recordId, visit: visitId },
    )
    expect(completed).toBe(201)
    await page.reload()
    await expect(plan).toContainText('Completed')

    // Billed from the plan, at the agreed price, once.
    await plan.getByRole('button', { name: 'Add to invoice' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Add to invoice' }).click()
    await expect(plan.getByText(/^On INV-/)).toBeVisible()
    await expect(plan.getByRole('button', { name: 'Add to invoice' })).toHaveCount(0)
  })

  test('the front desk finds who to call back, and a plan prints', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto('/staff')
    await page.getByRole('complementary').getByRole('link', { name: 'Plan recall' }).click()
    await expect(page).toHaveURL(/\/staff\/dental\/recall$/)
    const row = page.getByRole('row').filter({ hasText: 'Omar Fakhoury' })
    await expect(row).toContainText('Finish the upper right, then the wisdom tooth')
    await expect(row).toContainText('Nothing booked')
    await expect(row.getByRole('button', { name: 'Book an appointment' })).toBeVisible()

    await page.goto(`/staff/patients/${patientId}`)
    await page
      .getByRole('article', { name: 'Finish the upper right, then the wisdom tooth' })
      .getByRole('link', { name: 'Print' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Finish the upper right, then the wisdom tooth' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Tooth chart, FDI numbering' })).toBeVisible()
    await expect(page.getByText('Omar Fakhoury, ')).toBeVisible()
  })

  test('a dentist sees the plans but does not bill from them', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto(`/doctor/patients/${patientId}`)
    const plan = page.getByRole('article', {
      name: 'Finish the upper right, then the wisdom tooth',
    })
    await expect(plan).toBeVisible()
    await expect(plan.getByRole('button', { name: 'Add to invoice' })).toHaveCount(0)
    const recall = await page.evaluate(
      async () => (await fetch('/api/v1/dental/overdue-plans')).status,
    )
    expect(recall).toBe(403)
  })
})
