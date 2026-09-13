import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import type { InventoryItemInput } from '@clinic/contracts'
import { DoctorModel, InventoryItemModel, PatientModel, decimal128, newId } from '@clinic/db'
import {
  TEST_PASSWORD,
  createUser,
  meta,
  outcome,
  signedInActor,
  everyPage,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { getInvoice, listInvoices } from '../../billing'
import { openEncounter } from '../../clinical'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import {
  adjustStock,
  createItem,
  getItem,
  listItems,
  listMovements,
  receiveStock,
  reconcileItem,
  recordConsumption,
  stockAlerts,
} from '../index'

const clinicId = () => env().CLINIC_ID
const uniqueSku = () => `SKU-${newId().slice(0, 10).toUpperCase()}`

async function staffActor(): Promise<Actor> {
  return (await signedInActor({ role: 'staff' })).actor
}

async function doctorActor(): Promise<Actor> {
  const account = await createUser({ role: 'doctor', firstName: 'Yara', lastName: 'Sleiman' })
  await DoctorModel().create({
    _id: newId(),
    clinicId: clinicId(),
    userId: account.id,
    title: 'Dr',
    licenseNumber: 'LB-MD-90311',
    consultationFee: '50.00',
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
  const account = await createUser({ role: 'patient', firstName: 'Tarek', lastName: 'Daher' })
  const registered = await registerPatient(staff, {
    firstName: 'Tarek',
    lastName: `Daher${newId().slice(0, 8)}`,
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
  return { actor: staff, patient: registered.patient }
}

const ITEM: Omit<InventoryItemInput, 'sku' | 'name'> = {
  description: null,
  categoryId: null,
  supplierId: null,
  unit: 'vial',
  costPrice: '4.00',
  salePrice: '12.00',
  reorderLevel: '5',
  isTracked: true,
  isBillable: true,
  isActive: true,
}

/** An item with `quantity` on the shelf, delivered as one batch. */
async function stockedItem(
  staff: Actor,
  quantity: string,
  overrides: Partial<typeof ITEM> & { expiresAt?: string | null; batchNumber?: string } = {},
) {
  const { expiresAt = '2027-06-30', batchNumber, ...itemOverrides } = overrides
  const item = await createItem(staff, {
    ...ITEM,
    ...itemOverrides,
    sku: uniqueSku(),
    name: `Test item ${newId().slice(0, 6)}`,
  })
  if (item.isTracked) {
    await receiveStock(staff, item.id, {
      quantity,
      batchNumber: batchNumber ?? 'BATCH-1',
      expiresAt,
      costPrice: '4.00',
      supplierId: null,
      reference: null,
      note: null,
    })
  }
  return item
}

async function visitFor(doctor: Actor, patientId: string) {
  return openEncounter(doctor, {
    patientId,
    appointmentId: null,
    encounterType: 'CONSULTATION',
    chiefComplaint: 'Vaccination',
  })
}

describe('stock coming in', () => {
  it('puts a batch on the shelf and writes the ledger row that explains it', async () => {
    const staff = await staffActor()
    const item = await createItem(staff, { ...ITEM, sku: uniqueSku(), name: 'Influenza vaccine' })
    // Three places, always: a new item reads the same way as one that has seen a hundred
    // movements, whatever scale its Decimal128 happens to be stored at.
    expect(item.quantityOnHand).toBe('0.000')

    const movement = await receiveStock(staff, item.id, {
      quantity: '40',
      batchNumber: 'FLU-A21',
      expiresAt: '2027-03-31',
      costPrice: '8.50',
      supplierId: null,
      reference: 'DN-4471',
      note: null,
    })

    expect(movement.type).toBe('RECEIPT')
    expect(movement.quantity).toBe('40.000')
    expect(movement.balanceAfter).toBe('40.000')
    expect(movement.reference).toBe('DN-4471')

    const stocked = await getItem(staff, item.id)
    expect(stocked.quantityOnHand).toBe('40.000')
    expect(stocked.batches).toHaveLength(1)
    expect(stocked.batches[0]?.batchNumber).toBe('FLU-A21')
  })

  /** One batch number, one row: what keeps the embedded array bounded (section 8.2). */
  it('tops up a batch it already holds rather than adding a second row', async () => {
    const staff = await staffActor()
    const item = await stockedItem(staff, '10', { batchNumber: 'LOT-9' })

    await receiveStock(staff, item.id, {
      quantity: '5',
      batchNumber: 'LOT-9',
      expiresAt: '2027-06-30',
      costPrice: '4.00',
      supplierId: null,
      reference: null,
      note: null,
    })

    const stocked = await getItem(staff, item.id)
    expect(stocked.batches).toHaveLength(1)
    expect(stocked.batches[0]?.quantity).toBe('15.000')
    expect(stocked.quantityOnHand).toBe('15.000')
  })

  it('keeps a different expiry as its own batch, same number or not', async () => {
    const staff = await staffActor()
    const item = await stockedItem(staff, '10', { batchNumber: 'LOT-9', expiresAt: '2027-06-30' })

    await receiveStock(staff, item.id, {
      quantity: '5',
      batchNumber: 'LOT-9',
      expiresAt: '2028-01-31',
      costPrice: '4.00',
      supplierId: null,
      reference: null,
      note: null,
    })

    const stocked = await getItem(staff, item.id)
    expect(stocked.batches).toHaveLength(2)
    expect(stocked.quantityOnHand).toBe('15.000')
  })

  it('refuses a delivery that is already out of date', async () => {
    const staff = await staffActor()
    const item = await createItem(staff, { ...ITEM, sku: uniqueSku(), name: 'Old stock' })

    expect(
      await outcome(
        receiveStock(staff, item.id, {
          quantity: '5',
          batchNumber: null,
          expiresAt: '2020-01-01',
          costPrice: null,
          supplierId: null,
          reference: null,
          note: null,
        }),
      ),
    ).toBe('ALREADY_EXPIRED')
  })

  it('refuses a second item with the same SKU', async () => {
    const staff = await staffActor()
    const sku = uniqueSku()
    await createItem(staff, { ...ITEM, sku, name: 'First' })
    expect(await outcome(createItem(staff, { ...ITEM, sku, name: 'Second' }))).toBe('SKU_EXISTS')
  })
})

describe('using stock during a visit', () => {
  /**
   * Phase 6's exit criterion, whole: stock down, ledger written, invoice charged, one transaction.
   */
  it('decrements the shelf, writes the ledger, and reaches the bill', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '40')
    const visit = await visitFor(doctor, patient.id)

    const result = await recordConsumption(doctor, visit.id, {
      items: [{ itemId: item.id, quantity: '2', batchId: null, note: 'Left deltoid' }],
    })

    // The shelf.
    const after = await getItem(staff, item.id)
    expect(after.quantityOnHand).toBe('38.000')
    expect(after.batches[0]?.quantity).toBe('38.000')

    // The ledger, with the balance it produced.
    expect(result.movements).toHaveLength(1)
    expect(result.movements[0]).toMatchObject({
      type: 'CONSUMPTION',
      quantity: '-2.000',
      balanceAfter: '38.000',
      encounterId: visit.id,
      reason: 'Left deltoid',
    })
    expect(result.movements[0]?.batchNumber).toBe('BATCH-1')

    // The bill: 2 vials at 12.00.
    expect(result.invoiceId).not.toBeNull()
    expect(result.billedTotal).toBe('24.00')
    const invoice = await getInvoice(staff, result.invoiceId ?? '')
    expect(invoice.encounterId).toBe(visit.id)
    expect(invoice.status).toBe('DRAFT')
    expect(invoice.total).toBe('24.00')
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]?.description).toContain('2 vial')

    // And the ledger row names the bill it reached.
    expect(result.movements[0]?.invoiceId).toBe(result.invoiceId)
  })

  it('appends to the visit’s open draft rather than starting a second bill', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const first = await stockedItem(staff, '10')
    const second = await stockedItem(staff, '10', { salePrice: '5.00' })
    const visit = await visitFor(doctor, patient.id)

    const one = await recordConsumption(doctor, visit.id, {
      items: [{ itemId: first.id, quantity: '1', batchId: null, note: null }],
    })
    const two = await recordConsumption(doctor, visit.id, {
      items: [{ itemId: second.id, quantity: '3', batchId: null, note: null }],
    })

    expect(two.invoiceId).toBe(one.invoiceId)
    const invoice = await getInvoice(staff, one.invoiceId ?? '')
    expect(invoice.lines).toHaveLength(2)
    // 12.00 + 15.00 — and the total is the sum of the rounded lines (ADR-0027).
    expect(invoice.total).toBe('27.00')
    expect(invoice.balanceDue).toBe('27.00')

    const invoices = await everyPage((page) =>
      listInvoices(staff, { encounterId: visit.id, ...page }),
    )
    expect(invoices).toHaveLength(1)
  })

  it('takes from the batch that expires soonest', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '5', {
      batchNumber: 'LATER',
      expiresAt: '2028-01-31',
    })
    await receiveStock(staff, item.id, {
      quantity: '5',
      batchNumber: 'SOONER',
      expiresAt: '2027-01-31',
      costPrice: '4.00',
      supplierId: null,
      reference: null,
      note: null,
    })
    const visit = await visitFor(doctor, patient.id)

    const result = await recordConsumption(doctor, visit.id, {
      items: [{ itemId: item.id, quantity: '2', batchId: null, note: null }],
    })

    expect(result.movements[0]?.batchNumber).toBe('SOONER')
    const after = await getItem(staff, item.id)
    expect(after.batches.find((batch) => batch.batchNumber === 'SOONER')?.quantity).toBe('3.000')
    expect(after.batches.find((batch) => batch.batchNumber === 'LATER')?.quantity).toBe('5.000')
  })

  it('spans two batches and writes a ledger row for each', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '3', { batchNumber: 'FIRST', expiresAt: '2027-01-31' })
    await receiveStock(staff, item.id, {
      quantity: '10',
      batchNumber: 'SECOND',
      expiresAt: '2027-09-30',
      costPrice: '4.00',
      supplierId: null,
      reference: null,
      note: null,
    })
    const visit = await visitFor(doctor, patient.id)

    const result = await recordConsumption(doctor, visit.id, {
      items: [{ itemId: item.id, quantity: '5', batchId: null, note: null }],
    })

    expect(result.movements).toHaveLength(2)
    expect(result.movements.map((row) => row.batchNumber).sort()).toEqual(['FIRST', 'SECOND'])
    expect((await getItem(staff, item.id)).quantityOnHand).toBe('8.000')
    // One line on the bill, though: the patient was given five, not "three and two".
    const invoice = await getInvoice(staff, result.invoiceId ?? '')
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.total).toBe('60.00')
  })

  it('consumes an unbillable item without putting it on the bill', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const gloves = await stockedItem(staff, '20', { isBillable: false, salePrice: null })
    const visit = await visitFor(doctor, patient.id)

    const result = await recordConsumption(doctor, visit.id, {
      items: [{ itemId: gloves.id, quantity: '2', batchId: null, note: null }],
    })

    expect(result.invoiceId).toBeNull()
    expect(result.billedTotal).toBe('0.00')
    expect((await getItem(staff, gloves.id)).quantityOnHand).toBe('18.000')
    // The ledger still records it: the clinic used them whether or not anybody paid.
    expect(result.movements[0]?.quantity).toBe('-2.000')
    expect(await listInvoices(staff, { encounterId: visit.id })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('refuses more than the shelf holds, and writes nothing', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '2')
    const visit = await visitFor(doctor, patient.id)

    expect(
      await outcome(
        recordConsumption(doctor, visit.id, {
          items: [{ itemId: item.id, quantity: '3', batchId: null, note: null }],
        }),
      ),
    ).toBe('INSUFFICIENT_STOCK')

    expect((await getItem(staff, item.id)).quantityOnHand).toBe('2.000')
    expect(await listInvoices(staff, { encounterId: visit.id })).toEqual({
      items: [],
      nextCursor: null,
    })
    expect(await listMovements(staff, { encounterId: visit.id })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('refuses expired stock, and says that is what is wrong', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '10', { expiresAt: '2027-01-31' })
    // Move the clock past the expiry rather than seeding an already-expired batch, which the
    // receipt path rightly refuses.
    const visit = await visitFor(doctor, patient.id)

    expect(
      await outcome(
        recordConsumption(
          doctor,
          visit.id,
          { items: [{ itemId: item.id, quantity: '1', batchId: null, note: null }] },
          new Date('2028-01-01T09:00:00Z'),
        ),
      ),
    ).toBe('STOCK_EXPIRED')

    expect((await getItem(staff, item.id)).quantityOnHand).toBe('10.000')
  })

  /**
   * The guarantee the embedded batches exist for: the precondition lives in the update's filter,
   * so two clinicians reaching for the last vial at the same moment cannot both get it.
   */
  it('lets exactly one of two simultaneous withdrawals take the last vial', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const first = await patientOf(staff)
    const second = await patientOf(staff)
    const item = await stockedItem(staff, '1')

    const [visitA, visitB] = await Promise.all([
      visitFor(doctor, first.patient.id),
      visitFor(doctor, second.patient.id),
    ])

    const take = (encounterId: string) =>
      recordConsumption(doctor, encounterId, {
        items: [{ itemId: item.id, quantity: '1', batchId: null, note: null }],
      }).then(
        () => 'took' as const,
        () => 'refused' as const,
      )

    const outcomes = await Promise.all([take(visitA.id), take(visitB.id)])

    expect(outcomes.filter((result) => result === 'took')).toHaveLength(1)
    expect(outcomes.filter((result) => result === 'refused')).toHaveLength(1)

    const after = await getItem(staff, item.id)
    expect(after.quantityOnHand).toBe('0.000')
  })

  it('keeps a doctor out of a colleague’s visit', async () => {
    const staff = await staffActor()
    const mine = await doctorActor()
    const theirs = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '10')
    const visit = await visitFor(mine, patient.id)

    expect(
      await outcome(
        recordConsumption(theirs, visit.id, {
          items: [{ itemId: item.id, quantity: '1', batchId: null, note: null }],
        }),
      ),
    ).toBe('FORBIDDEN')
  })
})

