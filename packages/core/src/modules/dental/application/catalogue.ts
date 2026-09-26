import type {
  DentalTreatment,
  DentalTreatmentInput,
  QuickPick,
  QuickPickInput,
} from '@clinic/contracts'
import { ConflictError, NotFoundError, ValidationError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { DEFAULT_TREATMENTS } from '../domain/defaults'
import {
  catalogueRepository,
  type StoredQuickPick,
  type StoredTreatment,
} from '../infrastructure/catalogue.repository'

/**
 * What can be charted, and the presets that chart it in one tap (Phase 11). Reading them is part
 * of reading the chart; changing them is the clinic's configuration.
 */

const toTreatment = (treatment: StoredTreatment): DentalTreatment => ({ ...treatment })
const toQuickPick = (pick: StoredQuickPick): QuickPick => ({
  id: pick.id,
  doctorId: pick.doctorId,
  name: pick.name,
  items: pick.items.map((item) => ({ ...item, surfaces: [...item.surfaces] })),
  sortOrder: pick.sortOrder,
  isActive: pick.isActive,
})

/**
 * The clinic's treatments, retired ones included so old rows can still be named. The first read
 * in a clinic that has none writes the starting list, so a new dental practice opens a chart that
 * already works.
 */
export async function listTreatments(actor: Actor): Promise<DentalTreatment[]> {
  await assertCan(actor, 'dental:read')
  let treatments = await catalogueRepository.listTreatments(actor.clinicId)
  if (treatments.length === 0) {
    await catalogueRepository.seedTreatments(actor.clinicId, DEFAULT_TREATMENTS)
    treatments = await catalogueRepository.listTreatments(actor.clinicId)
  }
  return treatments.map(toTreatment)
}

const codeTaken = () =>
  new ConflictError('CODE_TAKEN', 'Another treatment already uses this code.', [
    { field: 'code', issue: 'TAKEN' },
  ])

export async function createTreatment(
  actor: Actor,
  input: DentalTreatmentInput,
): Promise<DentalTreatment> {
  await assertCan(actor, 'dental:configure')
  const created = await catalogueRepository.createTreatment(actor.clinicId, input)
  if (!created) throw codeTaken()
  return toTreatment(created)
}

/**
 * Renaming, repricing or retiring a treatment never restates history: every row charted with it
 * carries a snapshot. Changing what it *draws* would, silently, so the symbol and the scope are
 * fixed once rows exist — retire it and add another instead.
 */
export async function updateTreatment(
  actor: Actor,
  treatmentId: string,
  input: DentalTreatmentInput,
): Promise<DentalTreatment> {
  await assertCan(actor, 'dental:configure')
  const current = await catalogueRepository.findTreatment(actor.clinicId, treatmentId)
  if (!current) throw new NotFoundError('Treatment')
  if (current.symbol !== input.symbol || current.scope !== input.scope) {
    throw new ValidationError('What a treatment draws cannot be changed.', [
      ...(current.symbol !== input.symbol ? [{ field: 'symbol', issue: 'FIXED' }] : []),
      ...(current.scope !== input.scope ? [{ field: 'scope', issue: 'FIXED' }] : []),
    ])
  }
  const updated = await catalogueRepository.updateTreatment(actor.clinicId, treatmentId, input)
  if (updated === 'DUPLICATE') throw codeTaken()
  if (!updated) throw new NotFoundError('Treatment')
  return toTreatment(updated)
}

/** The clinic's presets and the caller's own, if they are a dentist. */
export async function listQuickPicks(actor: Actor): Promise<QuickPick[]> {
  await assertCan(actor, 'dental:read')
  const picks = await catalogueRepository.listQuickPicks(actor.clinicId, actor.doctorId ?? null)
  return picks.map(toQuickPick)
}

async function checkItems(actor: Actor, input: QuickPickInput): Promise<void> {
  const treatments = await catalogueRepository.findTreatments(
    actor.clinicId,
    input.items.map((item) => item.treatmentId),
  )
  const missing = input.items.findIndex((item) => !treatments.has(item.treatmentId))
  if (missing !== -1) {
    throw new ValidationError('A treatment in this preset does not exist.', [
      { field: `items.${missing}.treatmentId`, issue: 'NOT_FOUND' },
    ])
  }
}

export async function createQuickPick(actor: Actor, input: QuickPickInput): Promise<QuickPick> {
  await assertCan(actor, 'dental:configure')
  await checkItems(actor, input)
  return toQuickPick(await catalogueRepository.createQuickPick(actor.clinicId, input))
}

export async function updateQuickPick(
  actor: Actor,
  quickPickId: string,
  input: QuickPickInput,
): Promise<QuickPick> {
  await assertCan(actor, 'dental:configure')
  await checkItems(actor, input)
  const updated = await catalogueRepository.updateQuickPick(actor.clinicId, quickPickId, input)
  if (!updated) throw new NotFoundError('Quick-pick')
  return toQuickPick(updated)
}
