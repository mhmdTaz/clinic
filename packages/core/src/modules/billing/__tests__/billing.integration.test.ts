import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { DoctorModel, PatientModel, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  outcome,
  signedInActor,
  everyPage,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { openEncounter } from '../../clinical'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import {
  accountStatement,
  createInvoice,
  createService,
  dailyReconciliation,
  getInvoice,
  issueInvoice,
  listInvoices,
  listPayments,
  listServices,
  recordPayment,
  refundPayment,
  updateInvoice,
  voidInvoice,
} from '../index'

const clinicId = () => env().CLINIC_ID

const line = (overrides: Record<string, unknown> = {}) => ({
  serviceId: null,
  description: 'Consultation',
  quantity: '1',
  unitPrice: '100.00',
  discount: '0',
  taxRatePercent: '0',
  ...overrides,
})

async function staffActor(): Promise<Actor> {
  return (await signedInActor({ role: 'staff' })).actor
}

async function doctorActor(): Promise<Actor> {
  const account = await createUser({ role: 'doctor', firstName: 'Nour', lastName: 'Haddad' })
  await DoctorModel().create({
    _id: newId(),
    clinicId: clinicId(),
    userId: account.id,
    title: 'Dr',
    licenseNumber: 'LB-MD-77012',
    consultationFee: '45.00',
    defaultSlotMinutes: 30,
    specialties: [],
    branchIds: [],
    isAcceptingNew: true,
    isActive: true,
  })
  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  return (await authenticateAccessToken(session.accessToken)).actor
}

async function patientOf(staff: Actor) {
  const account = await createUser({ role: 'patient', firstName: 'Rami', lastName: 'Aoun' })
  const registered = await registerPatient(staff, {
    firstName: 'Rami',
    lastName: `Aoun${newId().slice(0, 8)}`,
    dateOfBirth: null,
    gender: null,
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone: null, email: null },
    address: { line1: null, city: null, country: null },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
  })
  await PatientModel()
    .updateOne(
      { _id: registered.patient.id, clinicId: clinicId() },
      { $set: { userId: account.id } },
    )
    .setOptions({ skipAudit: true })
  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  const { actor } = await authenticateAccessToken(session.accessToken)
  return { actor, patient: registered.patient, account }
}

/** An issued invoice for `total`, ready to take money. */
async function issuedInvoice(staff: Actor, patientId: string, unitPrice = '100.00') {
  const draft = await createInvoice(staff, {
    patientId,
    encounterId: null,
    branchId: null,
    lines: [line({ unitPrice })],
    notes: null,
  })
  return issueInvoice(staff, draft.id, { dueAt: null })
}

describe('the service catalogue', () => {
  it('refuses a price the currency cannot express', async () => {
    const admin = (await signedInActor({ role: 'admin' })).actor
    expect(
      await outcome(
        createService(admin, {
          name: `Odd price ${newId().slice(0, 6)}`,
          description: null,
          price: '45.005',
          taxRatePercent: '0',
          durationMinutes: null,
          isActive: true,
        }),
      ),
    ).toBe('VALIDATION_FAILED')
  })

  it('refuses a second service with the same folded name', async () => {
    const admin = (await signedInActor({ role: 'admin' })).actor
    const name = `X-ray ${newId().slice(0, 6)}`
    const input = {
      name,
      description: null,
      price: '80.00',
      taxRatePercent: '11',
      durationMinutes: 20,
      isActive: true,
    }
    const created = await createService(admin, input)
    expect(created.price).toBe('80.00')
    expect(created.currency).toBe('USD')

    expect(
      await outcome(createService(admin, { ...input, name: `  ${name.toUpperCase()} ` })),
    ).toBe('SERVICE_EXISTS')
  })

  it('is readable by the front desk and writable only by an administrator', async () => {
    const staff = await staffActor()
    expect(Array.isArray(await listServices(staff, { status: 'active' }))).toBe(true)
    expect(
      await outcome(
        createService(staff, {
          name: `Nope ${newId().slice(0, 6)}`,
          description: null,
          price: '10.00',
          taxRatePercent: '0',
          durationMinutes: null,
          isActive: true,
        }),
      ),
    ).toBe('FORBIDDEN')
  })
})

