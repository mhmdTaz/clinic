import { describe, expect, it } from 'vitest'
import { currentContext, runWithContext, systemContext } from '../context/request-context'

describe('request context', () => {
  it('is undefined outside a run', () => {
    expect(currentContext()).toBeUndefined()
  })

  it('is visible to code that never received it as an argument', async () => {
    const deeplyNested = async () => currentContext()?.actorId
    const actorId = await runWithContext(
      { requestId: 'r1', actorType: 'USER', actorId: 'u1', actorRoles: ['admin'] },
      async () => deeplyNested(),
    )
    expect(actorId).toBe('u1')
  })

  it('does not leak between concurrent runs', async () => {
    const capture = async (id: string) =>
      runWithContext(
        { requestId: id, actorType: 'USER', actorId: id, actorRoles: [] },
        async () => {
          await new Promise((r) => setTimeout(r, 10))
          return currentContext()?.actorId
        },
      )

    const [a, b] = await Promise.all([capture('a'), capture('b')])
    expect(a).toBe('a')
    expect(b).toBe('b')
  })

  it('builds a system context for background jobs', () => {
    expect(systemContext('job-1', 'c1').actorType).toBe('SYSTEM')
  })
})
