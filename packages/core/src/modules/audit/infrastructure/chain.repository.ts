import { processSingleton } from '@clinic/config'
import { AuditChainHeadModel, AuditLogModel } from '@clinic/db'
import { CHAIN_GENESIS, chainHash, type ChainableEntry, type ChainLink } from '../domain/hash-chain'

/**
 * The chain head: where a clinic's audit chain currently ends (section 11.5).
 *
 * **Advancing it is a compare-and-swap, and that is the whole design.** Two audit writes racing
 * both read the same head; without the CAS both would claim the same predecessor and produce a
 * fork, which a verifier would report as tampering that never happened. The loser of the swap has
 * not written anything yet, so it simply re-reads and recomputes.
 *
 * The head also hands out the chain **position**, which matters more than it first looks. The
 * chain's order is the order links were *claimed*, and `occurredAt` is stamped earlier, at the
 * call site. Two concurrent writes can therefore be timestamped in one order and claimed in the
 * other — so a verifier walking by timestamp finds entry A pointing at entry B's hash and reports
 * tampering that never happened. `seq` is assigned by the swap itself, so it **is** the chain
 * order rather than an approximation of it.
 *
 * Lives on the audit connection with the log itself, because the restricted role that may insert
 * into `auditLogs` is the only thing that should be able to move the head either.
 */
interface HeadRecord {
  _id: string
  hash: string
  entryId: string | null
  seq?: number
  updatedAt?: Date
  verifiedAt?: Date | null
  verifiedHash?: string | null
  verifiedSeq?: number | null
  fullyVerifiedAt?: Date | null
}

export interface ChainHead {
  hash: string
  entryId: string | null
  /** How many links the chain holds. The next claim takes `seq + 1`; genesis is 0. */
  seq: number
}

/**
 * Where the nightly verifier got to.
 *
 * A bookmark rather than evidence: it exists so the job can resume instead of re-walking the
 * whole chain every night. It proves nothing on its own — anyone able to forge it could already
 * move the head — which is why a full walk from genesis still runs weekly and on demand.
 */
export interface ChainCheckpoint {
  verifiedAt: Date | null
  verifiedHash: string | null
  verifiedSeq: number
  fullyVerifiedAt: Date | null
}

/**
 * The entity an entry names, or nothing.
 *
 * Mongoose materialises a nested path even when the caller set none, so an entry written with no
 * entity reads back as `{ ids: [] }` — truthy, and enough to make the canonical form differ from
 * the one that was hashed. Every entry without an entity would then fail verification, which is
 * the sort of false alarm that gets a tamper check switched off. An entity with no `type` is not
 * an entity.
 */
function readEntity(value: unknown): ChainLink['entity'] {
  if (!value || typeof value !== 'object') return undefined
  const entity = value as { type?: unknown; id?: unknown; label?: unknown }
  if (typeof entity.type !== 'string' || entity.type === '') return undefined
  return {
    type: entity.type,
    id: (entity.id as string | null | undefined) ?? null,
    label: (entity.label as string | null | undefined) ?? null,
  }
}

