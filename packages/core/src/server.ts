import { env, processSingleton } from '@clinic/config'
import { installDefaultScopeResolvers, provideCareRelationship } from './modules/access'
import { flushAudit, installAuditCapture } from './modules/audit'
import { installAppointmentScopeResolvers } from './modules/appointments'
import { installBillingScopeResolvers } from './modules/billing'
import { careRelationshipFromEncounters, installEncounterScopeResolvers } from './modules/clinical'
import { installDoctorScopeResolvers } from './modules/doctors'
import { installFileScopeResolvers } from './modules/files'
import { installPatientScopeResolvers } from './modules/patients'
import { installPrescriptionScopeResolvers } from './modules/prescriptions'
import { installTicketScopeResolvers } from './modules/support'

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
  installBillingScopeResolvers()
  installTicketScopeResolvers()
  // "Is this patient one of mine?" is asked by authorisation and answered by visits; the two
  // modules never import each other, so the composition root is where they meet (ADR-0004).
  provideCareRelationship(careRelationshipFromEncounters)
  installAuditCapture()
  bootstrap.started = true
}

/**
 * Opening and closing the database, for a process that owns its own lifecycle.
 *
 * The web app never calls these — Next.js starts the connection lazily on first use — but the
 * worker is a long-running process that has to connect before it can watch anything and
 * disconnect when it stops. They are re-exported here rather than imported from `@clinic/db`
 * directly because an app reaching for the driver is exactly what section 6 forbids, and the
 * composition root is the one place allowed to know both sides.
 */
export { connect, disconnect } from '@clinic/db'

/** Waits for in-flight audit writes. Call on graceful shutdown. */
export { flushAudit }

/**
 * The push sender, so a deployment can swap Expo's relay for APNs/FCM and a test can install a
 * double without reaching into the notifications module. Same seam as the mailer.
 */
export { push, providePushSender, type PushMessage, type PushResult } from './push'
