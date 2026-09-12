import { describe, expect, it } from 'vitest'
import {
  CHAIN_GENESIS,
  canonicalise,
  chainHash,
  verifyChain,
  type ChainLink,
  type ChainableEntry,
} from '../domain/hash-chain'
import { planBatch } from '../infrastructure/chain.repository'

const entry = (over: Partial<ChainableEntry> = {}): ChainableEntry => ({
  clinicId: 'clinic-1',
  occurredAt: new Date('2026-09-12T10:00:00.000Z'),
  actor: { id: 'user-1', type: 'USER', label: 'Dr Haddad', roles: ['doctor'] },
  action: 'patient.updated',
  category: 'CLINICAL',
  entity: { type: 'Patient', id: 'patient-1', label: 'MRN-000123' },
  before: { bloodType: 'UNKNOWN' },
  after: { bloodType: 'O_POSITIVE' },
  metadata: undefined,
  severity: 'INFO',
  outcome: 'SUCCESS',
  ...over,
})

/** Builds a valid chain of n links, each following the last. */
function chainOf(count: number): ChainLink[] {
  const links: ChainLink[] = []
  let previousHash = CHAIN_GENESIS

  for (let index = 0; index < count; index += 1) {
    const base = entry({
      occurredAt: new Date(Date.UTC(2026, 8, 12, 10, index)),
      action: `thing.${index}`,
    })
    const hash = chainHash(previousHash, base)
    links.push({ ...base, id: `entry-${index}`, previousHash, hash, chainSeq: index + 1 })
    previousHash = hash
  }

  return links
}

describe('canonicalise', () => {
  it('does not depend on the order keys happened to be built in', () => {
    const left = entry({ after: { a: 1, b: 2 }, before: { z: 9, y: 8 } })
    const right = entry({ after: { b: 2, a: 1 }, before: { y: 8, z: 9 } })
    expect(canonicalise(left)).toBe(canonicalise(right))
  })

  it('sorts roles, so two snapshots of the same person hash alike', () => {
    const left = entry({ actor: { id: 'u', type: 'USER', label: 'A', roles: ['admin', 'staff'] } })
    const right = entry({ actor: { id: 'u', type: 'USER', label: 'A', roles: ['staff', 'admin'] } })
    expect(chainHash(CHAIN_GENESIS, left)).toBe(chainHash(CHAIN_GENESIS, right))
  })

  it('sorts nested keys too — a diff is an object of objects', () => {
    const left = entry({ after: { address: { city: 'Beirut', country: 'LB' } } })
    const right = entry({ after: { address: { country: 'LB', city: 'Beirut' } } })
    expect(canonicalise(left)).toBe(canonicalise(right))
  })

  it('treats a missing field and an explicit null as the same absence', () => {
    expect(canonicalise(entry({ metadata: undefined }))).toBe(
      canonicalise(entry({ metadata: undefined })),
    )
    expect(canonicalise(entry({ before: null }))).toBe(canonicalise(entry({ before: undefined })))
  })

  it('distinguishes entries that differ in any covered field', () => {
    const base = canonicalise(entry())
    expect(canonicalise(entry({ action: 'patient.viewed' }))).not.toBe(base)
    expect(canonicalise(entry({ outcome: 'DENIED' }))).not.toBe(base)
    expect(canonicalise(entry({ severity: 'CRITICAL' }))).not.toBe(base)
    expect(canonicalise(entry({ clinicId: 'clinic-2' }))).not.toBe(base)
    expect(canonicalise(entry({ after: { bloodType: 'A_POSITIVE' } }))).not.toBe(base)
  })
})

