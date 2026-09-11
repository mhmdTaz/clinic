import { E2E } from '../e2e.env'
import { SEEDED_USERS, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/** Phase 1 exit criterion: four seeded users sign in, and each lands on the right portal. */
for (const user of SEEDED_USERS) {
  test(`${user.firstName} (${user.portal}) lands on the ${user.portal} portal`, async ({
    page,
  }) => {
    await signIn(page, user.email, E2E.password)

    await expect(page).toHaveURL(new RegExp(`/${user.portal}$`))
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(user.name)
  })
}

test('someone with two portals can switch between them', async ({ page }) => {
  await signIn(page, 'admin@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/admin$/)

  const switcher = page.getByRole('button', { name: /Switch portal/ })
  await switcher.click()
  await page.getByRole('menuitemradio', { name: 'Staff' }).click()
  await expect(page).toHaveURL(/\/staff$/)

  // Switching also saves the choice; put it back so the landing test stays deterministic.
  await switcher.click()
  await page.getByRole('menuitemradio', { name: 'Admin' }).click()
  await expect(page).toHaveURL(/\/admin$/)
})

test('people with one portal are not offered a switcher', async ({ page }) => {
  await signIn(page, 'patient@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/patient$/)
  await expect(page.getByRole('button', { name: /Switch portal/ })).toHaveCount(0)
})
