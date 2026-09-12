import { AsyncLocalStorage } from 'node:async_hooks'
import { processSingleton } from '@clinic/config'

/**
 * Ambient actor context (section 11.2).
 *
 * The audit middleware needs to know WHO is acting, but it fires from deep inside
 * repositories that have no idea a request exists. Threading an actor through every
 * function signature would poison every API in the codebase, so it travels out of
 * band instead.
 */
export type ActorType = 'USER' | 'SYSTEM' | 'API_CLIENT' | 'ANONYMOUS'

export interface RequestContext {
  requestId: string
  actorId?: string
  actorType: ActorType
  actorLabel?: string
  actorRoles: string[]
  clinicId?: string
  impersonatorId?: string
  ipAddress?: string
  userAgent?: string
}

// Process-wide: the audit sink installed at startup reads the context a route opened, and
// the two can be different bundle copies of this module. Two stores would mean audit
// entries with no actor, and no error to say so.
const storage = processSingleton(
  'core:request-context',
  () => new AsyncLocalStorage<RequestContext>(),
)

export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn)
}

/**
 * A second way to answer "who is acting", for callers that cannot provide a callback.
 *
 * `runWithContext` needs something to enclose, and a **server component does not have one**: a
 * page establishes who is acting in one helper and then *renders*, and the render is not a
 * callback anybody can wrap. `AsyncLocalStorage.enterWith` does not help either — it sets the
 * store for the current execution context, and an async helper that returns hands control back to
 * the caller's context, which never had it.
 *
 * Without a second mechanism, every audit entry produced by a page render records `actor: null`,
 * no request id and no address. For a system whose first question is "who viewed this patient's
 * file", that is the log failing at the one thing it exists for — and failing silently, on
 * exactly the pages people actually use.
 *
 * So the delivery layer may register a resolver that knows how to find the current request's
 * context by its own means — React's per-request `cache()` in the web app's case. Core stays
 * framework-free: it knows only that something can answer the question.
 *
 * The ALS store still wins where it is set. A route handler's explicit scope is more precise than
 * any ambient lookup, and nesting one inside a render must not read the outer request's actor.
 */
type ContextResolver = () => RequestContext | undefined

// Process-wide for the same reason as the store: the audit sink and the app can be different
// bundle copies of this module.
const resolver = processSingleton('core:request-context-resolver', () => ({
  current: undefined as ContextResolver | undefined,
}))

export function provideContextResolver(next: ContextResolver | null): void {
  resolver.current = next ?? undefined
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore() ?? resolver.current?.()
}

/** For background jobs, which act as the system rather than as a user. */
export function systemContext(requestId: string, clinicId?: string): RequestContext {
  return { requestId, actorType: 'SYSTEM', actorLabel: 'system', actorRoles: [], clinicId }
}
