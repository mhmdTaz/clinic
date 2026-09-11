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

/** What every authenticated request needs to know about the installation's clinic. */
export interface ClinicSessionInfo {
  id: string
  name: string
  timezone: string
  locale: string
  /** Moves on any role, grant or assignment change (section 7.7). */
  permissionVersion: number
  featureFlags: Record<string, boolean>
}

/** A clinic with no active branch cannot take a booking — surfaced in Phase 3. */
export function hasBookableBranch(clinic: Clinic): boolean {
  return clinic.branches.some((b) => b.isActive)
}

export function activeBranches(clinic: Clinic): Branch[] {
  return clinic.branches.filter((b) => b.isActive)
}

/**
 * ADR-0021: a clinic always keeps an open branch. True when the branches would still include
 * an active one after `change`.
 */
export function leavesAnActiveBranch(
  branches: ReadonlyArray<{ id: string; isActive: boolean }>,
  change: { branchId: string; isActive: boolean },
): boolean {
  return branches.some((branch) =>
    branch.id === change.branchId ? change.isActive : branch.isActive,
  )
}

/**
 * Closures from `today` on, soonest first. Holidays are "YYYY-MM-DD" strings, which sort as
 * text; `today` must be the date in the clinic's timezone, not in UTC (ADR-0010).
 */
export function upcomingHolidays<T extends { date: string }>(
  holidays: readonly T[],
  today: string,
  limit = 5,
): T[] {
  return holidays
    .filter((holiday) => holiday.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit)
}
