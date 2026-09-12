import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { seededPatientId } from '../helpers/database'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * Phase 5's exit criteria, end to end: a visit produces an invoice; a partial payment moves it to
 * PARTIALLY_PAID with a correct balance; a double-clicked payment creates one row; and the day's
 * report reconciles to the cent.
 */

/** One browser per person: a signed-in visitor who opens /login is sent to their own portal. */
async function signedInAs(browser: Browser, email: string): Promise<Page> {
  const page = await newPersonPage(browser)
  await signIn(page, email, E2E.password)
  return page
}

/** An issued invoice for the named patient, drawn through the API the screens use. */
async function issueInvoiceFor(
  page: Page,
  patientId: string,
  unitPrice: string,
): Promise<{ id: string; number: string; total: string }> {
  return page.evaluate(
    async ({ patientId, unitPrice }) => {
      const draft = await fetch('/api/v1/billing/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          patientId,
          encounterId: null,
          branchId: null,
          lines: [
            {
              serviceId: null,
              description: 'Consultation',
              quantity: '1',
              unitPrice,
              discount: '0',
              taxRatePercent: '0',
            },
          ],
          notes: null,
        }),
      })
      const created = (await draft.json()) as { data: { id: string } }
      const issued = await fetch(`/api/v1/billing/invoices/${created.data.id}/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dueAt: null }),
      })
      const body = (await issued.json()) as {
        data: { id: string; number: string; total: string }
      }
      return body.data
    },
    { patientId, unitPrice },
  )
}

test.describe('billing', () => {
  test('a visit becomes a bill, and the front desk settles it in two payments', async ({
    browser,
  }) => {
    const patientId = await seededPatientId('Fakhoury')

    // A visit to bill. The doctor opens it; the front desk is what turns it into money.
    const doctor = await signedInAs(browser, 'doctor@clinic.local')
    await doctor.goto('/doctor/patients')
    const opened = await doctor.evaluate(async (patientId) => {
      const response = await fetch('/api/v1/encounters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          patientId,
          appointmentId: null,
          encounterType: 'CONSULTATION',
          chiefComplaint: 'Knee pain',
        }),
      })
      return response.status
    }, patientId)
    expect(opened).toBe(201)
    await doctor.context().close()

    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto(`/staff/patients/${patientId}`)

    // Billing a visit seeds the draft from the doctor's consultation fee.
    await page.getByRole('button', { name: 'New bill' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/consultation fee/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Create draft' }).click()

    await expect(page).toHaveURL(/\/staff\/billing\//)
    await expect(page.getByTestId('invoice-status')).toContainText('Draft')

    // The editor previews the total with the same arithmetic the server uses.
    const unitPrice = page.getByLabel('Unit price').first()
    await expect(unitPrice).toHaveValue('40.00')
    await unitPrice.fill('150.00')
    await page.getByLabel('Quantity').first().fill('1')
    await expect(page.getByText('$150.00').first()).toBeVisible()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    // Issuing freezes the lines: the editor is gone, not merely disabled.
    await page.getByRole('button', { name: 'Issue' }).click()
    await expect(page.getByTestId('invoice-status')).toContainText('Issued')
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
    await expect(page.getByLabel('Unit price')).toHaveCount(0)

    // A partial payment leaves a correct balance.
    await page.getByRole('button', { name: 'Take payment' }).click()
    const takeDialog = page.getByRole('dialog')
    await expect(takeDialog.getByLabel('Amount')).toHaveValue('150.00')
    await takeDialog.getByLabel('Amount').fill('60.00')
    await takeDialog.getByRole('button', { name: 'Take it' }).click()
    await expect(takeDialog).toBeHidden()

    await expect(page.getByTestId('invoice-status')).toContainText('Part paid')
    await expect(page.getByTestId('invoice-balance')).toContainText('$90.00')

    // And the rest settles it.
    await page.getByRole('button', { name: 'Take payment' }).click()
    const rest = page.getByRole('dialog')
    await expect(rest.getByLabel('Amount')).toHaveValue('90.00')
    await rest.getByRole('button', { name: 'Take it' }).click()
    await expect(rest).toBeHidden()

    await expect(page.getByTestId('invoice-status')).toHaveText('Paid')
    await expect(page.getByRole('button', { name: 'Take payment' })).toHaveCount(0)
    await page.context().close()
  })

  /**
   * The exit criterion ADR-0028 exists for. Both requests carry the same idempotency key and are
   * fired together, so the second does not merely find a committed row — it races the first and
   * has to lose on the unique index.
   */
  test('a double-clicked payment creates one row', async ({ browser }) => {
    const patientId = await seededPatientId('Nassar')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto('/staff/billing')

    const invoice = await issueInvoiceFor(page, patientId, '80.00')

    const result = await page.evaluate(
      async ({ patientId, invoiceId }) => {
        const body = JSON.stringify({
          patientId,
          amount: '80.00',
          method: 'CASH',
          reference: null,
          note: null,
          allocations: [{ invoiceId, amount: '80.00' }],
          idempotencyKey: crypto.randomUUID(),
        })
        const send = () =>
          fetch('/api/v1/billing/payments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body,
          }).then(async (response) => {
            const payload = (await response.json()) as { data?: { id?: string } }
            return payload.data?.id ?? ''
          })

        const [first, second] = await Promise.all([send(), send()])
        const listed = await fetch(`/api/v1/billing/payments?invoiceId=${invoiceId}`, {
          credentials: 'same-origin',
        })
        const payments = (await listed.json()) as { data: Array<{ id: string }> }
        return { first, second, count: payments.data.length }
      },
      { patientId, invoiceId: invoice.id },
    )

    expect(result.first).not.toBe('')
    expect(result.second).toBe(result.first)
    expect(result.count).toBe(1)

    // The money moved exactly once: the invoice is settled, not overpaid.
    await page.goto(`/staff/billing/${invoice.id}`)
    await expect(page.getByTestId('invoice-status')).toHaveText('Paid')
    await expect(page.getByTestId('invoice-balance')).toContainText('$0.00')
    await page.context().close()
  })

  test('the day’s report reconciles, and a refund lands on the right method', async ({
    browser,
  }) => {
    const patientId = await seededPatientId('Haddad')
    const page = await signedInAs(browser, 'staff@clinic.local')
    await page.goto('/staff/billing')

    const readReport = (target: Page) =>
      target.evaluate(async () => {
        const today = new Date().toISOString().slice(0, 10)
        const response = await fetch(`/api/v1/billing/reports/daily?date=${today}`, {
          credentials: 'same-origin',
        })
        const body = (await response.json()) as {
          data: {
            taken: string
            refunded: string
            net: string
            byMethod: Array<{ method: string; taken: string; refunded: string; net: string }>
          }
        }
        return body.data
      })

    const before = await readReport(page)
    const cash = await issueInvoiceFor(page, patientId, '60.00')
    const card = await issueInvoiceFor(page, patientId, '40.00')

    const cardPaymentId = await page.evaluate(
      async ({ patientId, cashId, cardId }) => {
        const take = async (invoiceId: string, amount: string, method: string) => {
          const response = await fetch('/api/v1/billing/payments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              patientId,
              amount,
              method,
              reference: null,
              note: null,
              allocations: [{ invoiceId, amount }],
              idempotencyKey: crypto.randomUUID(),
            }),
          })
          const body = (await response.json()) as { data: { id: string } }
          return body.data.id
        }
        await take(cashId, '60.00', 'CASH')
        return take(cardId, '40.00', 'CARD')
      },
      { patientId, cashId: cash.id, cardId: card.id },
    )

    // Refunding on the invoice page, through the screen a cashier would use.
    await page.goto(`/staff/billing/${card.id}`)
    await page.getByRole('button', { name: 'Refund' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Amount').fill('15.00')
    await dialog.getByLabel('Reason').fill('Test cancelled')
    await dialog.getByRole('button', { name: 'Refund it' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('payment-status')).toHaveText('Part refunded')
    await expect(page.getByTestId('invoice-status')).toContainText('Part paid')

    expect(cardPaymentId).not.toBe('')

    // The report: a card refund reduces the card column, never the cash drawer, and the footer
    // is the sum of the rows to the cent.
    await page.goto('/staff/billing/day')
    const report = await readReport(page)

    // Measured as a change, so a retry against a database an earlier attempt already wrote to
    // still asserts what this test did rather than what the day happens to hold.
    const moved = (method: string, field: 'taken' | 'refunded' | 'net') => {
      const now = Number(report.byMethod.find((row) => row.method === method)?.[field] ?? 0)
      const then = Number(before.byMethod.find((row) => row.method === method)?.[field] ?? 0)
      return (now - then).toFixed(2)
    }
    expect(moved('CASH', 'taken')).toBe('60.00')
    expect(moved('CARD', 'taken')).toBe('40.00')
    expect(moved('CARD', 'refunded')).toBe('15.00')
    expect(moved('CASH', 'refunded')).toBe('0.00')
    expect(moved('CARD', 'net')).toBe('25.00')

    const sum = (field: 'taken' | 'refunded' | 'net') =>
      report.byMethod.reduce((total, row) => total + Number(row[field]), 0).toFixed(2)
    expect(report.taken).toBe(sum('taken'))
    expect(report.refunded).toBe(sum('refunded'))
    expect(report.net).toBe(sum('net'))
    expect(report.net).toBe((Number(report.taken) - Number(report.refunded)).toFixed(2))

    // And the screen shows the same net the API computed.
    await page.reload()
    await expect(page.getByTestId('day-net')).toContainText(
      new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(
        Number(report.net),
      ),
    )
    await page.context().close()
  })

  test('a patient sees their own account and prints their own bill', async ({ browser }) => {
    const patientId = await seededPatientId('Karam')
    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/staff/billing')
    const invoice = await issueInvoiceFor(desk, patientId, '55.00')
    await desk.evaluate(
      async ({ patientId, invoiceId }) => {
        await fetch('/api/v1/billing/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            patientId,
            amount: '25.00',
            method: 'CASH',
            reference: null,
            note: null,
            allocations: [{ invoiceId, amount: '25.00' }],
            idempotencyKey: crypto.randomUUID(),
          }),
        })
      },
      { patientId, invoiceId: invoice.id },
    )
    await desk.context().close()

    const patient = await signedInAs(browser, 'patient@clinic.local')
    await patient.goto('/patient/billing')

    await expect(patient.getByText(invoice.number)).toBeVisible()
    await expect(patient.getByTestId('statement-outstanding')).toContainText('$30.00')
    await expect(patient.getByTestId('invoice-status').first()).toContainText('Part paid')

    // The printable copy is a real PDF, served from object storage rather than through the app.
    const link = await patient.evaluate(async (invoiceId) => {
      const response = await fetch(`/api/v1/billing/invoices/${invoiceId}/pdf`, {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as { data?: { url?: string } }
      return body.data?.url ?? ''
    }, invoice.id)
    expect(link).toContain('http')

    const pdf = await patient.request.get(link)
    expect(pdf.ok()).toBe(true)
    const header = new TextDecoder().decode((await pdf.body()).slice(0, 5))
    expect(header).toBe('%PDF-')

    await patient.context().close()
  })

  test('an administrator prices a service and the front desk bills it', async ({ browser }) => {
    const name = `Ultrasound ${Date.now()}`

    const admin = await signedInAs(browser, 'admin@clinic.local')
    await admin.goto('/admin/services')
    await admin.getByRole('button', { name: 'Add a service' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Price').fill('120.00')
    await dialog.getByLabel('Tax %').fill('11')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(admin.getByText(name)).toBeVisible()
    await expect(admin.getByText('$120.00')).toBeVisible()
    await admin.context().close()

    // The front desk picks it off the list, and the line takes the price and the tax with it.
    const patientId = await seededPatientId('Karam')
    const desk = await signedInAs(browser, 'staff@clinic.local')
    await desk.goto('/staff/billing')
    const draftId = await desk.evaluate(async (patientId) => {
      const response = await fetch('/api/v1/billing/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          patientId,
          encounterId: null,
          branchId: null,
          lines: [
            {
              serviceId: null,
              description: 'Placeholder',
              quantity: '1',
              unitPrice: '1.00',
              discount: '0',
              taxRatePercent: '0',
            },
          ],
          notes: null,
        }),
      })
      const body = (await response.json()) as { data: { id: string } }
      return body.data.id
    }, patientId)

    await desk.goto(`/staff/billing/${draftId}`)
    await desk.getByLabel('Service').first().selectOption({ label: name })
    await expect(desk.getByLabel('Unit price').first()).toHaveValue('120.00')
    await expect(desk.getByLabel('Tax %').first()).toHaveValue('11')
    // 120.00 + 11% tax, rounded once: the preview says what the invoice will say.
    await expect(desk.getByText('$133.20').first()).toBeVisible()

    await desk.getByRole('button', { name: 'Save draft' }).click()
    await expect(desk.getByText('Saved.')).toBeVisible()
    await desk.reload()
    await expect(desk.getByLabel('Unit price').first()).toHaveValue('120.00')
    await desk.context().close()
  })
})
