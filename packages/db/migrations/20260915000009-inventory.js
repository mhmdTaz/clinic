/**
 * Phase 6: what is on the shelf and why it moved (section 8.11).
 *
 * The categories and suppliers a clinic keeps its own vocabulary of, the items with their
 * batches embedded, and the movement ledger the stock levels are a projection of.
 *
 * Two guards live here as well as in the repositories, because a count nobody can explain is
 * worth as little as a balance nobody can explain (section 8.15):
 *
 *  - no batch may hold a negative quantity, and no item a negative total. The deduction's
 *    conditional filter is the mechanism; this validator is the belt to that brace.
 *  - every movement must carry the balance it produced, so "explain this number" is one row
 *    rather than a replay of the whole history.
 */

async function ensureCollection(db, name, validator) {
  const existing = await db.listCollections({ name }).toArray()
  if (existing.length === 0) {
    await db.createCollection(name, {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    })
  } else {
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    })
  }
}

const stringId = { bsonType: 'string' }
const nullableString = { bsonType: ['string', 'null'] }
const nullableDate = { bsonType: ['date', 'null'] }
const decimal = { bsonType: 'decimal' }
const nullableDecimal = { bsonType: ['decimal', 'null'] }
const nullableCalendarDate = {
  bsonType: ['string', 'null'],
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
}

const STOCK_MOVEMENT_TYPES = ['RECEIPT', 'CONSUMPTION', 'WASTAGE', 'RETURN', 'ADJUSTMENT']

const personRef = {
  bsonType: ['object', 'null'],
  properties: { id: nullableString, name: nullableString },
}

const searchKeys = {
  bsonType: ['object', 'null'],
  properties: { sku: nullableString, name: nullableString },
}

export const up = async (db) => {
  // ── inventoryCategories ───────────────────────────────────────────────────
  await ensureCollection(db, 'inventoryCategories', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'name'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        name: { bsonType: 'string', minLength: 1 },
        search: searchKeys,
        isActive: { bsonType: 'bool' },
      },
    },
  })
  await db
    .collection('inventoryCategories')
    .createIndex(
      { clinicId: 1, 'search.name': 1 },
      { unique: true, name: 'inventory_category_name_unique' },
    )

  // ── suppliers ─────────────────────────────────────────────────────────────
  await ensureCollection(db, 'suppliers', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'name'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        name: { bsonType: 'string', minLength: 1 },
        search: searchKeys,
        contactName: nullableString,
        phone: nullableString,
        email: nullableString,
        notes: nullableString,
        isActive: { bsonType: 'bool' },
      },
    },
  })
  await db
    .collection('suppliers')
    .createIndex({ clinicId: 1, 'search.name': 1 }, { unique: true, name: 'supplier_name_unique' })

  // ── inventoryItems ────────────────────────────────────────────────────────
  await ensureCollection(db, 'inventoryItems', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'sku', 'name', 'unit'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        branchId: nullableString,
        sku: { bsonType: 'string', minLength: 1 },
        name: { bsonType: 'string', minLength: 1 },
        search: searchKeys,
        description: nullableString,
        categoryId: nullableString,
        supplierId: nullableString,
        unit: { bsonType: 'string', minLength: 1 },
        costPrice: nullableDecimal,
        salePrice: nullableDecimal,
        // Stock never goes below zero: the deduction's filter refuses it, and so does this.
        quantityOnHand: { bsonType: 'decimal', minimum: 0 },
        reorderLevel: { bsonType: 'decimal', minimum: 0 },
        batches: {
          bsonType: 'array',
          maxItems: 500,
          items: {
            bsonType: 'object',
            required: ['_id', 'quantity'],
            properties: {
              _id: stringId,
              batchNumber: nullableString,
              expiresAt: nullableCalendarDate,
              quantity: { bsonType: 'decimal', minimum: 0 },
              costPrice: nullableDecimal,
              receivedAt: nullableDate,
            },
          },
        },
        isTracked: { bsonType: 'bool' },
        isBillable: { bsonType: 'bool' },
        isActive: { bsonType: 'bool' },
        deletedAt: nullableDate,
      },
    },
  })
  const items = db.collection('inventoryItems')
  // A SKU is unique among the items that still exist; a deleted one releases its code.
  await items.createIndex(
    { clinicId: 1, 'search.sku': 1 },
    { unique: true, partialFilterExpression: { deletedAt: null }, name: 'inventory_sku_unique' },
  )
  await items.createIndex(
    { clinicId: 1, isActive: 1, 'search.name': 1 },
    { name: 'inventory_list' },
  )
  await items.createIndex({ clinicId: 1, quantityOnHand: 1 }, { name: 'inventory_low_stock' })
  await items.createIndex({ clinicId: 1, 'batches.expiresAt': 1 }, { name: 'inventory_expiring' })
  await items.createIndex({ clinicId: 1, categoryId: 1 }, { name: 'inventory_category' })

  // ── stockMovements ────────────────────────────────────────────────────────
  await ensureCollection(db, 'stockMovements', {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'clinicId', 'itemId', 'type', 'quantity', 'balanceAfter'],
      properties: {
        _id: stringId,
        clinicId: { bsonType: 'string' },
        branchId: nullableString,
        itemId: { bsonType: 'string' },
        item: {
          bsonType: 'object',
          required: ['name', 'sku', 'unit'],
          properties: {
            name: { bsonType: 'string' },
            sku: { bsonType: 'string' },
            unit: { bsonType: 'string' },
          },
        },
        batchId: nullableString,
        batchNumber: nullableString,
        type: { enum: STOCK_MOVEMENT_TYPES },
        // Signed: positive in, negative out, so the ledger sums to the balance.
        quantity: decimal,
        // Never negative: a balance is a count of things on a shelf.
        balanceAfter: { bsonType: 'decimal', minimum: 0 },
        reason: nullableString,
        encounterId: nullableString,
        invoiceId: nullableString,
        reference: nullableString,
        occurredAt: { bsonType: 'date' },
        performedBy: personRef,
      },
    },
  })
  const movements = db.collection('stockMovements')
  await movements.createIndex({ clinicId: 1, itemId: 1, occurredAt: -1 }, { name: 'movement_item' })
  await movements.createIndex({ clinicId: 1, occurredAt: -1 }, { name: 'movement_day' })
  await movements.createIndex(
    { clinicId: 1, encounterId: 1 },
    { sparse: true, name: 'movement_encounter' },
  )
  await movements.createIndex({ clinicId: 1, type: 1, occurredAt: -1 }, { name: 'movement_type' })
}

export const down = async (db) => {
  for (const name of ['inventoryCategories', 'suppliers', 'inventoryItems', 'stockMovements']) {
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) await db.collection(name).drop()
  }
}
