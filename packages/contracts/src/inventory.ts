import { z } from 'zod'
import { IdParam, LocalDate, MoneyAmount, PersonRef, nullableText, requiredText } from './common'

/**
 * Contracts for inventory (A7, S10, D15).
 *
 * Quantities are decimal strings for the same reason money is: half a vial is a real amount, and
 * a JSON number is a float. They are counted with the same exact arithmetic (see money.ts), which
 * is why a stock level never drifts however many movements it has seen.
 */

export const StockMovementType = z.enum([
  'RECEIPT',
  'CONSUMPTION',
  'WASTAGE',
  'RETURN',
  'ADJUSTMENT',
])
export type StockMovementType = z.infer<typeof StockMovementType>

/** A quantity of stock. Fractional, because half a vial is a real amount; never negative. */
export const StockQuantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'INVALID_QUANTITY')
  .refine((value) => Number(value) > 0, 'TOO_SMALL')

/** A signed quantity — an adjustment may correct a count in either direction. */
export const SignedQuantity = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,3})?$/, 'INVALID_QUANTITY')
  .refine((value) => Number(value) !== 0, 'TOO_SMALL')

/** A level at or below which the item is low. Zero means "never warn". */
export const ReorderLevel = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'INVALID_QUANTITY')

// ── The vocabulary a clinic keeps its own ────────────────────────────────────

export const InventoryCategoryInput = z.object({
  name: requiredText(60),
  isActive: z.boolean().default(true),
})
export type InventoryCategoryInput = z.infer<typeof InventoryCategoryInput>

export const InventoryCategory = InventoryCategoryInput.extend({ id: z.string() })
export type InventoryCategory = z.infer<typeof InventoryCategory>

export const SupplierInput = z.object({
  name: requiredText(120),
  contactName: nullableText(120),
  phone: nullableText(40),
  email: nullableText(160),
  notes: nullableText(300),
  isActive: z.boolean().default(true),
})
export type SupplierInput = z.infer<typeof SupplierInput>

export const Supplier = SupplierInput.extend({ id: z.string() })
export type Supplier = z.infer<typeof Supplier>

// ── Items (A7) ───────────────────────────────────────────────────────────────

export const InventoryItemInput = z.object({
  sku: requiredText(40),
  name: requiredText(120),
  description: nullableText(300),
  categoryId: z.string().max(64).nullable().default(null),
  supplierId: z.string().max(64).nullable().default(null),
  /** The clinic's own word for what one of these is: "box", "vial", "tablet". */
  unit: requiredText(20),
  costPrice: MoneyAmount.nullable().default(null),
  salePrice: MoneyAmount.nullable().default(null),
  reorderLevel: ReorderLevel.default('0'),
  /** Off for something the clinic uses but does not count — tap water, paper towels. */
  isTracked: z.boolean().default(true),
  /** Off for something consumed but never charged for — gloves, gauze. */
  isBillable: z.boolean().default(true),
  isActive: z.boolean().default(true),
})
export type InventoryItemInput = z.infer<typeof InventoryItemInput>

export const StockBatch = z.object({
  id: z.string(),
  batchNumber: z.string().nullable(),
  expiresAt: z.string().nullable(),
  quantity: z.string(),
  costPrice: z.string().nullable(),
  receivedAt: z.string().datetime().nullable(),
})
export type StockBatch = z.infer<typeof StockBatch>

export const InventoryItemSummary = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  category: z.object({ id: z.string(), name: z.string() }).nullable(),
  currency: z.string(),
  costPrice: z.string().nullable(),
  salePrice: z.string().nullable(),
  quantityOnHand: z.string(),
  reorderLevel: z.string(),
  isTracked: z.boolean(),
  isBillable: z.boolean(),
  isActive: z.boolean(),
  /** Derived from today's stock against the level, never stored — see `isOverdue` on an invoice. */
  isLow: z.boolean(),
  /** The nearest expiry among the batches that still hold something. */
  nextExpiryAt: z.string().nullable(),
  isExpiringSoon: z.boolean(),
  hasExpired: z.boolean(),
})
export type InventoryItemSummary = z.infer<typeof InventoryItemSummary>

