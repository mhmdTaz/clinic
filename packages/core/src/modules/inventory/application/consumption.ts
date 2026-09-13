import {
  displayQuantity,
  localDateIn,
  multiplyAmount,
  normalizeQuantity,
  zeroAmount,
} from '@clinic/contracts'
import type {
  ConsumedItemInput,
  ConsumptionResult,
  InvoiceLineInput,
  RecordConsumptionRequest,
} from '@clinic/contracts'
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { runInTransaction } from '../../../transaction'
import { recordAudit } from '../../audit'
import { assertCan, type Actor } from '../../access'
import { billToEncounter } from '../../billing'
import { getClinicFacts } from '../../clinic'
import { encounterResource, findEncounterOwner } from '../../clinical'

import { allocateFefo, allocateFromBatch, type BatchAllocation } from '../domain/stock'
import { itemRepository, type StoredItem } from '../infrastructure/item.repository'
import { movementRepository, type MovementWrite } from '../infrastructure/movement.repository'
import { toMovement } from './stock'

/** One line of the request, resolved against the shelf before anything is written. */
interface Planned {
  item: StoredItem
  quantity: string
  allocations: BatchAllocation[]
  note: string | null
  line: InvoiceLineInput | null
}

/**
 * Recording what a visit used — **Phase 6's exit criterion** (section 8.11).
 *
 * Consuming an item decrements stock, writes a ledger row, and reaches the bill, all in one
 * transaction. Each of the three is worth its own sentence:
 *
 *  - **the stock** moves by the conditional update in the item repository, whose filter asserts
 *    both the item total and each batch has enough. Two clinicians reaching for the last vial at
 *    the same moment cannot both get it.
 *  - **the ledger** row carries the balance the movement produced, so the number on the shelf is
 *    explained by one row rather than a replay of the history.
 *  - **the bill** gets a line at the item's sale price, snapshotted, with `inventoryItemId` set —
 *    the seam Phase 5 left open so this phase wired a source into a shape that already existed.
 *
 * Everything is checked before the transaction opens, so the ordinary failures — not enough
 * stock, all of it expired, a cancelled visit — come back as a sentence rather than as a
 * half-applied consumption the transaction then rolls back.
 */
export async function recordConsumption(
  actor: Actor,
  encounterId: string,
  input: RecordConsumptionRequest,
  now: Date = new Date(),
): Promise<ConsumptionResult> {
  await assertCan(actor, 'inventory:consume')

  const encounter = await findEncounterOwner(actor.clinicId, encounterId)
  if (!encounter) throw new NotFoundError('Encounter')
  // Whose visit it is still decides who may write against it (ADR-0004): a doctor records what
  // their own consultation used, not a colleague's.
  await assertCan(actor, 'encounter:read', encounterResource(actor, encounter))

  if (encounter.status === 'CANCELLED') {
    throw new BusinessRuleError('ENCOUNTER_CANCELLED', 'That visit was cancelled.')
  }

  const clinic = await getClinicFacts(actor.clinicId)
  const today = localDateIn(clinic.timezone, now)
  const items = await itemRepository.findMany(
    actor.clinicId,
    input.items.map((requested) => requested.itemId),
  )
  const byId = new Map(items.map((item) => [item.id, item]))

  const planned = input.items.map((requested, index) =>
    plan(requested, index, byId, today, clinic.currency),
  )

  const billable = planned
    .map((entry) => entry.line)
    .filter((line): line is InvoiceLineInput => line !== null)

  const result = await runInTransaction(async (tx) => {
    const balances = new Map<string, string>()

    for (const entry of planned) {
      if (!entry.item.isTracked) continue
      const moved = await itemRepository.withdraw(
        actor.clinicId,
        entry.item.id,
        entry.allocations,
        entry.quantity,
        tx,
      )
      if (!moved) {
        // Somebody took it between the plan and the write. The transaction unwinds whole.
        throw new ConflictError(
          'STOCK_CHANGED',
          `${entry.item.name} moved a moment ago. Check the count and try again.`,
        )
      }
      balances.set(entry.item.id, moved.balanceAfter)
    }

    const bill = await billToEncounter(actor, encounter, billable, tx, now)

    const entries = planned.flatMap((entry): MovementWrite[] => {
      const balanceAfter = balances.get(entry.item.id) ?? entry.item.quantityOnHand
      const base: Omit<MovementWrite, 'batchId' | 'batchNumber' | 'quantity'> = {
        clinicId: actor.clinicId,
        itemId: entry.item.id,
        item: { name: entry.item.name, sku: entry.item.sku, unit: entry.item.unit },
        type: 'CONSUMPTION' as const,
        balanceAfter,
        reason: entry.note,
        encounterId: encounter.id,
        invoiceId: entry.line ? (bill?.invoiceId ?? null) : null,
        reference: null,
        occurredAt: now,
        performedBy: { id: actor.userId, name: actor.displayName },
      }

      // An untracked item has no batches to come out of: one row, no allocation.
      if (!entry.item.isTracked) {
        return [{ ...base, batchId: null, batchNumber: null, quantity: `-${entry.quantity}` }]
      }
      // One row per batch, because the ledger has to say which box it came out of.
      return entry.allocations.map((allocation) => ({
        ...base,
        batchId: allocation.batchId,
        batchNumber: allocation.batchNumber,
        quantity: `-${allocation.quantity}`,
      }))
    })

    const movements = await movementRepository.record(entries, tx)
    return { movements, bill }
  })

  // Outside the transaction: tidying the array is housekeeping, not part of the guarantee.
  for (const entry of planned) {
    if (entry.item.isTracked) await itemRepository.pruneEmptyBatches(actor.clinicId, entry.item.id)
  }

  await recordAudit({
    action: 'inventory.consumed',
    category: 'INVENTORY',
    severity: 'INFO',
    clinicId: actor.clinicId,
    entity: { type: 'Encounter', id: encounter.id },
    metadata: {
      patientId: encounter.patientId,
      items: planned.map((entry) => ({
        sku: entry.item.sku,
        quantity: entry.quantity,
      })),
      invoiceId: result.bill?.invoiceId ?? null,
    },
  })

  return {
    movements: result.movements.map(toMovement),
    invoiceId: result.bill?.invoiceId ?? null,
    invoiceNumber: result.bill?.invoiceNumber ?? null,
    billedTotal: result.bill?.billed ?? zeroAmount(clinic.currency),
    currency: clinic.currency,
  }
}

