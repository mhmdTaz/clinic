/**
 * Domain types and pure behaviour. No I/O, no driver types, no framework — this
 * file is unit-testable with no mocks at all.
 */
export interface Branch {
  id: string
  name: string
  isActive: boolean
}

export interface Clinic {
  id: string
  name: string
  timezone: string
  currency: string
  locale: string
  branches: Branch[]
}

/** A clinic with no active branch cannot take a booking — surfaced in Phase 3. */
export function hasBookableBranch(clinic: Clinic): boolean {
  return clinic.branches.some((b) => b.isActive)
}

export function activeBranches(clinic: Clinic): Branch[] {
  return clinic.branches.filter((b) => b.isActive)
}
