import { afterEach, describe, expect, it, vi } from 'vitest'
import { processSingleton } from '../process-singleton'

const KEYS = ['test:shared', 'test:other', 'test:nullable', 'test:copies']

afterEach(() => {
  const store = globalThis as unknown as Record<symbol, unknown>
  for (const key of KEYS) delete store[Symbol.for(`clinic:${key}`)]
})

describe('processSingleton', () => {
  it('creates the value once and hands the same one back', () => {
    const create = vi.fn(() => ({ count: 0 }))
    const first = processSingleton('test:shared', create)
    first.count += 1

    expect(processSingleton('test:shared', create)).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps different keys apart', () => {
    expect(processSingleton('test:shared', () => ({}))).not.toBe(
      processSingleton('test:other', () => ({})),
    )
  })

  it('remembers a null value instead of creating it again', () => {
    const create = vi.fn(() => null)
    processSingleton('test:nullable', create)
    processSingleton('test:nullable', create)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('is shared by separately loaded copies of the module, the way separate bundles load it', async () => {
    vi.resetModules()
    const copyA = await import('../process-singleton')
    vi.resetModules()
    const copyB = await import('../process-singleton')
    // Without this the test could pass against a single copy and prove nothing.
    expect(copyA.processSingleton).not.toBe(copyB.processSingleton)

    const value = copyA.processSingleton('test:copies', () => ({ from: 'A' }))
    expect(copyB.processSingleton('test:copies', () => ({ from: 'B' }))).toBe(value)
  })
})
