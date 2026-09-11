/**
 * A value shared by the whole server process, however many copies of this code the
 * bundler made.
 *
 * Next.js compiles instrumentation, route handlers and pages as separate bundles, and each
 * can carry its own copy of every workspace package. A plain module-level variable set in
 * one copy is invisible to the others — the audit sink installed at startup was still null
 * in the route that signs people in. State that one part of the process sets and another
 * reads (the audit sink, the request context, the scope resolvers, shared connections)
 * lives on globalThis under a registered symbol instead.
 *
 * Pure caches that are merely recomputed per copy do not need this.
 */
export function processSingleton<T>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<symbol, unknown>
  const slot = Symbol.for(`clinic:${key}`)
  if (!(slot in store)) store[slot] = create()
  return store[slot] as T
}
