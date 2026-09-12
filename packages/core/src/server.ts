import { env, processSingleton } from '@clinic/config'
import { installDefaultScopeResolvers, provideCareRelationship } from './modules/access'
import { flushAudit, installAuditCapture } from './modules/audit'
import { installAppointmentScopeResolvers } from './modules/appointments'
import { careRelationshipFromEncounters, installEncounterScopeResolvers } from './modules/clinical'
import { installDoctorScopeResolvers } from './modules/doctors'
import { installFileScopeResolvers } from './modules/files'
import { installPatientScopeResolvers } from './modules/patients'
import { installPrescriptionScopeResolvers } from './modules/prescriptions'

const bootstrap = processSingleton('core:bootstrap', () => ({ started: false }))

/**
 * Once per server process, before the first request:
 *  - parse the environment, so a bad deploy fails at boot rather than on first use (13.1)
 *  - register each module's scope resolvers (7.5); an unregistered subject denies
 *  - connect database writes to the audit log; until this runs, an audited write throws (11.3)
 *
 * Everything it installs is process-wide (see processSingleton): it runs in the
 * instrumentation bundle, and the route and page bundles must see the result.
 */
export function bootstrapServer(): void {
  if (bootstrap.started) return
  env()
  installDefaultScopeResolvers()
  installPatientScopeResolvers()
  installDoctorScopeResolvers()
  installAppointmentScopeResolvers()
  installEncounterScopeResolvers()
  installPrescriptionScopeResolvers()
  installFileScopeResolvers()
  // "Is this patient one of mine?" is asked by authorisation and answered by visits; the two
  // modules never import each other, so the composition root is where they meet (ADR-0004).
  provideCareRelationship(careRelationshipFromEncounters)
  installAuditCapture()
  bootstrap.started = true
}

/** Waits for in-flight audit writes. Call on graceful shutdown. */
export { flushAudit }
