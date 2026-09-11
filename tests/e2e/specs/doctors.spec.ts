import { E2E } from '../e2e.env'
import { linkFromLatestEmail } from '../helpers/mailpit'
import { signIn } from '../helpers/session'
import { expect, test } from './fixtures'

test('staff add a doctor, who is sent an activation link and listed with specialty and fee', async ({
  page,
}) => {
  const lastName = `Saliba${Date.now().toString().slice(-6)}`
  const email = `dr.${lastName.toLowerCase()}@clinic.local`

  await signIn(page, 'staff@clinic.local', E2E.password)
  await page.goto('/staff/doctors/new')
  await page.getByLabel('Title').fill('Dr')
  await page.getByLabel('First name').fill('Nour')
  await page.getByLabel('Last name').fill(lastName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Consultation fee').fill('45')
  await page.getByRole('checkbox', { name: 'Cardiology' }).check()
  await page.getByRole('button', { name: 'Add doctor' }).click()

  await expect(page).toHaveURL(/\/staff\/doctors\/[a-z0-9]+\?created=sent$/)
  await expect(page.getByText('Doctor added. The activation email is on its way.')).toBeVisible()
  expect(await linkFromLatestEmail(email, 'Activate')).toContain('/accept-invite#token=')

  await page.goto(`/staff/doctors?q=${lastName}`)
  const row = page.getByRole('row', { name: new RegExp(lastName) })
  await expect(row).toContainText('Cardiology')
  await expect(row).toContainText('$45.00')
})

test('a fee with more decimals than the currency has is explained, not saved', async ({ page }) => {
  await signIn(page, 'staff@clinic.local', E2E.password)
  await page.goto('/staff/doctors/new')
  await page.getByLabel('First name').fill('Rita')
  await page.getByLabel('Last name').fill(`Nader${Date.now()}`)
  await page.getByLabel('Email').fill(`rita.${Date.now()}@clinic.local`)
  await page.getByLabel('Consultation fee').fill('45.005')
  await page.getByRole('button', { name: 'Add doctor' }).click()

  await expect(
    page.getByText("The clinic's currency does not have that many decimal places."),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/staff\/doctors\/new$/)
})
