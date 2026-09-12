import {
  overlappingHours,
  type BranchInput,
  type ClinicProfileInput,
  type ClinicSettings,
  type SetHolidaysRequest,
  type SetWorkingHoursRequest,
  type UpdateBookingWindowRequest,
  type UpdateBranchRequest,
} from '@clinic/contracts'
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../errors'
import { assertCan, type Actor } from '../../access'
import { bookingWindowOf } from '../../scheduling'
import { saveBookingWindow } from './get-scheduling-facts'
import { leavesAnActiveBranch } from '../domain/clinic'
import { clinicRepository } from '../infrastructure/clinic.repository'

/**
 * Clinic settings (A1, A2). Every mutation answers with the settings as they now stand, so a
 * screen never shows a stale mix of what it sent and what the server kept.
 */
async function settingsOf(clinicId: string): Promise<ClinicSettings> {
  const [settings, booking] = await Promise.all([
    clinicRepository.findSettings(clinicId),
    clinicRepository.findBookingWindow(clinicId),
  ])
  if (!settings) throw new NotFoundError(`Clinic ${clinicId}`)
  // Anything the clinic has not set falls back to the defaults (ADR-0022).
  return { ...settings, booking: bookingWindowOf(booking) }
}

export async function getClinicSettings(actor: Actor): Promise<ClinicSettings> {
  await assertCan(actor, 'clinic:read')
  return settingsOf(actor.clinicId)
}

export async function updateClinicProfile(
  actor: Actor,
  input: ClinicProfileInput,
): Promise<ClinicSettings> {
  await assertCan(actor, 'clinic:update')
  if (!(await clinicRepository.updateProfile(actor.clinicId, input))) {
    throw new NotFoundError(`Clinic ${actor.clinicId}`)
  }
  return settingsOf(actor.clinicId)
}

export async function createBranch(actor: Actor, input: BranchInput): Promise<ClinicSettings> {
  await assertCan(actor, 'branch:manage')
  if (!(await clinicRepository.addBranch(actor.clinicId, input))) {
    throw new NotFoundError(`Clinic ${actor.clinicId}`)
  }
  return settingsOf(actor.clinicId)
}

export async function updateBranch(
  actor: Actor,
  branchId: string,
  input: UpdateBranchRequest,
): Promise<ClinicSettings> {
  await assertCan(actor, 'branch:manage')
  const current = await settingsOf(actor.clinicId)
  if (!current.branches.some((branch) => branch.id === branchId)) throw new NotFoundError('Branch')
  if (!leavesAnActiveBranch(current.branches, { branchId, isActive: input.isActive })) {
    throw new BusinessRuleError(
      'LAST_ACTIVE_BRANCH',
      'The clinic needs at least one open location.',
      [{ field: 'isActive', issue: 'LAST_ACTIVE_BRANCH' }],
    )
  }
  await clinicRepository.updateBranch(actor.clinicId, branchId, input)
  return settingsOf(actor.clinicId)
}

export async function setBranchWorkingHours(
  actor: Actor,
  branchId: string,
  input: SetWorkingHoursRequest,
): Promise<ClinicSettings> {
  await assertCan(actor, 'clinic:update')

  // The contract already checks this; a use case called from a job or a script must not rely on it.
  const overlapping = overlappingHours(input.workingHours)
  const backwards = input.workingHours
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.closesAt <= entry.opensAt)
  if (overlapping.length > 0 || backwards.length > 0) {
    throw new ValidationError('Some opening hours are not valid.', [
      ...overlapping.map((index) => ({
        field: `workingHours.${index}.opensAt`,
        issue: 'OVERLAPPING_HOURS',
      })),
      ...backwards.map(({ index }) => ({
        field: `workingHours.${index}.closesAt`,
        issue: 'CLOSES_BEFORE_OPENS',
      })),
    ])
  }

  if (!(await clinicRepository.setWorkingHours(actor.clinicId, branchId, input.workingHours))) {
    throw new NotFoundError('Branch')
  }
  return settingsOf(actor.clinicId)
}

export async function setClinicHolidays(
  actor: Actor,
  input: SetHolidaysRequest,
): Promise<ClinicSettings> {
  await assertCan(actor, 'clinic:update')
  const current = await settingsOf(actor.clinicId)
  const branchIds = new Set(current.branches.map((branch) => branch.id))

  const unknown = input.holidays
    .map((holiday, index) => ({ holiday, index }))
    .filter(({ holiday }) => holiday.branchId !== null && !branchIds.has(holiday.branchId))
  if (unknown.length > 0) {
    throw new ValidationError(
      'A holiday refers to a location that does not exist.',
      unknown.map(({ index }) => ({
        field: `holidays.${index}.branchId`,
        issue: 'UNKNOWN_BRANCH',
      })),
    )
  }

  await clinicRepository.setHolidays(actor.clinicId, input.holidays)
  return settingsOf(actor.clinicId)
}

/**
 * The self-service booking window (ADR-0022). It binds patients booking for themselves; the
 * front desk is never held to it, so a rule here cannot lock the clinic out of its own diary.
 */
export async function updateBookingWindow(
  actor: Actor,
  input: UpdateBookingWindowRequest,
): Promise<ClinicSettings> {
  await assertCan(actor, 'clinic:update')
  await saveBookingWindow(actor.clinicId, input)
  return settingsOf(actor.clinicId)
}
