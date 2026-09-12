import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { workingDate } from '../helpers/calendar'
import { seededDoctorId, seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Phase 6's exit criterion, end to end: consuming an item during a visit decrements stock,
 * writes a ledger row, and appears on the invoice — all in one transaction, and the ledger
 * explains the balance.
 */

/** One browser per person: a signed-in visitor who opens /login is sent to their own portal. */
async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, email, E2E.password)
  return page
}

/** An open visit for the named patient, through the API the workspace uses. */
async function openVisitFor(page: Page, patientId: string): Promise<string> {
  return page.evaluate(async (patientId) => {
    const response = await fetch('/api/v1/encounters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        patientId,
        appointmentId: null,
        encounterType: 'CONSULTATION',
        chiefComplaint: 'Vaccination',
      }),
    })
    const body = (await response.json()) as { data: { id: string } }
    return body.data.id
  }, patientId)
}

test.describe('inventory', () => {
  test('the front desk puts stock on the shelf and the ledger explains it', async ({ browser }) => {
    const sku = `E2E-${Date.now()}`
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto('/staff/inventory')

    // The seeded shelf is already there.
    await expect(page.getByRole('link', { name: /Influenza vaccine/ })).toBeVisible()

    await page.getByRole('button', { name: 'Add an item' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('SKU').fill(sku)
    await form.getByLabel('Unit').fill('bottle')
    await form.getByLabel('Name').fill('Antiseptic solution')
    await form.getByLabel('Charged at', { exact: true }).first().fill('15.00')
    await form.getByLabel('Reorder at').fill('4')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toBeHidden()

    // A new item holds nothing until something is delivered.
    await page.getByRole('link', { name: /Antiseptic solution/ }).click()
    await expect(page).toHaveURL(/\/staff\/inventory\//)
    await expect(page.getByText('Nothing in stock')).toBeVisible()

    await page.getByRole('button', { name: 'Receive stock' }).click()
    const delivery = page.getByRole('dialog')
    await delivery.getByLabel('How many (bottle)').fill('12')
    await delivery.getByLabel('Batch number').fill('ANT-001')
    await delivery.getByLabel('Expires').fill(workingDate(400))
    await delivery.getByRole('button', { name: 'Record it' }).click()
    await expect(delivery).toBeHidden()

    // The shelf, the batch and the ledger all say twelve.
    // The batch row says the number; the ledger row beneath says "batch ANT-001".
    await expect(page.getByText('ANT-001', { exact: true })).toBeVisible()
    await expect(page.getByTestId('ledger-total')).toContainText('12 bottle')
    await expect(page.getByText('Received').first()).toBeVisible()
    await page.context().close()
  })

  /**
   * The exit criterion. Three things move together, and the page proves each of them.
   */
  test('a visit uses a vial: stock down, ledger written, invoice charged', async ({ browser }) => {
    const patientId = await seededPatientId('Nassar')
    expect(await seededDoctorId()).not.toBe('')

    // What the shelf holds before.
    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/staff/inventory')
    const before = await desk.evaluate(async () => {
      const response = await fetch('/api/v1/inventory/items?status=active&view=all', {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as {
        data: Array<{ id: string; sku: string; quantityOnHand: string; salePrice: string | null }>
      }
      return body.data.find((item) => item.sku === 'VACC-FLU')
    })
    expect(before?.quantityOnHand).toBe('55.000')
    expect(before?.salePrice).toBe('22.00')

    const doctor = await signedInAs(browser, 'doctor@clinic.local')
    await doctor.goto('/doctor/patients')
    const encounterId = await openVisitFor(doctor, patientId)
    await doctor.goto(`/doctor/encounters/${encounterId}`)

    await expect(doctor.getByText('Nothing recorded yet')).toBeVisible()
    await doctor.getByRole('button', { name: 'Record what was used' }).click()
    const dialog = doctor.getByRole('dialog')
    // The option carries the count with it, so it is matched rather than named exactly.
    const fluOption = await dialog
      .getByLabel('Item')
      .locator('option')
      .filter({ hasText: 'Influenza vaccine' })
      .first()
      .getAttribute('value')
    await dialog.getByLabel('Item').selectOption(fluOption ?? '')
    await dialog.getByLabel(/How many/).fill('2')
    await dialog.getByLabel('Note').fill('Left deltoid')
    await dialog.getByRole('button', { name: 'Record it' }).click()
    await expect(dialog).toBeHidden()

    // The visit shows what it used, and what the shelf held afterwards.
    await expect(doctor.getByText('Influenza vaccine').first()).toBeVisible()
    await expect(doctor.getByText('Left deltoid')).toBeVisible()
    await doctor.context().close()

    // The shelf came down, and FEFO took it from the batch expiring soonest.
    await desk.reload()
    const after = await desk.evaluate(async () => {
      const items = await fetch('/api/v1/inventory/items?status=active&view=all', {
        credentials: 'same-origin',
      })
      const body = (await items.json()) as { data: Array<{ id: string; sku: string }> }
      const flu = body.data.find((item) => item.sku === 'VACC-FLU')
      const detail = await fetch(`/api/v1/inventory/items/${flu?.id}`, {
        credentials: 'same-origin',
      })
      const item = (await detail.json()) as {
        data: {
          id: string
          quantityOnHand: string
          batches: Array<{ batchNumber: string | null; quantity: string }>
        }
      }
      return item.data
    })
    expect(after.quantityOnHand).toBe('53.000')
    // FLU-A18 expires 2026-11-30, FLU-A21 in 2027: the sooner one gave up the two.
    expect(after.batches.find((batch) => batch.batchNumber === 'FLU-A18')?.quantity).toBe('13.000')
    expect(after.batches.find((batch) => batch.batchNumber === 'FLU-A21')?.quantity).toBe('40.000')

    // The ledger explains the balance: it reconciles on the item's own page.
    await desk.goto(`/staff/inventory/${after.id}`)
    await expect(desk.getByTestId('ledger-total')).toContainText('53 vial')
    await expect(desk.getByText('Used')).toBeVisible()
    await expect(desk.getByText(/Something moved without a movement/)).toHaveCount(0)

    // And the bill: two vials at 22.00.
    const invoice = await desk.evaluate(async (encounterId) => {
      const response = await fetch(`/api/v1/billing/invoices?encounterId=${encounterId}`, {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as {
        data: Array<{ id: string; total: string; status: string }>
      }
      return body.data[0]
    }, encounterId)
    expect(invoice?.status).toBe('DRAFT')
    expect(invoice?.total).toBe('44.00')

    // The bill is still a draft, so its lines are in the editor rather than set in print —
    // which is exactly right: the front desk can still change it before issuing.
    await desk.goto(`/staff/billing/${invoice?.id}`)
    await expect(desk.getByLabel('Description').first()).toHaveValue(/Influenza vaccine/)
    await expect(desk.getByLabel('Unit price').first()).toHaveValue('44.00')
    await expect(desk.getByText('$44.00').first()).toBeVisible()
    await desk.context().close()
  })

  test('the shelf refuses to go below zero, and says what is left', async ({ browser }) => {
    const patientId = await seededPatientId('Fakhoury')
    const doctor = await signedInAs(browser, 'doctor@clinic.local')
    await doctor.goto('/doctor/patients')
    const encounterId = await openVisitFor(doctor, patientId)

    // Lidocaine is seeded with six vials; asking for ten is refused, and nothing is written.
    const refused = await doctor.evaluate(async (encounterId) => {
      const items = await fetch('/api/v1/inventory/items?status=active&view=all', {
        credentials: 'same-origin',
      })
      const body = (await items.json()) as { data: Array<{ id: string; sku: string }> }
      const lidocaine = body.data.find((item) => item.sku === 'DRUG-LIDO-2')

      const response = await fetch(`/api/v1/encounters/${encounterId}/consumption`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          items: [{ itemId: lidocaine?.id, quantity: '10', batchId: null, note: null }],
        }),
      })
      const payload = (await response.json()) as { error?: { code?: string; message?: string } }

      const check = await fetch(`/api/v1/inventory/items/${lidocaine?.id}`, {
        credentials: 'same-origin',
      })
      const after = (await check.json()) as { data: { quantityOnHand: string } }
      return {
        status: response.status,
        code: payload.error?.code,
        message: payload.error?.message ?? '',
        onHand: after.data.quantityOnHand,
      }
    }, encounterId)

    expect(refused.status).toBe(422)
    expect(refused.code).toBe('INSUFFICIENT_STOCK')
    // The message names what is actually left, which is the number somebody needs.
    expect(refused.message).toContain('6 vial')
    expect(refused.onHand).toBe('6.000')
    await doctor.context().close()
  })

  test('writing stock off needs a reason, and the ledger keeps adding up', async ({ browser }) => {
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto('/staff/inventory')
    await page.getByRole('link', { name: /Lidocaine/ }).click()

    await page.getByRole('button', { name: 'Adjust' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('What happened').selectOption('WASTAGE')
    await dialog.getByLabel(/How many/).fill('2')

    // The button stays out of reach until a reason is given.
    await expect(dialog.getByRole('button', { name: 'Record it' })).toBeDisabled()
    await dialog.getByLabel('Reason').fill('Vial cracked in the fridge')
    await dialog.getByRole('button', { name: 'Record it' }).click()
    await expect(dialog).toBeHidden()

    await expect(page.getByText('Written off')).toBeVisible()
    await expect(page.getByText('Vial cracked in the fridge')).toBeVisible()
    await expect(page.getByTestId('ledger-total')).toContainText('4 vial')
    await expect(page.getByText(/Something moved without a movement/)).toHaveCount(0)

    // Four left against a reorder level of eight: the shelf now says so.
    await page.goto('/staff/inventory')
    await expect(page.getByTestId('stock-alerts')).toContainText('running low')
    await page.context().close()
  })
})
