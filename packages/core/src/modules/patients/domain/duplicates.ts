import { emailKey, nameKey, nationalIdKey, phoneKey } from '@clinic/config'
import type { DuplicateReason } from '@clinic/contracts'

/** The fields a possible duplicate is judged on (ADR-0020). */
export interface MatchInput {
  firstName: string
  lastName: string
  dateOfBirth: string | null
  nationalId: string | null
  phone: string | null
  email: string | null
}

export interface MatchKeys {
  nationalId: string | null
  phone: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
  dateOfBirth: string | null
}

/** The normalised keys to look candidates up by. */
export function matchKeys(input: MatchInput): MatchKeys {
  return {
    nationalId: nationalIdKey(input.nationalId),
    phone: phoneKey(input.phone),
    email: emailKey(input.email),
    firstName: nameKey(input.firstName),
    lastName: nameKey(input.lastName),
    dateOfBirth: input.dateOfBirth,
  }
}

const same = (a: string | null, b: string | null) => a !== null && a === b

/**
 * Why an existing record may be the same person, strongest signal first. Empty means "not a
 * duplicate". A name alone never counts: two people called Sara Khoury are common; two Sara
 * Khourys born on the same day are not.
 */
export function duplicateReasons(input: MatchInput, candidate: MatchInput): DuplicateReason[] {
  const a = matchKeys(input)
  const b = matchKeys(candidate)
  const reasons: DuplicateReason[] = []
  if (same(a.nationalId, b.nationalId)) reasons.push('NATIONAL_ID')
  if (same(a.phone, b.phone)) reasons.push('PHONE')
  if (same(a.email, b.email)) reasons.push('EMAIL')
  if (
    same(a.dateOfBirth, b.dateOfBirth) &&
    same(a.firstName, b.firstName) &&
    same(a.lastName, b.lastName)
  ) {
    reasons.push('NAME_AND_DATE_OF_BIRTH')
  }
  return reasons
}

/**
 * Candidates found at the moment of saving that the override did not name. The form's earlier
 * check is not trusted: a record registered at the next desk a minute ago is a new warning.
 */
export function uncoveredCandidates(
  candidateIds: readonly string[],
  override: { candidateIds: readonly string[] } | null,
): string[] {
  const covered = new Set(override?.candidateIds ?? [])
  return candidateIds.filter((id) => !covered.has(id))
}
