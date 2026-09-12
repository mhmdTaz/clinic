import { registerScopeResolver } from '../../access'

/**
 * Who reaches a ticket (section 7.5).
 *
 * OWN is the person who opened it — a patient asking about their bill, a doctor asking about a
 * rota. ASSIGNED is a staff member the ticket was given to, which is how a clinic can hand one
 * person a queue without handing them everybody's.
 *
 * Staff hold `ticket:read` at CLINIC and never reach a resolver at all; these two exist for the
 * narrower grants, and for the guard test that walks every one of them.
 */
export function installTicketScopeResolvers(): void {
  registerScopeResolver('ticket', (actor, resource, scope) => {
    if (scope === 'OWN') {
      return typeof resource.userId === 'string' && resource.userId === actor.userId
    }
    if (scope === 'ASSIGNED') {
      return typeof resource.assigneeId === 'string' && resource.assigneeId === actor.userId
    }
    return false
  })
}
