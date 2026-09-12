import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * **Phase 8's first exit criterion, end to end**: an admin can answer "who viewed this patient's
 * file last Tuesday, and what did they change" in under a minute.
 *
 * The journey below is that sentence, performed: somebody opens a patient's chart, and an admin
 * finds out — by entity, filtered to reads, with the change itself one click away. It is one URL,
 * which matters: the answer to a privacy complaint should be a link somebody can paste into a
 * ticket, not a sequence of clicks that has to be described.
 */

async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, email, E2E.password)
  return page
}

/** The first patient in the directory, and their id from the address. */
async function openFirstPatient(page: Page): Promise<{ id: string; name: string }> {
  await page.goto('/staff/patients')
  // Not just any /staff/patients/* link: "Register a patient" points at /staff/patients/new,
  // comes first in the DOM, and would give this test the id "new" and nothing to find.
  const row = page.locator('a[href^="/staff/patients/"]:not([href$="/new"])').first()
  await expect(row).toBeVisible()
  await row.click()

  // A record id, not a route segment.
  await expect(page).toHaveURL(/\/staff\/patients\/[a-z0-9]{20,}$/)
  const id = page.url().split('/').pop() ?? ''
  const name = (await page.getByRole('heading', { level: 1 }).textContent()) ?? ''
  return { id, name: name.trim() }
}

/**
 * Reloads until the entry turns up.
 *
 * Automatic capture is fire-and-forget by design (section 11.2): it must never sit on the
 * critical path of the request that triggered it, so the write lands a moment after the page it
 * came from has already rendered. A server-rendered list will not show it until the next request,
 * which is what this retries — not a flake to paper over, but the shape of the thing.
 */
async function eventually(page: Page, url: string, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url)
    await check()
  }).toPass({ timeout: 20_000, intervals: [500, 1000, 2000] })
}

test.describe('the audit log explorer', () => {
  test('answers who looked at a patient, and what changed', async ({ browser }) => {
    // Somebody at the front desk opens a chart. The capture plugin records the privileged read.
    const desk = await signedInAs(browser, 'staff@clinic.local')
    const patient = await openFirstPatient(desk)

    const admin = await signedInAs(browser, 'admin@clinic.local')

    // The whole question, as one address.
    await eventually(
      admin,
      `/admin/audit?entityType=Patient&entityId=${patient.id}&readsOnly=yes`,
      async () => {
        await expect(admin.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible()
        await expect(admin.getByRole('link', { name: 'patient.viewed' }).first()).toBeVisible({
          timeout: 2000,
        })
      },
    )

    // The answer to "who". Not "The system", which is what an unattributed read would show — and
    // what every server-rendered read recorded before the request context was fixed.
    await expect(admin.getByRole('link', { name: 'patient.viewed' }).first()).toBeVisible()
    await expect(admin.getByText('The system')).toHaveCount(0)

    // And "what did they change": the same filter without the reads-only switch.
    const changed = admin.getByRole('link', { name: /patient\.(created|updated)/ }).first()
    await eventually(admin, `/admin/audit?entityType=Patient&entityId=${patient.id}`, async () => {
      await expect(changed).toBeVisible({ timeout: 2000 })
    })
    await changed.click()

    await expect(admin).toHaveURL(/\/admin\/audit\/[a-z0-9]+$/)
    await expect(admin.getByRole('heading', { name: 'What changed' })).toBeVisible()
    // The hash is on the page, because an investigator needs to be able to quote it.
    await expect(admin.getByRole('heading', { name: 'Integrity' })).toBeVisible()
    await expect(admin.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible()
  })

  test('records the reading of it, which is the point', async ({ browser }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')

    // A filter nothing matches. It is still somebody looking, and still recorded.
    await admin.goto('/admin/audit?entityType=Nothing&entityId=does-not-exist')
    await expect(admin.getByText('Nothing matches')).toBeVisible()

    await admin.goto('/admin/audit?action=audit.viewed')
    await expect(admin.getByRole('link', { name: 'audit.viewed' }).first()).toBeVisible()
  })

  test('shows whether the chain still holds', async ({ browser }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/audit')
    // Quiet when healthy: a green banner on every visit becomes invisible within a week.
    await expect(admin.getByText(/entries verified — the chain is intact/)).toBeVisible()
  })

  test('is closed to everybody else, and the refusal is recorded', async ({ browser }) => {
    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/admin/audit')
    // Sent to a portal they can enter rather than shown a wall: somebody who typed /admin is
    // usually lost, not attacking.
    await expect(desk).toHaveURL(/\/staff/)

    const admin = await signedInAs(browser, 'admin@clinic.local')
    // The badge, not the filter's own <option> of the same word.
    await eventually(admin, '/admin/audit?outcome=DENIED', async () => {
      await expect(admin.getByTestId('audit-outcome').first()).toHaveText('Refused', {
        timeout: 2000,
      })
    })
  })

  test('exports the filtered view as a file', async ({ browser }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/audit?category=AUTH')

    const download = admin.waitForEvent('download')
    await admin.getByRole('button', { name: 'Export CSV' }).click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.csv$/)
  })
})

test.describe('the analytics dashboard', () => {
  test('shows the four questions it exists to answer', async ({ browser }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/analytics')

    await expect(admin.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible()
    for (const section of ['Money', 'Visits', 'Doctors', 'People']) {
      await expect(admin.getByRole('heading', { name: section, level: 2 })).toBeVisible()
    }

    // Money is money: a currency symbol and two decimal places, never a bare float.
    await expect(admin.getByText(/^\$\d[\d,]*\.\d{2}$/).first()).toBeVisible()
  })

  test('keeps the chosen range in the address, so it can be sent to somebody', async ({
    browser,
  }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/analytics')

    await admin.getByRole('button', { name: 'Last 7 days' }).click()
    await expect(admin).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/)

    // Seven days inclusive, not eight.
    const url = new URL(admin.url())
    const from = new Date(`${url.searchParams.get('from')}T00:00:00Z`)
    const to = new Date(`${url.searchParams.get('to')}T00:00:00Z`)
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(6)
  })

  test('refuses a backwards range instead of quietly swapping the ends', async ({ browser }) => {
    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/analytics?from=2026-03-31&to=2026-03-01')
    // A number quoted in a meeting must mean the range on the screen.
    await expect(admin.getByText(/went wrong|after its end/i).first()).toBeVisible()
  })

  test('is closed to the front desk', async ({ browser }) => {
    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/admin/analytics')
    await expect(desk).toHaveURL(/\/staff/)
  })
})