describe('an invoice', () => {
  it('is drawn from a visit, seeded with the doctor’s consultation fee', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)

    const visit = await openEncounter(doctor, {
      patientId: patient.id,
      appointmentId: null,
      encounterType: 'CONSULTATION',
      chiefComplaint: 'Sore throat',
    })

    const invoice = await createInvoice(staff, {
      patientId: patient.id,
      encounterId: visit.id,
      branchId: null,
      lines: [],
      notes: null,
    })

    expect(invoice.status).toBe('DRAFT')
    expect(invoice.encounterId).toBe(visit.id)
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]?.unitPrice).toBe('45.00')
    expect(invoice.total).toBe('45.00')
    expect(invoice.balanceDue).toBe('45.00')
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6}$/)

    // A second draft for the same visit is the double-billing mistake; a later, separate bill
    // for the same visit is not, so only an open draft blocks.
    expect(
      await outcome(
        createInvoice(staff, {
          patientId: patient.id,
          encounterId: visit.id,
          branchId: null,
          lines: [],
          notes: null,
        }),
      ),
    ).toBe('INVOICE_DRAFT_EXISTS')
  })

  it('sums its lines to the cent, whatever the rates', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)

    const invoice = await createInvoice(staff, {
      patientId: patient.id,
      encounterId: null,
      branchId: null,
      lines: [
        line({ description: 'Panel', unitPrice: '33.33', quantity: '3', taxRatePercent: '8.25' }),
        line({ description: 'Physio', unitPrice: '19.99', quantity: '1.5', discount: '2.50' }),
      ],
      notes: null,
    })

    expect(invoice.lines.map((row) => row.lineTotal)).toEqual(['108.24', '27.49'])
    expect(invoice.subtotal).toBe('129.98')
    expect(invoice.total).toBe('135.73')
    expect(invoice.balanceDue).toBe('135.73')
  })

  it('is editable while a draft and frozen once issued', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)

    const draft = await createInvoice(staff, {
      patientId: patient.id,
      encounterId: null,
      branchId: null,
      lines: [line()],
      notes: null,
    })
    const edited = await updateInvoice(staff, draft.id, { lines: [line({ unitPrice: '120.00' })] })
    expect(edited.total).toBe('120.00')
    expect(edited.balanceDue).toBe('120.00')

    const issued = await issueInvoice(staff, draft.id, { dueAt: null })
    expect(issued.status).toBe('ISSUED')
    expect(issued.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(await outcome(updateInvoice(staff, draft.id, { notes: 'too late' }))).toBe(
      'INVOICE_NOT_EDITABLE',
    )
    expect(await outcome(issueInvoice(staff, draft.id, { dueAt: null }))).toBe('INVOICE_NOT_DRAFT')
  })

  it('refuses a discount larger than the line it is on', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    expect(
      await outcome(
        createInvoice(staff, {
          patientId: patient.id,
          encounterId: null,
          branchId: null,
          lines: [line({ unitPrice: '50.00', discount: '50.01' })],
          notes: null,
        }),
      ),
    ).toBe('VALIDATION_FAILED')
  })

  it('is voided with a reason, and never once money is on it', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)

    const issued = await issuedInvoice(staff, patient.id)
    const voided = await voidInvoice(staff, issued.id, { reason: 'Billed in error' })
    expect(voided.status).toBe('VOID')
    expect(voided.voidReason).toBe('Billed in error')
    expect(voided.voidedAt).not.toBeNull()

    const paid = await issuedInvoice(staff, patient.id)
    await recordPayment(staff, {
      patientId: patient.id,
      amount: '10.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: paid.id, amount: '10.00' }],
      idempotencyKey: newId(),
    })
    expect(await outcome(voidInvoice(staff, paid.id, { reason: 'changed my mind' }))).toBe(
      'INVOICE_HAS_PAYMENTS',
    )
  })
})

