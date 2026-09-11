/**
 * Runs once when the server process starts, before it handles any request. Until it
 * has, a write to an audited model throws rather than going unrecorded.
 */
export async function register(): Promise<void> {
  const { bootstrapServer } = await import('@clinic/core/server')
  bootstrapServer()
}