describe('correcting the shelf', () => {
  it('writes stock off with a reason and leaves the ledger explaining the balance', async () => {
    const staff = await staffActor()
    const item = await stockedItem(staff, '10')

    const movement = await adjustStock(staff, item.id, {
      type: 'WASTAGE',
      quantity: '3',
      batchId: null,
      reason: 'Cold chain broken overnight',
    })

    expect(movement.quantity).toBe('-3.000')
    expect(movement.balanceAfter).toBe('7.000')
    expect(movement.reason).toBe('Cold chain broken overnight')
    expect((await getItem(staff, item.id)).quantityOnHand).toBe('7.000')
  })

  it('corrects a recount in either direction', async () => {
    const staff = await staffActor()
    const item = await stockedItem(staff, '10')

    await adjustStock(staff, item.id, {
      type: 'ADJUSTMENT',
      quantity: '2',
      batchId: null,
      reason: 'Found two behind the fridge',
    })
    expect((await getItem(staff, item.id)).quantityOnHand).toBe('12.000')

    await adjustStock(staff, item.id, {
      type: 'ADJUSTMENT',
      quantity: '-4',
      batchId: null,
      reason: 'Recount after stock-take',
    })
    expect((await getItem(staff, item.id)).quantityOnHand).toBe('8.000')
  })

  it('refuses to take out more than is there', async () => {
    const staff = await staffActor()
    const item = await stockedItem(staff, '2')
    expect(
      await outcome(
        adjustStock(staff, item.id, {
          type: 'WASTAGE',
          quantity: '5',
          batchId: null,
          reason: 'Dropped the box',
        }),
      ),
    ).toBe('INSUFFICIENT_STOCK')
    expect((await getItem(staff, item.id)).quantityOnHand).toBe('2.000')
  })

  it('is not a doctor’s to do', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const item = await stockedItem(staff, '10')

    expect(
      await outcome(
        adjustStock(doctor, item.id, {
          type: 'ADJUSTMENT',
          quantity: '5',
          batchId: null,
          reason: 'Because I say so',
        }),
      ),
    ).toBe('FORBIDDEN')
  })
})

