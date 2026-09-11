import { E2E } from '../e2e.env'
import { findAuditEntry } from '../helpers/database'
import { linkFromLatestEmail } from '../helpers/mailpit'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/** One account followed from invitation to suspension and back. */
test.describe.serial('managing a user', () => {
  const email = `karim.${Date.now()}@clinic.local`
  const password = 'Cedar-Harbour-Window-42'
  let userPath = ''

  test('an admin invites a receptionist, who activates the account from the email', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'admin@clinic.local', E2E.password)
    await page.goto('/admin/users/new')
    await page.getByLabel('First name').fill('Karim')
    await page.getByLabel('Last name').fill('Mansour')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('checkbox', { name: /^Staff/ }).check()
    await page.getByRole('button', { name: 'Send invitation' }).click()

    await expect(page).toHaveURL(/\/admin\/users\/[a-z0-9]+\?created=sent$/)
    await expect(
      page.getByText('Account created. The invitation email is on its way.'),
    ).toBeVisible()
    userPath = new URL(page.url()).pathname

    const receptionist = await newPersonPage(browser)
    await receptionist.goto(await linkFromLatestEmail(email, 'Activate'))
    await expect(receptionist.getByText('Welcome, Karim.')).toBeVisible()
    await receptionist.getByLabel('Password', { exact: true }).fill(password)
    await receptionist.getByLabel('Confirm password').fill(password)
    await receptionist.getByRole('button', { name: 'Activate and sign in' }).click()
    await expect(receptionist).toHaveURL(/\/staff$/)
    await receptionist.context().close()
  })

  test('suspending ends their session on its next request; restoring gives the account back', async ({
    page,
    browser,
  }) => {
    const receptionist = await newPersonPage(browser)
    await signIn(receptionist, email, password)
    await expect(receptionist).toHaveURL(/\/staff$/)

    await signIn(page, 'admin@clinic.local', E2E.password)
    await page.goto(userPath)
    await page.getByRole('button', { name: 'Suspend account' }).click()
    const suspendDialog = page.getByRole('dialog')
    await suspendDialog.getByLabel('Reason (optional)').fill('Left the clinic')
    await suspendDialog.getByRole('button', { name: 'Suspend', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Restore account' })).toBeVisible()

    expect((await receptionist.request.get('/api/v1/me')).status()).toBe(401)
    await receptionist.goto('/staff')
    await expect(receptionist).toHaveURL(/\/login/)

    await page.getByRole('button', { name: 'Restore account' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Suspend account' })).toBeVisible()

    await signIn(receptionist, email, password)
    await expect(receptionist).toHaveURL(/\/staff$/)
    await receptionist.context().close()

    expect(
      await findAuditEntry({ action: 'user.suspended', 'metadata.reason': 'Left the clinic' }),
    ).toMatchObject({ severity: 'WARNING', actor: { label: 'Amal Haddad' } })
  })

  test('an administrator cannot suspend their own account', async ({ page }) => {
    await signIn(page, 'admin@clinic.local', E2E.password)
    await page.goto('/admin/users?q=haddad')
    await page.getByRole('link', { name: /Amal Haddad/ }).click()
    await expect(page.getByText('This is your own account.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Suspend account' })).toHaveCount(0)
  })
})
