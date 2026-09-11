import { E2E } from '../e2e.env'
import { clinicPermissionVersion, findAuditEntry } from '../helpers/database'
import { accessTokenOf, newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/** The permission version an access token was issued at: its `pv` claim, read, not verified. */
function permissionVersionOf(token: string): number {
  const payload = token.split('.')[1] ?? ''
  return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { pv: number }).pv
}

/**
 * Phase 2 exit criterion: an admin creates a "Head Nurse" role, grants it three permissions,
 * assigns a user, and that user's menu and API access change on their next request — with no
 * deploy.
 */
test('a role made at runtime reaches its member on their very next request', async ({
  page,
  browser,
}) => {
  const roleName = `Head Nurse ${Date.now()}`

  // Hana is already signed in, with no role: no portal, and the patient API refuses them.
  const nurse = await newPersonPage(browser)
  await signIn(nurse, 'nurse@clinic.local', E2E.password)
  await expect(nurse).toHaveURL(/\/no-access$/)
  expect((await nurse.request.get('/api/v1/patients')).status()).toBe(403)

  // The administrator creates the role and grants it three permissions.
  await signIn(page, 'admin@clinic.local', E2E.password)
  await page.goto('/admin/roles/new')
  await page.getByLabel('Name', { exact: true }).fill(roleName)
  await page.getByRole('button', { name: 'Create role' }).click()
  await expect(page).toHaveURL(/\/admin\/roles\/[a-z0-9]+$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(roleName)

  for (const permission of [
    /^Open the staff portal/,
    /^View patient records/,
    /^Register patients/,
  ]) {
    await page.getByRole('checkbox', { name: permission }).check()
  }
  await expect(page.getByText('3 unsaved changes')).toBeVisible()
  await page.getByRole('button', { name: 'Save permissions' }).click()
  await expect(page.getByText(/Permissions saved/)).toBeVisible()

  // …and gives it to Hana.
  await page.goto('/admin/users?q=aoun')
  await page.getByRole('link', { name: /Hana Aoun/ }).click()
  await expect(page).toHaveURL(/\/admin\/users\/[a-z0-9]+$/)
  await page.getByRole('checkbox', { name: roleName }).check()
  await page.getByRole('button', { name: 'Save roles' }).click()
  await expect(page.getByText('Roles saved.')).toBeVisible()

  // Their next API request runs with the new grants…
  expect((await nurse.request.get('/api/v1/patients')).status()).toBe(200)

  // …and their next page load opens the staff portal, with Patients in the menu.
  await nurse.reload()
  await expect(nurse).toHaveURL(/\/staff$/)
  await expect(
    nurse
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Patients' }),
  ).toBeVisible()

  const assignment = await findAuditEntry({
    action: 'user.role_assigned',
    'metadata.roles.name': roleName,
  })
  expect(assignment).toMatchObject({ category: 'ACCESS_CONTROL', actor: { label: 'Amal Haddad' } })

  await nurse.context().close()
})

test('a permission change does not strand anyone mid-session', async ({ page, browser }) => {
  // Rami is working in the staff portal when an administrator changes an unrelated role.
  const staff = await newPersonPage(browser)
  await signIn(staff, 'staff@clinic.local', E2E.password)
  await expect(staff).toHaveURL(/\/staff$/)

  await signIn(page, 'admin@clinic.local', E2E.password)
  await page.goto('/admin/roles/new')
  await page.getByLabel('Name', { exact: true }).fill(`Records clerk ${Date.now()}`)
  await page.getByRole('button', { name: 'Create role' }).click()
  await expect(page).toHaveURL(/\/admin\/roles\/[a-z0-9]+$/)
  await page.getByRole('checkbox', { name: /^View patient records/ }).check()
  await page.getByRole('button', { name: 'Save permissions' }).click()

  // Saving moved the clinic's permission version, so the administrator's own token went stale
  // just before the page refreshed. The page settles, and the browser is given a current token.
  await expect(page.getByText(/Permissions saved/)).toBeVisible()
  const version = await clinicPermissionVersion()
  await expect.poll(async () => permissionVersionOf(await accessTokenOf(page))).toBe(version)

  // Rami's next click is a client-side navigation carrying a stale token.
  await staff
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Patients' })
    .click()
  await expect(staff).toHaveURL(/\/staff\/patients$/)
  await expect(staff.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible()
  // A navigation inside the portal re-renders the page but not the shell that renews the cookie,
  // so Rami's token is replaced by their next refresh, full page load or API call.
  expect((await staff.request.get('/api/v1/me')).status()).toBe(200)
  expect(permissionVersionOf(await accessTokenOf(staff))).toBe(version)

  await staff.context().close()
})

test('the editor cannot grant what it does not hold itself', async ({ page }) => {
  await signIn(page, 'admin@clinic.local', E2E.password)
  await page.goto('/admin/roles')
  await page.getByRole('link', { name: /^Staff/ }).click()

  // Administrators deliberately lack the doctor portal, yet may still hand out the door itself.
  await expect(page.getByRole('checkbox', { name: /^Open the doctor portal/ })).toBeEnabled()
  // A system role keeps its name.
  await expect(page.getByText('A system role keeps its name.', { exact: false })).toBeVisible()
})
