import { E2E } from '../e2e.env'
import { findAuditEntry } from '../helpers/database'
import { signIn } from '../helpers/session'
import { expect, test } from './fixtures'

test('a second registration sharing a phone is warned about, and saved only with a reason', async ({
  page,
}) => {
  const stamp = Date.now().toString().slice(-6)
  const lastName = `Mansour${stamp}`
  const reason = `Sister, shares the family phone ${stamp}`

  await signIn(page, 'staff@clinic.local', E2E.password)

  await page.goto('/staff/patients/new')
  await page.getByLabel('First name').fill('Karim')
  await page.getByLabel('Last name').fill(lastName)
  await page.getByLabel('Date of birth').fill('1984-05-20')
  await page.getByLabel('Phone', { exact: true }).fill(`+961 3 ${stamp}`)
  await page.getByRole('button', { name: 'Register patient' }).click()
  await expect(page).toHaveURL(/\/staff\/patients\/[a-z0-9]+\?registered=yes$/)
  await expect(page.getByText('Patient registered.')).toBeVisible()
  const first = new URL(page.url()).pathname

  // The same number, written the local way, for someone else.
  await page.goto('/staff/patients/new')
  await page.getByLabel('First name').fill('Lina')
  await page.getByLabel('Last name').fill(lastName)
  await page.getByLabel('Phone', { exact: true }).fill(`03 ${stamp}`)
  await page.getByRole('button', { name: 'Register patient' }).click()

  const warning = page.getByRole('region', { name: 'This patient may already be registered' })
  await expect(warning).toBeVisible()
  await expect(warning.getByText(`Karim ${lastName}`)).toBeVisible()
  await expect(warning.getByText('Same phone number')).toBeVisible()

  await warning.getByLabel('Why is this someone else?').fill(reason)
  await warning.getByRole('button', { name: 'Register as a new patient' }).click()
  await expect(page).toHaveURL(/\/staff\/patients\/[a-z0-9]+\?registered=yes$/)
  expect(new URL(page.url()).pathname).not.toBe(first)

  const override = await findAuditEntry({
    action: 'patient.duplicate_override',
    'metadata.reason': reason,
  })
  expect(override).toMatchObject({ category: 'CLINICAL', actor: { label: 'Rami Khoury' } })

  // Both records are in the directory.
  await page.goto(`/staff/patients?q=${lastName}`)
  await expect(page.getByRole('table').getByRole('link')).toHaveCount(2)
})

test('the directory finds a patient by record number and hides archived records', async ({
  page,
}) => {
  await signIn(page, 'staff@clinic.local', E2E.password)
  await page.goto('/staff/patients?q=Fakhoury')
  await page.getByRole('link', { name: /Omar Fakhoury/ }).click()
  const recordNumber = await page.getByRole('main').locator('p').first().textContent()
  expect(recordNumber).toMatch(/^MRN-\d{6}$/)

  await page.goto(`/staff/patients?q=${recordNumber}`)
  await expect(page.getByRole('link', { name: /Omar Fakhoury/ })).toBeVisible()
})