export const chainRepository = {
  async readHead(clinicId: string): Promise<ChainHead> {
    const doc = (await AuditChainHeadModel().findById(clinicId).lean()) as HeadRecord | null
    return {
      hash: doc?.hash ?? CHAIN_GENESIS,
      entryId: doc?.entryId ?? null,
      seq: doc?.seq ?? 0,
    }
  },

  /**
   * Moves the head from `expected` to `next`, or fails because somebody else moved it first.
   *
   * `upsert` cannot be used with a filter on the current value — an upsert whose filter does not
   * match inserts a *new* document rather than failing — so the genesis case is its own insert,
   * and a duplicate key there means another writer created it in the same instant, which is
   * exactly the collision the caller must retry.
   */
  async advanceHead(
    clinicId: string,
    expected: ChainHead,
    next: { hash: string; entryId: string; seq: number },
  ): Promise<boolean> {
    const seq = next.seq

    if (expected.hash === CHAIN_GENESIS && expected.seq === 0) {
      try {
        await AuditChainHeadModel().create({
          _id: clinicId,
          hash: next.hash,
          entryId: next.entryId,
          seq,
          updatedAt: new Date(),
        })
        return true
      } catch (error) {
        // 11000: somebody created the head first. Not an error, just a lost race.
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: number }).code === 11000
        ) {
          return false
        }
        throw error
      }
    }

    // Both the hash and the position are in the filter: matching on the hash alone would let a
    // head somebody had reset to an earlier position be advanced into a duplicate seq.
    const result = await AuditChainHeadModel().updateOne(
      { _id: clinicId, hash: expected.hash, seq: expected.seq },
      { $set: { hash: next.hash, entryId: next.entryId, seq, updatedAt: new Date() } },
    )
    return result.modifiedCount > 0
  },

  /** Entries written before the chain existed. Reported, never silently ignored. */
  async countUnchained(clinicId: string): Promise<number> {
    return AuditLogModel().countDocuments({ clinicId, chainSeq: { $exists: false } })
  },

  async readCheckpoint(clinicId: string): Promise<ChainCheckpoint> {
    const doc = (await AuditChainHeadModel().findById(clinicId).lean()) as HeadRecord | null
    return {
      verifiedAt: doc?.verifiedAt ?? null,
      verifiedHash: doc?.verifiedHash ?? null,
      verifiedSeq: doc?.verifiedSeq ?? 0,
      fullyVerifiedAt: doc?.fullyVerifiedAt ?? null,
    }
  },

  /**
   * Moves the bookmark forward.
   *
   * Unconditional, unlike `advanceHead`: two verifiers racing would write the same answer, and a
   * bookmark that lost a race would only cost the next run some repeated work. `fullyVerifiedAt`
   * is stamped only when the walk actually started at genesis.
   */
  async writeCheckpoint(
    clinicId: string,
    checkpoint: { verifiedAt: Date; verifiedHash: string | null; verifiedSeq: number },
    wasFullWalk: boolean,
  ): Promise<void> {
    await AuditChainHeadModel().updateOne(
      { _id: clinicId },
      {
        $set: {
          verifiedAt: checkpoint.verifiedAt,
          verifiedHash: checkpoint.verifiedHash,
          verifiedSeq: checkpoint.verifiedSeq,
          ...(wasFullWalk ? { fullyVerifiedAt: checkpoint.verifiedAt } : {}),
        },
      },
    )
  },

  /**
   * A clinic's chain in the order it was **claimed**, for the verifier.
   *
   * Ordered by `chainSeq`, the only ordering that is the chain's own. `afterSeq` lets the nightly
   * job verify just what is new rather than re-reading seven years every night — and being an
   * integer it has no same-millisecond boundary to get wrong.
   *
   * **Entries with no `chainSeq` are outside the chain and are not walked.** The chain was
   * introduced over a log that already existed, so every entry written before Phase 8 has no
   * position and no hash; treating those as breaks would leave every existing installation
   * permanently reporting tampering, which is the fastest way to make a tamper alarm ignored.
   *
   * That is not a hole an attacker can use. Stripping the fields from an entry in the middle
   * still breaks the *following* entry's link, and stripping them from the last one is
   * truncation, which the recorded head catches. What it does mean is that the chain covers a
   * known suffix of the log rather than all of it — so `countUnchained` exists, and the explorer
   * says how many entries are not covered rather than implying they are.
   */
  async links(
    clinicId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): Promise<ChainLink[]> {
    const query: Record<string, unknown> = { clinicId, chainSeq: { $exists: true } }
    if (options.afterSeq !== undefined && options.afterSeq > 0) {
      query.chainSeq = { $exists: true, $gt: options.afterSeq }
    }

    const docs = await AuditLogModel()
      .find(query)
      .sort({ chainSeq: 1 })
      .limit(options.limit ?? 5_000)
      .lean()

    return (docs as unknown as Array<Record<string, unknown>>).map((doc) => ({
      id: String(doc._id),
      clinicId: String(doc.clinicId),
      occurredAt: doc.occurredAt as Date,
      actor: doc.actor as ChainLink['actor'],
      action: String(doc.action),
      category: String(doc.category),
      entity: readEntity(doc.entity),
      before: doc.before as ChainLink['before'],
      after: doc.after as ChainLink['after'],
      metadata: doc.metadata as ChainLink['metadata'],
      severity: String(doc.severity),
      outcome: String(doc.outcome),
      previousHash: (doc.previousHash as string | undefined) ?? null,
      hash: (doc.hash as string | undefined) ?? null,
      chainSeq: (doc.chainSeq as number | undefined) ?? null,
    }))
  },
}

/**
 * Claiming links in a clinic's chain.
 *
 * A claim returns the hashes and the position to store on an entry, having already advanced the
 * head. The caller inserts immediately afterwards; a crash in that window leaves the head ahead
 * of the log, which the verifier reports as a broken link.
 *
 * **That is the right failure direction.** A crash during an audit write is itself something to
 * look at, and tamper evidence that errs towards "something is wrong here" is worth more than one
 * that errs towards silence.
 *
 * ## Why claims are queued, and then batched
 *
 * The head is a single document and advancing it is a compare-and-swap, so every audit write in a
 * clinic contends for the same row. Under load that is not a rare collision: one request produces
 * several capture entries, and a handful of concurrent requests has twenty writers racing.
 * Retrying alone turns that into a thundering herd — every loser immediately re-reads the same
 * head and races again — and a writer that runs out of attempts **drops an audit entry**, which is
 * the one thing this subsystem may never do. So claims are serialised per clinic within the
 * process, leaving the CAS to do what it is actually for: settling races between processes.
 *
 * **Serialising alone is not enough, and the first version of this was a performance bug.** A
 * queue where each claim costs two round trips caps the whole clinic at a few hundred audit writes
 * a second, and `recordAudit` is *awaited* on paths that matter — replying to a ticket, recording
 * a payment. Every one of those then waits behind the entire backlog of fire-and-forget capture
 * writes, so a busy clinic makes its own requests slow, without bound. It passed locally and hung
 * a journey in CI, which is exactly how this class of fault presents.
 *
 * Batching removes the ceiling. Whatever is waiting when the drainer comes round is chained
 * together in memory and the head is advanced **once**, so N entries cost two round trips rather
 * than 2N. A single claim on an idle clinic is unchanged; a burst gets dramatically cheaper, which
 * is the shape of the load.
 */