/**
 * Resolving one requested item against the shelf: is it there, is there enough, which batches
 * does it come out of, and what does it cost. Throws rather than returns a failure, because
 * every one of these is a message somebody has to read and act on.
 */
function plan(
  requested: ConsumedItemInput,
  index: number,
  byId: Map<string, StoredItem>,
  today: string,
  currency: string,
): Planned {
  const item = byId.get(requested.itemId)
  if (!item) throw new NotFoundError('Inventory item')
  if (!item.isActive) {
    throw new BusinessRuleError('ITEM_RETIRED', `${item.name} is no longer stocked.`)
  }

  const quantity = normalizeQuantity(requested.quantity)
  if (quantity === null) {
    throw new ValidationError('That is not a quantity this clinic can hold.', [
      { field: `items.${index}.quantity`, issue: 'INVALID_QUANTITY' },
    ])
  }

  let allocations: BatchAllocation[] = []
  if (item.isTracked) {
    const allocation =
      requested.batchId !== null
        ? allocateFromBatch(item.batches, requested.batchId, quantity, today)
        : allocateFefo(item.batches, quantity, today)

    if (!allocation.ok) {
      throw new BusinessRuleError(
        allocation.reason,
        allocation.reason === 'STOCK_EXPIRED'
          ? `All of the remaining ${item.name} has expired. Write it off before using any.`
          : `There is only ${displayQuantity(allocation.usable)} ${item.unit} of ${item.name} left.`,
      )
    }
    allocations = allocation.allocations
  }

  return {
    item,
    quantity,
    allocations,
    note: requested.note,
    // Charged only when the clinic says so and has set a price. Gloves are consumed and never
    // billed; an item with no sale price is a pricing gap, not a free gift, so it is left off
    // the bill rather than charged at zero.
    line:
      item.isBillable && item.salePrice !== null
        ? {
            serviceId: null,
            description: `${item.name} (${displayQuantity(quantity)} ${item.unit})`,
            quantity: '1',
            unitPrice: multiplyAmount(currency, item.salePrice, quantity),
            discount: '0',
            taxRatePercent: '0',
          }
        : null,
  }
}

/** What a visit used, for the workspace that shows it. */
export async function listConsumption(actor: Actor, encounterId: string) {
  await assertCan(actor, 'inventory:read')
  const movements = await movementRepository.listAllFor(actor.clinicId, {
    encounterId,
    type: 'CONSUMPTION',
  })
  return movements.map(toMovement)
}
