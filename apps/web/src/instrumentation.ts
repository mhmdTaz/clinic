/**
 * Runs once when the server process starts, before it handles any request. Until it
 * has, a write to an audited model throws rather than going unrecorded.
 */
export async function register(): Promise<void> {
  // The hook is compiled for the edge runtime as well. The server's modules — argon2's native
  // binding among them — cannot be bundled there, and `next dev` fails to compile if they are
  // reachable. The literal comparison in an `if` block is what lets the compiler drop the imports
  // from that bundle; an early return would not. NEXT_RUNTIME is a constant Next substitutes at
  // compile time, not configuration, so it cannot come from @clinic/config.
  // eslint-disable-next-line no-restricted-syntax
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { bootstrapServer } = await import('@clinic/core/server')
    bootstrapServer()
    // Server components have no callback to scope an audit context to, so core is handed a way to
    // ask React for the current request's one. Without it every page render writes entries with
    // no actor. See lib/auth/request-scope.ts.
    const { installRequestContextResolver } = await import('@/lib/auth/request-scope')
    installRequestContextResolver()
  }
}