interface PendingClaim {
  entry: ChainableEntry
  entryId: string
  settle: (result: ClaimedLink) => void
  fail: (error: unknown) => void
}

/**
 * What is waiting, and who is draining it — per clinic, process-wide.
 *
 * Process-wide for the same reason as everything else here: two bundle copies of this module must
 * share one queue rather than each serialising against itself while colliding with the other.
 */
const claimState = processSingleton('audit:chain-claims', () => ({
  waiting: new Map<string, PendingClaim[]>(),
  draining: new Set<string>(),
}))

/** How many cross-process collisions one batch will sit through before giving up. */
const MAX_ATTEMPTS = 25

/**
 * A ceiling on one swap.
 *
 * Not for the database — the head write is the same size either way — but for the failure
 * window: everything in a batch has its hashes minted before any of it is inserted, so a crash
 * loses the batch. Smaller batches lose less, and past a couple of hundred the round-trip saving
 * has long since flattened out.
 */
const MAX_BATCH = 200

export interface ClaimedLink {
  previousHash: string
  hash: string
  chainSeq: number
}

export function claimLink(entry: ChainableEntry, entryId: string): Promise<ClaimedLink> {
  return new Promise<ClaimedLink>((settle, fail) => {
    const queue = claimState.waiting.get(entry.clinicId) ?? []
    queue.push({ entry, entryId, settle, fail })
    claimState.waiting.set(entry.clinicId, queue)
    void drain(entry.clinicId)
  })
}

/**
 * The links a batch takes, and where the head ends up.
 *
 * Pure, and separated out for that reason: the chaining *within* a batch is the part that would
 * be silently wrong — a shared `previousHash` across the batch, or positions that collide — and
 * it should be provable without a database.
 */
export function planBatch(
  head: ChainHead,
  entries: ReadonlyArray<ChainableEntry>,
): { links: ClaimedLink[]; nextHash: string; nextSeq: number } {
  const links: ClaimedLink[] = []
  let previousHash = head.hash

  entries.forEach((entry, index) => {
    const hash = chainHash(previousHash, entry)
    links.push({ previousHash, hash, chainSeq: head.seq + index + 1 })
    previousHash = hash
  })

  return { links, nextHash: previousHash, nextSeq: head.seq + entries.length }
}

async function drain(clinicId: string): Promise<void> {
  if (claimState.draining.has(clinicId)) return
  claimState.draining.add(clinicId)

  try {
    for (;;) {
      const queue = claimState.waiting.get(clinicId)
      if (!queue || queue.length === 0) break

      // Everything that arrived while the last batch was in flight, up to the cap.
      const batch = queue.splice(0, MAX_BATCH)
      if (queue.length === 0) claimState.waiting.delete(clinicId)

      await claimBatch(clinicId, batch)
    }
  } finally {
    claimState.draining.delete(clinicId)
    // Something may have arrived between the last check and releasing the flag.
    if ((claimState.waiting.get(clinicId)?.length ?? 0) > 0) void drain(clinicId)
  }
}

async function claimBatch(clinicId: string, batch: PendingClaim[]): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const head = await chainRepository.readHead(clinicId)
      const plan = planBatch(
        head,
        batch.map((item) => item.entry),
      )

      const won = await chainRepository.advanceHead(clinicId, head, {
        hash: plan.nextHash,
        // The last entry in the batch is where the head now points.
        entryId: batch[batch.length - 1]?.entryId ?? '',
        seq: plan.nextSeq,
      })

      if (won) {
        batch.forEach((item, index) => {
          item.settle(plan.links[index]!)
        })
        return
      }
    } catch (error) {
      // A database failure is not a lost race, and retrying it 25 times would only delay the
      // report. Everybody in the batch hears the same reason.
      for (const item of batch) item.fail(error)
      return
    }

    // Jittered, so two processes that collided do not collide again on the same schedule.
    await sleep(Math.min(2 ** attempt, 32) * (1 + Math.random()))
  }

  // Sustained contention from outside this process, which is a real operational problem and not
  // one to paper over by writing unchained entries.
  const exhausted = new Error(`Could not claim an audit chain link for clinic ${clinicId}`)
  for (const item of batch) item.fail(exhausted)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
