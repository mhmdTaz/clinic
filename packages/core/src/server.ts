import { env, processSingleton } from '@clinic/config'
import { installDefaultScopeResolvers } from './modules/access'
import { flushAudit, installAuditCapture } from './modules/audit'
import { installAppointmentScopeResolvers } from './modules/appointments'
import { installDoctorScopeResolvers } from './modules/doctors'
import { installPatientScopeResolvers } from './modules/patients'

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
  installAuditCapture()
  bootstrap.started = true
}

/** Waits for in-flight audit writes. Call on graceful shutdown. */
export { flushAudit }
