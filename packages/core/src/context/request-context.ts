import { AsyncLocalStorage } from 'node:async_hooks'

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

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn)
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore()
}

/** For background jobs, which act as the system rather than as a user. */
export function systemContext(requestId: string, clinicId?: string): RequestContext {
  return { requestId, actorType: 'SYSTEM', actorLabel: 'system', actorRoles: [], clinicId }
}
