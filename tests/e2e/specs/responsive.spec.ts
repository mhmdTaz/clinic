import { E2E } from '../e2e.env'
import { signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/** Runs in the "mobile" project only (a Pixel 7 viewport). Section 14.4. */
test('on a phone the sidebar gives way to a bottom tab bar', async ({ page }) => {
  await signIn(page, 'patient@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/patient$/)

  await expect(page.locator('aside')).toBeHidden()
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await expect(navigation).toHaveCount(1)
  await expect(navigation.getByRole('link', { name: 'Overview' })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'My records' })).toBeVisible()

  // Account is not a tab — it would push a portal page off the bar — but it is one tap away
  // from the account menu, at every width.
  await expect(navigation.getByRole('link', { name: 'Profile & security' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Profile & security' })).toBeVisible()
})

test('nothing on the page scrolls sideways on a phone', async ({ page }) => {
  await signIn(page, 'patient@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/patient$/)

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflows).toBe(false)
})