export const InventoryItemDetail = InventoryItemSummary.extend({
  description: z.string().nullable(),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
  batches: z.array(StockBatch),
})
export type InventoryItemDetail = z.infer<typeof InventoryItemDetail>

export const InventoryListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  categoryId: z.string().max(64).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  /** The two widgets that matter at a glance (S10). */
  view: z.enum(['all', 'low', 'expiring']).default('all'),
})
export type InventoryListQuery = z.infer<typeof InventoryListQuery>

// ── Moving stock (S10) ───────────────────────────────────────────────────────

export const ReceiveStockRequest = z.object({
  quantity: StockQuantity,
  batchNumber: nullableText(60),
  expiresAt: z
    .union([LocalDate, z.literal('')])
    .nullable()
    .default(null),
  costPrice: MoneyAmount.nullable().default(null),
  supplierId: z.string().max(64).nullable().default(null),
  reference: nullableText(120),
  note: nullableText(300),
})
export type ReceiveStockRequest = z.infer<typeof ReceiveStockRequest>

/**
 * A correction to a count, or stock written off. `batchId` is optional on an adjustment — a
 * recount corrects the item — and required on wastage, because something specific spoiled.
 */
export const AdjustStockRequest = z.object({
  type: z.enum(['ADJUSTMENT', 'WASTAGE', 'RETURN']),
  quantity: SignedQuantity,
  batchId: z.string().max(64).nullable().default(null),
  reason: requiredText(300),
})
export type AdjustStockRequest = z.infer<typeof AdjustStockRequest>

/** One item used during a visit. The batch is chosen by expiry unless somebody names one. */
export const ConsumedItemInput = z.object({
  itemId: IdParam,
  quantity: StockQuantity,
  batchId: z.string().max(64).nullable().default(null),
  note: nullableText(200),
})
export type ConsumedItemInput = z.infer<typeof ConsumedItemInput>

export const RecordConsumptionRequest = z.object({
  items: z.array(ConsumedItemInput).min(1).max(20),
})
export type RecordConsumptionRequest = z.infer<typeof RecordConsumptionRequest>

export const StockMovement = z.object({
  id: z.string(),
  itemId: z.string(),
  item: z.object({ name: z.string(), sku: z.string(), unit: z.string() }),
  batchId: z.string().nullable(),
  batchNumber: z.string().nullable(),
  type: StockMovementType,
  /** Signed: positive in, negative out. The ledger sums to the balance. */
  quantity: z.string(),
  /** The running total after this movement — what makes the ledger explain the balance. */
  balanceAfter: z.string(),
  reason: z.string().nullable(),
  encounterId: z.string().nullable(),
  invoiceId: z.string().nullable(),
  reference: z.string().nullable(),
  occurredAt: z.string().datetime(),
  performedBy: PersonRef.nullable(),
})
export type StockMovement = z.infer<typeof StockMovement>

export const MovementListQuery = z.object({
  itemId: z.string().max(64).optional(),
  encounterId: z.string().max(64).optional(),
  type: StockMovementType.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
})
export type MovementListQuery = z.infer<typeof MovementListQuery>

/** What consuming stock during a visit did: the ledger rows, and the bill it reached. */
export const ConsumptionResult = z.object({
  movements: z.array(StockMovement),
  invoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  billedTotal: z.string(),
  currency: z.string(),
})
export type ConsumptionResult = z.infer<typeof ConsumptionResult>

/** The two things somebody wants to know before the cupboard runs out (S10). */
export const StockAlerts = z.object({
  low: z.array(InventoryItemSummary),
  expiring: z.array(InventoryItemSummary),
  expired: z.array(InventoryItemSummary),
})
export type StockAlerts = z.infer<typeof StockAlerts>
