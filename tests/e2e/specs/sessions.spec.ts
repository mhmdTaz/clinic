import { E2E } from '../e2e.env'
import { accessTokenOf, signIn, signOut } from '../helpers/session'
import { expect, test } from './fixtures'

test('signing out ends the session on the server, not just in this browser', async ({
  page,
  request,
}) => {
  await signIn(page, 'doctor@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/doctor$/)

  const token = await accessTokenOf(page)
  const asBearer = { headers: { authorization: `Bearer ${token}` } }
  expect((await request.get('/api/v1/me', asBearer)).status()).toBe(200)

  await signOut(page)

  // The token's signature is still valid for minutes. The session behind it is not.
  expect((await request.get('/api/v1/me', asBearer)).status()).toBe(401)
})

test('the account page lists this device and knows it is the current one', async ({ page }) => {
  await signIn(page, 'staff@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/staff$/)

  await page.goto('/account')
  await expect(page.getByRole('heading', { level: 1, name: 'Profile & security' })).toBeVisible()
  await expect(page.getByText('This device')).toBeVisible()
})

test('a signed-in user who opens /login is taken to their portal instead', async ({ page }) => {
  await signIn(page, 'staff@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/staff$/)
  await page.goto('/login')
  await expect(page).toHaveURL(/\/staff$/)
})