describe('the ledger explains the balance', () => {
  /**
   * The claim the whole design rests on, checked rather than asserted: sum every movement an
   * item has ever had and it must equal what the shelf says.
   */
  it('reconciles after a receipt, a consumption, a write-off and a recount', async () => {
    const staff = await staffActor()
    const doctor = await doctorActor()
    const { patient } = await patientOf(staff)
    const item = await stockedItem(staff, '20')
    const visit = await visitFor(doctor, patient.id)

    await recordConsumption(doctor, visit.id, {
      items: [{ itemId: item.id, quantity: '3.5', batchId: null, note: null }],
    })
    await adjustStock(staff, item.id, {
      type: 'WASTAGE',
      quantity: '1.5',
      batchId: null,
      reason: 'Damaged',
    })
    await adjustStock(staff, item.id, {
      type: 'ADJUSTMENT',
      quantity: '2',
      batchId: null,
      reason: 'Recount',
    })
    await receiveStock(staff, item.id, {
      quantity: '10',
      batchNumber: 'BATCH-2',
      expiresAt: '2028-01-31',
      costPrice: '4.00',
      supplierId: null,
      reference: null,
      note: null,
    })

    const reconciliation = await reconcileItem(staff, item.id)
    // 20 - 3.5 - 1.5 + 2 + 10
    expect(reconciliation.quantityOnHand).toBe('27.000')
    expect(reconciliation.ledgerTotal).toBe('27.000')
    expect(reconciliation.agrees).toBe(true)

    const movements = await everyPage((page) => listMovements(staff, { itemId: item.id, ...page }))
    expect(movements.map((row) => row.type)).toEqual([
      'RECEIPT',
      'ADJUSTMENT',
      'WASTAGE',
      'CONSUMPTION',
      'RECEIPT',
    ])
    // Newest first, and the newest row's balance is what the shelf says.
    expect(movements[0]?.balanceAfter).toBe('27.000')
  })
})

