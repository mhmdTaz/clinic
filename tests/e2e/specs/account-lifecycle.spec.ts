import { linkFromLatestEmail } from '../helpers/mailpit'
import { formAlert, signIn, signOut } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * One account, followed from activation to a forgotten password. Serial and self-contained:
 * it uses the seeded invited patient, whom no other spec touches.
 */
test.describe.serial('an invited patient, from activation to a forgotten password', () => {
  const email = 'invited@clinic.local'
  const firstPassword = 'Quiet-Harbour-Lantern-7'
  const secondPassword = 'Amber-Orchard-Compass-9'
  let activationLink = ''

  test('activates the account from the emailed link and lands in the patient portal', async ({
    page,
  }) => {
    activationLink = await linkFromLatestEmail(email, 'Activate')
    await page.goto(activationLink)

    await expect(page.getByText('Welcome, Layla.')).toBeVisible()
    // The one-time token has been removed from the address bar.
    expect(page.url()).not.toContain('token=')

    await page.getByLabel('Password', { exact: true }).fill(firstPassword)
    await page.getByLabel('Confirm password').fill(firstPassword)
    await page.getByRole('button', { name: 'Activate and sign in' }).click()

    await expect(page).toHaveURL(/\/patient$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Layla')
  })

  test('the activation link cannot be used a second time', async ({ page }) => {
    await page.goto(activationLink)
    await expect(formAlert(page)).toContainText('invalid or has expired')
  })

  test('resets a forgotten password from the emailed link', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(/If an account exists for that address/)).toBeVisible()

    const resetLink = await linkFromLatestEmail(email, 'Reset')
    await page.goto(resetLink)
    await page.getByLabel('New password', { exact: true }).fill(secondPassword)
    await page.getByLabel('Confirm new password').fill(secondPassword)
    await page.getByRole('button', { name: 'Set new password' }).click()

    await expect(page).toHaveURL(/\/login\?reason=reset$/)
    await expect(page.getByText('Your password has been changed.')).toBeVisible()

    await signIn(page, email, secondPassword)
    await expect(page).toHaveURL(/\/patient$/)
    await signOut(page)
  })

  test('the old password no longer works', async ({ page }) => {
    await signIn(page, email, firstPassword)
    await expect(formAlert(page)).toContainText('The email or password is incorrect.')
  })

  test('a weak new password is explained, not just refused', async ({ page }) => {
    await signIn(page, email, secondPassword)
    await expect(page).toHaveURL(/\/patient$/)
    await page.goto('/account')

    await page.getByLabel('Current password').fill(secondPassword)
    await page.getByLabel('New password', { exact: true }).fill('Password2026!!')
    await page.getByLabel('Confirm new password').fill('Password2026!!')
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.getByText('This password is too common.')).toBeVisible()
  })
})
