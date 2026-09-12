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

  // Every destination the portal has is on the bar, including the ones past the fold: below
  // 768px this is the only navigation, so a page dropped for want of room is a page nobody can
  // reach. The bar scrolls sideways instead.
  const bills = navigation.getByRole('link', { name: 'Bills & payments' })
  await expect(bills).toHaveCount(1)
  await bills.scrollIntoViewIfNeeded()
  await expect(bills).toBeVisible()

  // Account is not a tab — it belongs to the account menu — but it is one tap away at every
  // width.
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