describe('what needs attention', () => {
  it('lists what is running low and what is going off', async () => {
    const staff = await staffActor()
    const low = await stockedItem(staff, '3', { reorderLevel: '5' })
    const soon = await stockedItem(staff, '50', { reorderLevel: '5', expiresAt: '2026-10-01' })

    const alerts = await stockAlerts(staff, new Date('2026-09-15T09:00:00Z'))

    expect(alerts.low.map((item) => item.id)).toContain(low.id)
    expect(alerts.expiring.map((item) => item.id)).toContain(soon.id)
    // Plenty in stock, so it is not low — only expiring.
    expect(alerts.low.map((item) => item.id)).not.toContain(soon.id)
  })

  it('filters the list to the same two views', async () => {
    const staff = await staffActor()
    const low = await stockedItem(staff, '1', { reorderLevel: '5' })

    const all = await everyPage((page) =>
      listItems(staff, { status: 'active', view: 'all', ...page }),
    )
    const lowOnly = await everyPage((page) =>
      listItems(staff, { status: 'active', view: 'low', ...page }),
    )

    expect(all.map((item) => item.id)).toContain(low.id)
    expect(lowOnly.map((item) => item.id)).toContain(low.id)
    expect(lowOnly.every((item) => item.isLow)).toBe(true)
  })

  it('never calls an item with no reorder level low', async () => {
    const staff = await staffActor()
    const item = await stockedItem(staff, '0.001', { reorderLevel: '0' })
    const alerts = await stockAlerts(staff)
    expect(alerts.low.map((row) => row.id)).not.toContain(item.id)
  })
})

