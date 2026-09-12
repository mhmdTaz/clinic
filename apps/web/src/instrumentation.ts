/**
 * Runs once when the server process starts, before it handles any request. Until it
 * has, a write to an audited model throws rather than going unrecorded.
 */
export async function register(): Promise<void> {
  const { bootstrapServer } = await import('@clinic/core/server')
  bootstrapServer()
  // Server components have no callback to scope an audit context to, so core is handed a way to
  // ask React for the current request's one. Without it every page render writes entries with no
  // actor. See lib/auth/request-scope.ts.
  const { installRequestContextResolver } = await import('@/lib/auth/request-scope')
  installRequestContextResolver()
}
