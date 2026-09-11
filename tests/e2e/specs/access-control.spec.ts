import { E2E } from '../e2e.env'
import { findAuditEntry } from '../helpers/database'
import { fillSignIn, formAlert, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

test('a patient who types /admin is sent back to their own portal — and it is on the record', async ({
  page,
}) => {
  await signIn(page, 'patient@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/patient$/)

  const since = new Date(Date.now() - 1000)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/patient$/)

  const denial = await findAuditEntry({
    action: 'permission.denied',
    'metadata.permission': 'portal.admin:access',
    'actor.label': 'Sara Karam',
    occurredAt: { $gte: since },
  })
  expect(denial).toMatchObject({
    outcome: 'DENIED',
    category: 'ACCESS_CONTROL',
    severity: 'WARNING',
  })
})

test('a direct API call without permission gets 403 and writes permission.denied', async ({
  page,
}) => {
  await signIn(page, 'patient@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/patient$/)

  const response = await page.request.get('/api/v1/admin/clinic')
  expect(response.status()).toBe(403)
  const body = (await response.json()) as { error: { code: string }; meta: { requestId: string } }
  expect(body.error.code).toBe('FORBIDDEN')

  // The response and the audit entry share one request id: an auditor's question and an
  // engineer's investigation point at the same event.
  const denial = await findAuditEntry({
    action: 'permission.denied',
    'request.id': body.meta.requestId,
  })
  expect(denial).toMatchObject({
    outcome: 'DENIED',
    actor: { label: 'Sara Karam', type: 'USER' },
    metadata: { permission: 'portal.admin:access' },
  })
})

test('the same call succeeds for an administrator', async ({ page }) => {
  await signIn(page, 'admin@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/admin$/)

  const response = await page.request.get('/api/v1/admin/clinic')
  expect(response.status()).toBe(200)
  expect(((await response.json()) as { data: { name: string } }).data.name).toBe('Demo Clinic')
})

test('an anonymous API call is refused with 401', async ({ request }) => {
  const response = await request.get('/api/v1/me')
  expect(response.status()).toBe(401)
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'UNAUTHENTICATED',
  )
})

test('an anonymous visitor is sent to sign in, then returned to where they were going', async ({
  page,
}) => {
  await page.goto('/staff')
  await expect(page).toHaveURL(/\/login\?next=%2Fstaff$/)

  await fillSignIn(page, 'staff@clinic.local', E2E.password)
  await expect(page).toHaveURL(/\/staff$/)
})

test('a sign-in attempt from another site is refused', async ({ request }) => {
  const response = await request.post('/api/v1/auth/login', {
    headers: { origin: 'https://evil.example' },
    data: { email: 'admin@clinic.local', password: E2E.password },
  })
  expect(response.status()).toBe(403)
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe('CSRF_REJECTED')
})

test('a wrong password shows the generic message without revealing whether the account exists', async ({
  page,
}) => {
  await signIn(page, 'staff@clinic.local', 'definitely-not-the-password')
  // Wait for the message before reading it: an immediate read can see an empty alert, and
  // two empty strings would compare equal and prove nothing.
  await expect(formAlert(page)).toContainText('The email or password is incorrect.')
  const known = await formAlert(page).textContent()

  await signIn(page, 'no-such-person@clinic.local', 'definitely-not-the-password')
  await expect(formAlert(page)).toHaveText(known ?? '')
})
