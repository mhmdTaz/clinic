import { runWithContext, type RequestContext } from '@clinic/core'
import { newId } from '@clinic/db'

/** Runs `fn` inside a plausible request context, so audit-aware code behaves normally. */
export function withTestContext<T>(
  overrides: Partial<RequestContext>,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithContext(
    {
      requestId: newId(),
      actorType: 'USER',
      actorId: newId(),
      actorLabel: 'Test Actor',
      actorRoles: ['admin'],
      ...overrides,
    },
    fn,
  )
}