describe('taking money', () => {
  /** Phase 5's exit criterion: a partial payment leaves a correct balance. */
  it('moves an invoice to PARTIALLY_PAID with the right balance, then to PAID', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const invoice = await issuedInvoice(staff, patient.id, '150.00')

    await recordPayment(staff, {
      patientId: patient.id,
      amount: '60.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '60.00' }],
      idempotencyKey: newId(),
    })

    const part = await getInvoice(staff, invoice.id)
    expect(part.status).toBe('PARTIALLY_PAID')
    expect(part.amountPaid).toBe('60.00')
    expect(part.balanceDue).toBe('90.00')

    await recordPayment(staff, {
      patientId: patient.id,
      amount: '90.00',
      method: 'CARD',
      reference: '4242',
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '90.00' }],
      idempotencyKey: newId(),
    })

    const settled = await getInvoice(staff, invoice.id)
    expect(settled.status).toBe('PAID')
    expect(settled.balanceDue).toBe('0.00')
  })

  /**
   * Phase 5's exit criterion, and the reason for ADR-0028: the same idempotency key twice is
   * one payment. Both calls are launched together, so the second does not merely find a
   * committed row — it races the first and has to lose on the unique index.
   */
  it('creates one row for a double-clicked payment', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const invoice = await issuedInvoice(staff, patient.id, '80.00')

    const request = {
      patientId: patient.id,
      amount: '80.00',
      method: 'CASH' as const,
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '80.00' }],
      idempotencyKey: newId(),
    }

    const [first, second] = await Promise.all([
      recordPayment(staff, request),
      recordPayment(staff, request),
    ])

    expect(second.id).toBe(first.id)
    expect(second.number).toBe(first.number)

    const payments = await everyPage((page) =>
      listPayments(staff, { invoiceId: invoice.id, ...page }),
    )
    expect(payments).toHaveLength(1)

    const settled = await getInvoice(staff, invoice.id)
    expect(settled.status).toBe('PAID')
    expect(settled.amountPaid).toBe('80.00')
    expect(settled.balanceDue).toBe('0.00')
  })

  it('refuses to take more than an invoice owes', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const invoice = await issuedInvoice(staff, patient.id, '40.00')

    expect(
      await outcome(
        recordPayment(staff, {
          patientId: patient.id,
          amount: '50.00',
          method: 'CASH',
          reference: null,
          note: null,
          allocations: [{ invoiceId: invoice.id, amount: '50.00' }],
          idempotencyKey: newId(),
        }),
      ),
    ).toBe('OVERPAYMENT')

    // Nothing was written: the invoice is untouched.
    expect((await getInvoice(staff, invoice.id)).balanceDue).toBe('40.00')
  })

  it('refuses a payment that does not add up to what it settles', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const invoice = await issuedInvoice(staff, patient.id, '40.00')

    expect(
      await outcome(
        recordPayment(staff, {
          patientId: patient.id,
          amount: '40.00',
          method: 'CASH',
          reference: null,
          note: null,
          allocations: [{ invoiceId: invoice.id, amount: '30.00' }],
          idempotencyKey: newId(),
        }),
      ),
    ).toBe('VALIDATION_FAILED')
  })

  it('refuses a draft, and refuses somebody else’s bill', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const other = await patientOf(staff)

    const draft = await createInvoice(staff, {
      patientId: patient.id,
      encounterId: null,
      branchId: null,
      lines: [line()],
      notes: null,
    })
    expect(
      await outcome(
        recordPayment(staff, {
          patientId: patient.id,
          amount: '100.00',
          method: 'CASH',
          reference: null,
          note: null,
          allocations: [{ invoiceId: draft.id, amount: '100.00' }],
          idempotencyKey: newId(),
        }),
      ),
    ).toBe('INVOICE_NOT_PAYABLE')

    const issued = await issuedInvoice(staff, patient.id)
    expect(
      await outcome(
        recordPayment(staff, {
          patientId: other.patient.id,
          amount: '100.00',
          method: 'CASH',
          reference: null,
          note: null,
          allocations: [{ invoiceId: issued.id, amount: '100.00' }],
          idempotencyKey: newId(),
        }),
      ),
    ).toBe('INVOICE_PATIENT_MISMATCH')
  })

  it('settles two invoices with one payment', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const first = await issuedInvoice(staff, patient.id, '30.00')
    const second = await issuedInvoice(staff, patient.id, '70.00')

    const payment = await recordPayment(staff, {
      patientId: patient.id,
      amount: '100.00',
      method: 'TRANSFER',
      reference: 'WIRE-88',
      note: null,
      allocations: [
        { invoiceId: first.id, amount: '30.00' },
        { invoiceId: second.id, amount: '70.00' },
      ],
      idempotencyKey: newId(),
    })

    expect(payment.allocations).toHaveLength(2)
    expect(payment.allocations[0]?.invoiceNumber).toBe(first.number)
    expect((await getInvoice(staff, first.id)).status).toBe('PAID')
    expect((await getInvoice(staff, second.id)).status).toBe('PAID')
  })
})