async function walk<T extends { id: string }>(
  fetchPage: (page: {
    cursor?: string
    limit: number
  }) => Promise<{ items: T[]; nextCursor: string | null }>,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = []
  let cursor: string | undefined
  let pages = 0
  for (;;) {
    const page = await fetchPage({ cursor, limit })
    pages += 1
    expect(page.items.length).toBeLessThanOrEqual(limit)
    ids.push(...page.items.map((item) => item.id))
    if (!page.nextCursor) return { ids, pages }
    // A page that offers a way on is full; a short page with a cursor sends a client to nothing.
    expect(page.items).toHaveLength(limit)
    cursor = page.nextCursor
  }
}

/**
 * "Running low" is worked out from the shelf, not stored, so it is paged in memory — the one list
 * whose cursor is not a database cursor, and so the one most worth walking.
 */
describe('paging through the catalogue', () => {
  it('reaches every low item exactly once, a page at a time', async () => {
    const staff = await staffActor()
    const low: string[] = []
    for (let index = 0; index < 5; index += 1) {
      low.push((await stockedItem(staff, '1', { reorderLevel: '5' })).id)
    }

    const { ids } = await walk(
      (page) => listItems(staff, { status: 'active', view: 'low', ...page }),
      2,
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of low) expect(ids).toContain(id)
  })

  it('alerts on every low item, not only those on the first 300 names', async () => {
    const staff = await staffActor()
    // Inserted directly: the regression is about how many rows the alert reads, and building 310
    // items through the use cases would test the use cases 310 times rather than the alert once.
    // Named to sort after everything else, where the old 300-row read never reached.
    const ids = Array.from({ length: 310 }, () => newId())
    await InventoryItemModel().collection.insertMany(
      ids.map((id, index) => ({
        _id: id,
        clinicId: clinicId(),
        sku: `ALERT-${id.slice(0, 12)}`,
        name: `zzz Alert item ${String(index).padStart(3, '0')}`,
        search: {
          sku: `alert-${id.slice(0, 12)}`,
          name: `zzz alert item ${String(index).padStart(3, '0')}`,
        },
        unit: 'box',
        quantityOnHand: decimal128('1'),
        reorderLevel: decimal128('5'),
        batches: [],
        isTracked: true,
        isBillable: false,
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as never[],
    )

    const alerts = await stockAlerts(staff)
    const flagged = new Set(alerts.low.map((item) => item.id))
    expect(ids.filter((id) => !flagged.has(id))).toEqual([])
  })
})
