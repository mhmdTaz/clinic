import { E2E } from '../e2e.env'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

test('opening hours and a closure an admin sets appear on the patient portal', async ({
  page,
  browser,
}) => {
  const closure = `Founders Day ${Date.now().toString().slice(-4)}`
  const date = `${new Date().getUTCFullYear() + 1}-01-02`

  await signIn(page, 'admin@clinic.local', E2E.password)
  await page.goto('/admin/clinic')

  // Saturday is closed in the seed; open it for the morning.
  const saturday = page.getByRole('group', { name: 'Saturday' })
  await saturday.getByRole('button', { name: 'Add hours' }).click()
  await saturday.getByLabel('Saturday — Opens').fill('10:00')
  await saturday.getByLabel('Saturday — Closes').fill('14:00')
  await page.getByRole('button', { name: 'Save opening hours' }).click()
  await expect(page.getByText('Opening hours saved.')).toBeVisible()

  await page.getByLabel('Date', { exact: true }).fill(date)
  await page.getByLabel('Name', { exact: true }).fill(closure)
  await page.getByRole('button', { name: 'Add a closure' }).click()
  await expect(page.getByText('Closures saved.')).toBeVisible()

  const patient = await newPersonPage(browser)
  await signIn(patient, 'patient@clinic.local', E2E.password)
  await expect(patient).toHaveURL(/\/patient$/)
  const main = patient.getByRole('main')
  await expect(main.getByText('10:00–14:00')).toBeVisible()
  await expect(main.getByText(closure)).toBeVisible()
  await patient.context().close()
})

test('opening hours that overlap are explained beside the hours, not saved', async ({ page }) => {
  await signIn(page, 'admin@clinic.local', E2E.password)
  await page.goto('/admin/clinic')

  const sunday = page.getByRole('group', { name: 'Sunday' })
  await sunday.getByRole('button', { name: 'Add hours' }).click()
  await sunday.getByRole('button', { name: 'Add another block' }).click()
  const opens = sunday.getByLabel('Sunday — Opens')
  const closes = sunday.getByLabel('Sunday — Closes')
  await opens.nth(0).fill('09:00')
  await closes.nth(0).fill('13:00')
  await opens.nth(1).fill('12:00')
  await closes.nth(1).fill('16:00')
  await page.getByRole('button', { name: 'Save opening hours' }).click()

  await expect(
    sunday.getByText('These hours overlap other hours on the same day.').first(),
  ).toBeVisible()
  await expect(page.getByText('Opening hours saved.')).toHaveCount(0)
})