describe('giving money back', () => {
  it('unwinds the last invoice the payment settled, and puts the balance back', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const first = await issuedInvoice(staff, patient.id, '30.00')
    const second = await issuedInvoice(staff, patient.id, '70.00')

    const payment = await recordPayment(staff, {
      patientId: patient.id,
      amount: '100.00',
      method: 'CARD',
      reference: null,
      note: null,
      allocations: [
        { invoiceId: first.id, amount: '30.00' },
        { invoiceId: second.id, amount: '70.00' },
      ],
      idempotencyKey: newId(),
    })

    const refunded = await refundPayment(staff, payment.id, {
      amount: '20.00',
      reason: 'Test cancelled',
    })
    expect(refunded.status).toBe('PARTIALLY_REFUNDED')
    expect(refunded.refundedAmount).toBe('20.00')

    // It came off the second invoice, the one settled last.
    expect((await getInvoice(staff, first.id)).status).toBe('PAID')
    const reopened = await getInvoice(staff, second.id)
    expect(reopened.status).toBe('PARTIALLY_PAID')
    expect(reopened.amountPaid).toBe('50.00')
    expect(reopened.balanceDue).toBe('20.00')
  })

  it('returns an invoice to ISSUED when everything it took comes back', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const invoice = await issuedInvoice(staff, patient.id, '45.00')

    const payment = await recordPayment(staff, {
      patientId: patient.id,
      amount: '45.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '45.00' }],
      idempotencyKey: newId(),
    })

    const refunded = await refundPayment(staff, payment.id, {
      amount: '45.00',
      reason: 'Duplicate',
    })
    expect(refunded.status).toBe('REFUNDED')

    const reopened = await getInvoice(staff, invoice.id)
    expect(reopened.status).toBe('ISSUED')
    expect(reopened.amountPaid).toBe('0.00')
    expect(reopened.balanceDue).toBe('45.00')
  })

  it('refuses to give back more than was ever taken', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const invoice = await issuedInvoice(staff, patient.id, '45.00')

    const payment = await recordPayment(staff, {
      patientId: patient.id,
      amount: '45.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '45.00' }],
      idempotencyKey: newId(),
    })

    await refundPayment(staff, payment.id, { amount: '20.00', reason: 'Part refund' })
    expect(
      await outcome(refundPayment(staff, payment.id, { amount: '30.00', reason: 'Too much' })),
    ).toBe('REFUND_EXCEEDS_PAYMENT')
  })
})

