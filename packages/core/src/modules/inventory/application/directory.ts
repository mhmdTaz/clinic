import type {
  InventoryCategory,
  InventoryCategoryInput,
  Supplier,
  SupplierInput,
} from '@clinic/contracts'
import { ConflictError, NotFoundError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { categoryRepository } from '../infrastructure/category.repository'
import { supplierRepository } from '../infrastructure/supplier.repository'

/** A MongoDB duplicate-key error, whatever wrapper it arrives in. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000

const duplicate = (what: string) =>
  new ConflictError(`${what}_EXISTS`, `A ${what.toLowerCase()} with that name already exists.`, [
    { field: 'name', issue: 'DUPLICATE' },
  ])

export async function listCategories(actor: Actor): Promise<InventoryCategory[]> {
  await assertCan(actor, 'inventory:read')
  return categoryRepository.list(actor.clinicId, 'all')
}

export async function createCategory(
  actor: Actor,
  input: InventoryCategoryInput,
): Promise<InventoryCategory> {
  await assertCan(actor, 'inventory:manage')
  try {
    return await categoryRepository.create(actor.clinicId, input)
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicate('CATEGORY')
    throw error
  }
}

export async function updateCategory(
  actor: Actor,
  categoryId: string,
  input: InventoryCategoryInput,
): Promise<InventoryCategory> {
  await assertCan(actor, 'inventory:manage')
  try {
    const category = await categoryRepository.update(actor.clinicId, categoryId, input)
    if (!category) throw new NotFoundError('Category')
    return category
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicate('CATEGORY')
    throw error
  }
}

export async function listSuppliers(actor: Actor): Promise<Supplier[]> {
  await assertCan(actor, 'inventory:read')
  return supplierRepository.list(actor.clinicId, 'all')
}

export async function createSupplier(actor: Actor, input: SupplierInput): Promise<Supplier> {
  await assertCan(actor, 'inventory:manage')
  try {
    return await supplierRepository.create(actor.clinicId, input)
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicate('SUPPLIER')
    throw error
  }
}

export async function updateSupplier(
  actor: Actor,
  supplierId: string,
  input: SupplierInput,
): Promise<Supplier> {
  await assertCan(actor, 'inventory:manage')
  try {
    const supplier = await supplierRepository.update(actor.clinicId, supplierId, input)
    if (!supplier) throw new NotFoundError('Supplier')
    return supplier
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicate('SUPPLIER')
    throw error
  }
}
