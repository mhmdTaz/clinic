/** What the clinic keeps on the shelf, and why it moved (A7, S10, D15). */
export {
  listItems,
  getItem,
  createItem,
  updateItem,
  toItemSummary,
  toItemDetail,
  itemContext,
  type ItemContext,
} from './application/catalogue'
export {
  listCategories,
  createCategory,
  updateCategory,
  listSuppliers,
  createSupplier,
  updateSupplier,
} from './application/directory'
export {
  receiveStock,
  adjustStock,
  listMovements,
  reconcileItem,
  toMovement,
} from './application/stock'
export { recordConsumption, listConsumption } from './application/consumption'
export { stockAlerts } from './application/alerts'
export { allocateFefo, allocateFromBatch, totalOf, type BatchLike } from './domain/stock'
export { isLowStock, nextExpiry, expiryState, horizonDate } from './domain/alerts'
// NOT exported: the repositories.
