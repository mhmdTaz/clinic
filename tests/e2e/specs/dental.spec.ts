import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Phase 11 end to end: the tooth chart a dental practice switches for. The seed gives Omar
 * Fakhoury a charted mouth — a crown on a root-filled 11, a planned crown on 16, decay on 26, a
 * bridge over 46, an implant on 36 — over visits by the seeded dentist.
 */

async function signedInAs(
  browser: Browser,
  email: string,
  view: '2d' | '3d' = '2d',
): Promise<Page> {
  const page = await newPersonPage(browser)
  // The chart remembers each person's view; the journeys choose it rather than inherit it.
  await page.addInitScript((mode) => {
    window.localStorage.setItem('clinic.dentalChart.mode', mode)
  }, view)
  await signIn(page, email, E2E.password)
  return page
}

/**
 * Opens a tooth's panel. The chart is server-rendered, so a click can land before the page has
 * hydrated and do nothing; the click is retried until the panel names the tooth.
 */
async function openTooth(page: Page, label: string): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 30_000 })
}

test.describe('the tooth chart', () => {
  test('the front desk reads a tooth’s history and charts the next thing on another', async ({
    browser,
  }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto(`/staff/patients/${patientId}`)

    await expect(page.getByRole('heading', { name: 'Tooth chart' })).toBeVisible()
    await expect(page.getByText(/Last charted on .*: 11, 26/)).toBeVisible()

    // Tooth 11: the fracture, the root canal, and today's zirconia crown, newest first.
    await openTooth(page, 'Tooth 11 · upper right central incisor')
    const history = page.getByRole('list').filter({ hasText: 'Zirconia crown' })
    await expect(history.getByText('Zirconia crown', { exact: true })).toBeVisible()
    await expect(history.getByText('Root canal treatment')).toBeVisible()
    await expect(history.getByText(/Zirconia crown, shade A2/)).toBeVisible()

    // A composite on 24's mesial and occlusal surfaces, against today's visit.
    await openTooth(page, 'Tooth 24 · upper left first premolar')
    await page.getByRole('button', { name: 'Chart something on this tooth' }).click()
    await page.getByLabel('What', { exact: true }).selectOption({ label: 'Composite filling' })
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue('COMPLETED')
    await page.getByRole('button', { name: 'M', exact: true }).click()
    await page.getByRole('button', { name: 'O', exact: true }).click()
    // The page's front-desk notes field is also called "Notes"; this is the tooth form's.
    await page
      .getByPlaceholder(/What was done, materials/)
      .fill('Composite A3, small mesial lesion.')
    await page.getByRole('button', { name: 'Save to the chart' }).click()

    await expect(page.getByText('Composite filling (MO)')).toBeVisible()
    await expect(page.getByText(/Last charted on .*: 11, 24, 26/)).toBeVisible()
  })

  test('the server refuses what a tooth cannot have, and says which field', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto(`/staff/patients/${patientId}`)

    // An occlusal surface on a front tooth: the form only offers I, so ask the API directly.
    const refused = await page.evaluate(async (id) => {
      const treatments = (await fetch('/api/v1/dental/treatments').then((r) => r.json())) as {
        data: Array<{ id: string; code: string }>
      }
      const filling = treatments.data.find((t) => t.code === 'FILLING_COMPOSITE')!
      const response = await fetch(`/api/v1/patients/${id}/tooth-records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teeth: [{ fdi: '21', role: null }],
          surfaces: ['O'],
          treatmentId: filling.id,
          status: 'COMPLETED',
        }),
      })
      const body = (await response.json()) as { error?: { details?: unknown } }
      return { status: response.status, details: body.error?.details }
    }, patientId)
    expect(refused).toEqual({
      status: 400,
      details: [{ field: 'surfaces', issue: 'NO_OCCLUSAL_ON_FRONT_TOOTH' }],
    })
  })

  test('the dentist finishes planned work from the visit, and the plan stays on the record', async ({
    browser,
  }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'doctor@clinic.local')
    await page.goto('/doctor')
    const visitId = await page.evaluate(async (id) => {
      const body = (await fetch(`/api/v1/encounters?patientId=${id}`).then((r) => r.json())) as {
        data: Array<{ id: string }>
      }
      return body.data[0]?.id ?? ''
    }, patientId)
    expect(visitId).not.toBe('')

    await page.goto(`/doctor/encounters/${visitId}`)
    await expect(page.getByRole('heading', { name: 'Tooth chart' })).toBeVisible()
    await openTooth(page, 'Tooth 16 · upper right first molar')
    await page.getByRole('button', { name: 'Mark as done' }).click()

    const rows = page.getByRole('listitem').filter({ hasText: 'Porcelain-fused-to-metal crown' })
    await expect(rows.filter({ hasText: 'Carried out' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Done' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0)
  })

  test('the 3D jaw draws, and the flat chart is one click away', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'staff@clinic.local', '3d')
    await page.goto(`/staff/patients/${patientId}`)

    const jaw = page.getByRole('application', { name: /3D model/ })
    await expect(jaw.getByText('Drag to rotate, scroll to zoom, click a tooth')).toBeVisible({
      timeout: 60_000,
    })
    await expect(jaw.locator('canvas')).toBeVisible()

    await page.getByRole('button', { name: '2D', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Tooth chart, FDI numbering' })).toBeVisible()
  })

  test('the administrator shapes what the chart offers', async ({ browser }) => {
    const page = await signedInAs(browser, 'admin@clinic.local')
    await page.goto('/admin')
    await page.getByRole('link', { name: 'Dental chart' }).click()
    await expect(page).toHaveURL(/\/admin\/dental$/)
    await expect(page.getByText('CROWN_ZIRCONIA')).toBeVisible()

    await page.getByRole('button', { name: 'Add a quick-pick' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill('Sealant O')
    await dialog.getByLabel('Treatment on line 1').selectOption({ label: 'Fissure sealant' })
    await dialog.getByRole('button', { name: 'O', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Fissure sealant O (Done)')).toBeVisible()
  })

  test('a patient does not reach the chart yet', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const page = await signedInAs(browser, 'patient@clinic.local')
    await page.goto('/patient')
    const status = await page.evaluate(
      async (id) => (await fetch(`/api/v1/patients/${id}/dental-chart`)).status,
      patientId,
    )
    expect(status).toBe(403)
  })
})

test('signing out from the sidebar ends the session', async ({ browser }) => {
  const page = await signedInAs(browser, 'staff@clinic.local')
  await page.goto('/staff')
  await page.getByRole('complementary').getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  const status = await page.evaluate(async () => (await fetch('/api/v1/me')).status)
  expect(status).toBe(401)
})
