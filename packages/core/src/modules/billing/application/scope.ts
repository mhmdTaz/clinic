import { careRelationship, registerScopeResolver, type Actor } from '../../access'

/**
 * Who reaches a bill (section 7.5).
 *
 * OWN is the patient the money is about. ASSIGNED is a doctor who has actually treated them —
 * the same care-relationship test the chart uses (ADR-0004) — so a clinic that chooses to let
 * its doctors see what their own patients were charged can grant it without that becoming a
 * view of the whole ledger.
 *
 * Anything else is a CLINIC-scoped grant, which never reaches a resolver, or a denial.
 */
export function installBillingScopeResolvers(): void {
  registerScopeResolver('invoice', resolve)
  registerScopeResolver('payment', resolve)
}

const resolve = async (
  actor: Actor,
  resource: Record<string, unknown>,
  scope: string,
): Promise<boolean> => {
  const patientId = typeof resource.patientId === 'string' ? resource.patientId : null
  if (!patientId) return false

  if (scope === 'OWN') return Boolean(actor.patientId) && patientId === actor.patientId
  if (scope === 'ASSIGNED') {
    if (!actor.doctorId) return false
    return careRelationship().hasTreated(actor.clinicId, actor.doctorId, patientId)
  }
  return false
}

export const billingResource = (
  actor: Actor,
  type: 'Invoice' | 'Payment',
  row: { id: string | null; patientId: string },
) => ({
  clinicId: actor.clinicId,
  type,
  id: row.id,
  patientId: row.patientId,
})