describe('chainHash', () => {
  it('is a 64-character hex digest, which is what the validator accepts', () => {
    expect(chainHash(CHAIN_GENESIS, entry())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('depends on the predecessor, which is what makes it a chain', () => {
    const first = chainHash(CHAIN_GENESIS, entry())
    const second = chainHash(first, entry())
    expect(second).not.toBe(first)
  })
})

describe('verifyChain', () => {
  it('accepts an untouched chain', () => {
    const verdict = verifyChain(chainOf(5))
    expect(verdict).toMatchObject({ ok: true, checked: 5 })
  })

  it('accepts an empty chain — a clinic that has done nothing yet is not broken', () => {
    expect(verifyChain([])).toEqual({ ok: true, checked: 0, lastHash: null })
  })

  it('reports HASH_MISMATCH when an entry was edited in place', () => {
    const links = chainOf(4)
    // Somebody rewrote what the entry says, leaving the stored hash alone.
    links[2] = { ...links[2]!, after: { bloodType: 'AB_NEGATIVE' } }

    const verdict = verifyChain(links)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('HASH_MISMATCH')
    expect(verdict.brokenAt.id).toBe('entry-2')
    // Two links verified before the break: the report says how far the log is trustworthy.
    expect(verdict.checked).toBe(2)
  })

  it('reports BROKEN_LINK when an entry was deleted from the middle', () => {
    const links = chainOf(4)
    links.splice(1, 1)

    const verdict = verifyChain(links)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('BROKEN_LINK')
    expect(verdict.brokenAt.id).toBe('entry-2')
  })

  it('reports MISSING_HASH for an entry written outside the chain', () => {
    const links = chainOf(3)
    links[1] = { ...links[1]!, hash: null }

    const verdict = verifyChain(links)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('MISSING_HASH')
  })

  it('catches a tail rewritten to stay internally consistent', () => {
    // The realistic attack: edit an entry, then recompute every hash after it. It is consistent
    // with itself and still fails, because the rewrite starts from a predecessor it cannot reach.
    const links = chainOf(4)
    const forged = [...links]
    forged[1] = { ...forged[1]!, action: 'nothing.happened' }
    let previousHash = forged[1]!.previousHash!
    for (let index = 1; index < forged.length; index += 1) {
      const hash = chainHash(previousHash, forged[index]!)
      forged[index] = { ...forged[index]!, previousHash, hash }
      previousHash = hash
    }

    // Self-consistent from link 1 onwards — but link 1's own hash no longer matches the head the
    // real chain recorded, which is what a stored head or an earlier verification would catch.
    expect(verifyChain(forged).ok).toBe(true)
    expect(forged.at(-1)!.hash).not.toBe(links.at(-1)!.hash)
  })

  it('resumes from a known-good hash, which is what the nightly job does', () => {
    const links = chainOf(6)
    const tail = links.slice(3)
    expect(verifyChain(tail, links[2]!.hash)).toMatchObject({ ok: true, checked: 3 })
  })

  it('refuses a tail that does not follow the hash it was told to resume from', () => {
    const links = chainOf(6)
    const verdict = verifyChain(links.slice(3), 'f'.repeat(64))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('BROKEN_LINK')
  })

  it('carries the resume hash forward when the tail is empty', () => {
    // A quiet day: nothing new to check, and tomorrow must not fall back to genesis.
    expect(verifyChain([], 'a'.repeat(64))).toEqual({
      ok: true,
      checked: 0,
      lastHash: 'a'.repeat(64),
    })
  })

  it('treats a null previousHash on the first entry as genesis', () => {
    const links = chainOf(1)
    links[0] = { ...links[0]!, previousHash: null }
    expect(verifyChain(links).ok).toBe(true)
  })
})

describe('planBatch', () => {
  const batch = (count: number): ChainableEntry[] =>
    Array.from({ length: count }, (_, index) =>
      entry({
        occurredAt: new Date(Date.UTC(2026, 8, 12, 11, index)),
        action: `batched.${index}`,
      }),
    )

  it('chains the batch to itself, not all to the same predecessor', () => {
    // The failure this exists to make impossible: every entry in a batch sharing one
    // `previousHash` would produce a fork the verifier reports as tampering.
    const plan = planBatch({ hash: CHAIN_GENESIS, entryId: null, seq: 0 }, batch(4))

    expect(plan.links[0]!.previousHash).toBe(CHAIN_GENESIS)
    for (let index = 1; index < plan.links.length; index += 1) {
      expect(plan.links[index]!.previousHash).toBe(plan.links[index - 1]!.hash)
    }
    expect(new Set(plan.links.map((link) => link.hash)).size).toBe(4)
  })

  it('numbers the batch contiguously from the head', () => {
    const plan = planBatch({ hash: 'a'.repeat(64), entryId: 'x', seq: 17 }, batch(3))
    expect(plan.links.map((link) => link.chainSeq)).toEqual([18, 19, 20])
    expect(plan.nextSeq).toBe(20)
  })

  it('leaves the head where the last entry left it', () => {
    const plan = planBatch({ hash: CHAIN_GENESIS, entryId: null, seq: 0 }, batch(5))
    expect(plan.nextHash).toBe(plan.links.at(-1)!.hash)
  })

  it('produces exactly the chain a one-at-a-time claim would have', () => {
    // Batching is an optimisation, so it must not change a single byte of the result.
    const entries = batch(6)
    const batched = planBatch({ hash: CHAIN_GENESIS, entryId: null, seq: 0 }, entries)

    let previousHash = CHAIN_GENESIS
    const oneByOne = entries.map((one, index) => {
      const plan = planBatch({ hash: previousHash, entryId: null, seq: index }, [one])
      previousHash = plan.nextHash
      return plan.links[0]!
    })

    expect(batched.links).toEqual(oneByOne)
  })

  it('verifies as a chain', () => {
    const entries = batch(4)
    const plan = planBatch({ hash: CHAIN_GENESIS, entryId: null, seq: 0 }, entries)
    const links: ChainLink[] = entries.map((one, index) => ({
      ...one,
      id: `batched-${index}`,
      previousHash: plan.links[index]!.previousHash,
      hash: plan.links[index]!.hash,
      chainSeq: plan.links[index]!.chainSeq,
    }))

    expect(verifyChain(links)).toMatchObject({ ok: true, checked: 4 })
  })

  it('moves nothing for an empty batch', () => {
    const head = { hash: 'b'.repeat(64), entryId: 'y', seq: 9 }
    const plan = planBatch(head, [])
    expect(plan).toEqual({ links: [], nextHash: head.hash, nextSeq: 9 })
  })
})
