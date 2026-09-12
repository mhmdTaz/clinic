import { beforeAll, describe, expect, it } from 'vitest'
import {
  SYSTEM_ROLES,
  clearScopeResolvers,
  decide,
  installDefaultScopeResolvers,
  subjectOf,
  type Actor,
} from '../modules/access'
import { installAppointmentScopeResolvers } from '../modules/appointments'
import { installBillingScopeResolvers } from '../modules/billing'
import { installEncounterScopeResolvers } from '../modules/clinical'
import { installDoctorScopeResolvers } from '../modules/doctors'
import { installFileScopeResolvers } from '../modules/files'
import { installPatientScopeResolvers } from '../modules/patients'
import { installPrescriptionScopeResolvers } from '../modules/prescriptions'

/**
 * Section 7.5: a narrow grant on a subject with no registered resolver DENIES. That is the right
 * default — forgetting one must never open a door — but it also means a resolver nobody
 * registered silently locks people out of their own records. It took a doctor being refused
 * their own working week to notice, so it is checked here instead.
 *
 * Subjects below arrive with their modules in later phases. Each is a deliberate line: deleting
 * one when the module lands is how the check keeps working.
 */
const NOT_BUILT_YET = new Set(['ticket'])

const actor: Actor = {
  kind: 'USER',
  userId: 'u1',
  clinicId: 'c1',
  displayName: 'Test Actor',
  roleKeys: [],
  permissions: new Map(),
  portals: [],
  preferredPortal: null,
  sessionId: 's1',
}

beforeAll(() => {
  clearScopeResolvers()
  installDefaultScopeResolvers()
  installPatientScopeResolvers()
  installDoctorScopeResolvers()
  installAppointmentScopeResolvers()
  installEncounterScopeResolvers()
  installPrescriptionScopeResolvers()
  installFileScopeResolvers()
  installBillingScopeResolvers()
})

describe('scope resolvers', () => {
  it('exist for every subject a system role grants at OWN or ASSIGNED', async () => {
    const narrow = SYSTEM_ROLES.flatMap((role) =>
      role.grants.filter((grant) => grant.scope === 'OWN' || grant.scope === 'ASSIGNED'),
    ).filter((grant) => !NOT_BUILT_YET.has(subjectOf(grant.key)))

    const unresolved: string[] = []
    for (const grant of narrow) {
      const decision = await decide(
        { ...actor, permissions: new Map([[grant.key, grant.scope]]) },
        grant.key,
        {
          clinicId: 'c1',
          id: 'anything',
        },
      )
      if (!decision.allowed && decision.reason === 'NO_SCOPE_RESOLVER') unresolved.push(grant.key)
    }

    expect([...new Set(unresolved)]).toEqual([])
    // A guard that checked nothing would also pass.
    expect(narrow.length).toBeGreaterThan(10)
  })

  it('lets a doctor reach their own schedule, and no colleague’s', async () => {
    const doctor: Actor = {
      ...actor,
      permissions: new Map([
        ['availability:read', 'OWN'],
        ['availability:manage', 'OWN'],
      ]),
    }
    const own = { clinicId: 'c1', type: 'Doctor', id: 'd1', userId: 'u1' }
    const colleague = { clinicId: 'c1', type: 'Doctor', id: 'd2', userId: 'u2' }

    expect(await decide(doctor, 'availability:read', own)).toEqual({ allowed: true, scope: 'OWN' })
    expect(await decide(doctor, 'availability:manage', own)).toEqual({
      allowed: true,
      scope: 'OWN',
    })
    expect(await decide(doctor, 'availability:manage', colleague)).toEqual({
      allowed: false,
      reason: 'OUT_OF_SCOPE',
    })
  })
})
