import { env, processSingleton } from '@clinic/config'
import { installDefaultScopeResolvers } from './modules/access'
import { flushAudit, installAuditCapture } from './modules/audit'

const bootstrap = processSingleton('core:bootstrap', () => ({ started: false }))

/**
 * Once per server process, before the first request:
 *  - parse the environment, so a bad deploy fails at boot rather than on first use (13.1)
 *  - register the access module's own scope resolvers (7.5)
 *  - connect database writes to the audit log; until this runs, an audited write throws (11.3)
 *
 * Everything it installs is process-wide (see processSingleton): it runs in the
 * instrumentation bundle, and the route and page bundles must see the result.
 */
export function bootstrapServer(): void {
  if (bootstrap.started) return
  env()
  installDefaultScopeResolvers()
  installAuditCapture()
  bootstrap.started = true
}

/** Waits for in-flight audit writes. Call on graceful shutdown. */
export { flushAudit }