describe('who may look', () => {
  it('shows a patient their own account and nobody else’s', async () => {
    const staff = await staffActor()
    const mine = await patientOf(staff)
    const theirs = await patientOf(staff)

    const invoice = await issuedInvoice(staff, mine.patient.id, '55.00')
    await recordPayment(staff, {
      patientId: mine.patient.id,
      amount: '25.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: invoice.id, amount: '25.00' }],
      idempotencyKey: newId(),
    })
    await issuedInvoice(staff, theirs.patient.id, '999.00')

    const statement = await accountStatement(mine.actor, undefined)
    expect(statement.invoiced).toBe('55.00')
    expect(statement.paid).toBe('25.00')
    expect(statement.outstanding).toBe('30.00')
    expect(statement.invoices).toHaveLength(1)
    expect(statement.payments).toHaveLength(1)

    // Naming somebody else changes nothing: an OWN grant narrows to the actor's own patient.
    const narrowed = await accountStatement(mine.actor, theirs.patient.id)
    expect(narrowed.invoices.every((row) => row.patient.id === mine.patient.id)).toBe(true)

    const visible = await everyPage((page) => listInvoices(mine.actor, page))
    expect(visible.map((row) => row.id)).toEqual([invoice.id])
  })

  it('refuses a patient the clinic’s day', async () => {
    const staff = await staffActor()
    const { actor } = await patientOf(staff)
    expect(await outcome(dailyReconciliation(actor, { date: '2026-09-14' }))).toBe('FORBIDDEN')
  })

  it('refuses a doctor a chart they have not treated', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    await issuedInvoice(staff, patient.id)

    // The doctor role holds no invoice grant at all, so the read is refused outright.
    expect(await outcome(listInvoices(doctor, { patientId: patient.id }))).toBe('FORBIDDEN')
  })
})

describe('the day’s money', () => {
  /** Phase 5's last exit criterion: the report reconciles to the cent. */
  it('reconciles takings, refunds and the net, per method and in total', async () => {
    const staff = await staffActor()
    const { patient } = await patientOf(staff)
    const today = new Date().toISOString().slice(0, 10)

    const before = await dailyReconciliation(staff, { date: today })

    const cash = await issuedInvoice(staff, patient.id, '60.00')
    const card = await issuedInvoice(staff, patient.id, '40.00')
    await recordPayment(staff, {
      patientId: patient.id,
      amount: '60.00',
      method: 'CASH',
      reference: null,
      note: null,
      allocations: [{ invoiceId: cash.id, amount: '60.00' }],
      idempotencyKey: newId(),
    })
    const cardPayment = await recordPayment(staff, {
      patientId: patient.id,
      amount: '40.00',
      method: 'CARD',
      reference: null,
      note: null,
      allocations: [{ invoiceId: card.id, amount: '40.00' }],
      idempotencyKey: newId(),
    })
    await refundPayment(staff, cardPayment.id, { amount: '15.00', reason: 'Partly cancelled' })

    const after = await dailyReconciliation(staff, { date: today })

    // Every method the clinic accepts is a row, including the ones that took nothing.
    expect(after.byMethod.map((row) => row.method)).toEqual([
      'CASH',
      'CARD',
      'TRANSFER',
      'INSURANCE',
    ])

    const delta = (method: string, field: 'taken' | 'refunded' | 'net') => {
      const now = Number(after.byMethod.find((row) => row.method === method)?.[field] ?? 0)
      const then = Number(before.byMethod.find((row) => row.method === method)?.[field] ?? 0)
      return (now - then).toFixed(2)
    }
    expect(delta('CASH', 'taken')).toBe('60.00')
    expect(delta('CARD', 'taken')).toBe('40.00')
    // A card refund reduces the card column, not the cash drawer.
    expect(delta('CARD', 'refunded')).toBe('15.00')
    expect(delta('CASH', 'refunded')).toBe('0.00')
    expect(delta('CARD', 'net')).toBe('25.00')

    // The footer is the sum of the rows, exactly — not a second, independent calculation.
    const sum = (field: 'taken' | 'refunded' | 'net') =>
      after.byMethod.reduce((total, row) => total + Number(row[field]), 0).toFixed(2)
    expect(after.taken).toBe(sum('taken'))
    expect(after.refunded).toBe(sum('refunded'))
    expect(after.net).toBe(sum('net'))
    expect(Number(after.net).toFixed(2)).toBe(
      (Number(after.taken) - Number(after.refunded)).toFixed(2),
    )
    expect(after.count).toBe(after.byMethod.reduce((total, row) => total + row.count, 0))
  })
})
