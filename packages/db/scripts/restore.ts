import './bootstrap-env'
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, openSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
// The driver, reached through mongoose rather than as a direct dependency: it is the same
// package, and a restore rehearsal has no business importing @clinic/core.
import { mongo } from 'mongoose'
import { describeRunner, findRunner, runTool, uriFor } from './mongo-tools'

/**
 * A **rehearsed** restore (section 16.1) — Phase 8's second exit criterion.
 *
 *   pnpm db:restore --from <backup directory> [--to <database name>] [--verify]
 *
 * An untested backup is a hope, not a backup, so this script does three things rather than one:
 *
 *  1. **checks the dump against its manifest** before touching anything. A truncated file is
 *     discovered here, not halfway through a restore during an outage.
 *  2. **restores into a scratch database by default**, never over the live one. Restoring over
 *     production is a decision somebody makes deliberately, with `--to <the live name>`, not
 *     something a script does because a flag was forgotten.
 *  3. **verifies what came back** against the recorded counts, the migration state, and — the
 *     part that actually proves the data is intact — the audit chain. A chain that still verifies
 *     over restored documents means every one of them came back byte-identical, because a single
 *     altered field anywhere breaks a hash.
 *
 * That last check is why the rehearsal is worth anything. Counts prove nothing about content;
 * the chain does.
 */

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const has = (name: string): boolean => args.includes(`--${name}`)

const CHECK = '✓'
const CROSS = '✗'

interface Manifest {
  database: string
  createdAt: string
  lastMigration: string | null
  counts: Record<string, number>
  archive: string
  bytes: number
  sha256: string
}

function sha256Of(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => done(hash.digest('hex')))
  })
}

/** The archive is what the manifest says it is, or the restore stops before touching anything. */
async function verifyArchive(archive: string, manifest: Manifest): Promise<void> {
  if (!existsSync(archive)) throw new Error(`No archive at ${archive}`)

  const bytes = statSync(archive).size
  if (bytes !== manifest.bytes) {
    throw new Error(`The archive is ${bytes} bytes; the manifest says ${manifest.bytes}.`)
  }

  const sha256 = await sha256Of(archive)
  if (sha256 !== manifest.sha256) {
    throw new Error(
      "The archive's checksum does not match the manifest.\n" +
        `  expected ${manifest.sha256}\n  got      ${sha256}\n` +
        'This backup is not usable. Take a fresh one, and find out why this one changed.',
    )
  }

  console.warn(`${CHECK} archive matches its manifest (${(bytes / 1024).toFixed(1)} KiB)`)
}

/** The same server, pointed at another database. */
function replace(uri: string, database: string): string {
  const url = new URL(uri)
  url.pathname = `/${database}`
  return url.toString()
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set.')

  const from = flag('from')
  if (!from) {
    throw new Error('Pass --from <backup directory>. `pnpm db:backup` prints the path it wrote.')
  }
  const directory = resolve(from)
  const manifestPath = resolve(directory, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`No manifest.json in ${directory}`)

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  console.warn(`Backup of "${manifest.database}" taken ${manifest.createdAt}`)

  const archive = resolve(directory, manifest.archive)
  await verifyArchive(archive, manifest)

  const runner = findRunner()
  console.warn(`Using ${describeRunner(runner)}`)

  // Scratch by default. Restoring over the live database is a deliberate act, not a default.
  const into = flag('to') ?? `${manifest.database}_restore`
  // The live database is MONGODB_DB, not the URI's path: the connection passes it separately.
  const live = process.env.MONGODB_DB
  if (into === live && !has('yes-overwrite-the-live-database')) {
    throw new Error(
      `Refusing to restore over the live database "${live}".\n` +
        'Pass --yes-overwrite-the-live-database if that is genuinely what you intend.',
    )
  }

  // Two genuinely different procedures, and conflating them is how a rehearsal gives false
  // confidence. `mongorestore` refuses `--oplogReplay` together with a namespace filter, which
  // forces the distinction into the open:
  //
  //  - **rehearsal** (the default): the one database, renamed into a scratch copy beside the live
  //    one. No oplog replay, so the result is the dump's own consistency rather than a true point
  //    in time — which is exactly the right trade for a drill that must not touch production. It
  //    still proves what a drill is for: the archive is readable, and the data comes back intact.
  //  - **recovery** (`--point-in-time`): the whole archive onto an empty cluster, with the oplog
  //    replayed. This is what an actual outage runs, and it cannot be narrowed to one database.
  //
  // docs/runbooks/backup-and-restore.md walks through both.
  const pointInTime = has('point-in-time')
  const renaming = into !== manifest.database

  if (pointInTime && renaming) {
    throw new Error(
      'A point-in-time restore replays the oplog, which mongorestore will not do alongside a ' +
        'namespace filter. Restore to the original database name (--to ' +
        `${manifest.database}) onto an empty cluster, or drop --point-in-time.`,
    )
  }

  console.warn(`Restoring into "${into}"${pointInTime ? ' with the oplog replayed' : ''}`)
  if (!pointInTime) {
    console.warn(
      '  (no oplog replay — this is a rehearsal, not a point-in-time recovery; see the runbook)',
    )
  }

  const handle = openSync(archive, 'r')
  try {
    runTool(
      runner,
      'mongorestore',
      [
        '--uri',
        uriFor(runner, uri),
        '--archive',
        '--gzip',
        ...(pointInTime
          ? ['--oplogReplay']
          : [
              // The archive holds the whole cluster (see backup.ts). Only this database comes
              // back, renamed, so a drill cannot overwrite anything that is in use.
              '--nsInclude',
              `${manifest.database}.*`,
              '--nsFrom',
              `${manifest.database}.*`,
              '--nsTo',
              `${into}.*`,
            ]),
        // Every collection replaced, so a restore into a scratch database that already holds an
        // older rehearsal cannot leave rows behind and quietly pass the count check.
        '--drop',
        '--quiet',
      ],
      { stdin: handle },
    )
  } finally {
    closeSync(handle)
  }
  console.warn(`${CHECK} mongorestore finished`)

  if (!has('verify')) {
    console.warn('Pass --verify to check the restored data. A restore nobody checked is a hope.')
    return
  }

  await verifyRestore(replace(uri, into), manifest)
}

/**
 * The part that makes this a rehearsal rather than a command that exited zero.
 *
 * Counts catch a collection that failed to come back. The chain catches everything else: it is a
 * hash over the content of every audit entry, so if the restore altered a single field anywhere
 * in the audit log, the walk fails. That is the strongest statement this script can make about
 * the data, and it is the one an auditor will ask for.
 */
async function verifyRestore(restoredUri: string, manifest: Manifest): Promise<void> {
  const client = new mongo.MongoClient(restoredUri)
  const problems: string[] = []

  try {
    await client.connect()
    const db = client.db()

    for (const [collection, expected] of Object.entries(manifest.counts)) {
      const actual = await db.collection(collection).countDocuments()
      if (actual !== expected) problems.push(`${collection}: ${actual} rows, expected ${expected}`)
    }
    console.warn(
      `${problems.length === 0 ? CHECK : CROSS} ${Object.keys(manifest.counts).length} collection count(s)`,
    )

    const applied = await db
      .collection('migrations')
      .find({}, { projection: { fileName: 1 } })
      .sort({ appliedAt: -1 })
      .limit(1)
      .toArray()
    const lastMigration = (applied[0] as { fileName?: string } | undefined)?.fileName ?? null
    if (lastMigration !== manifest.lastMigration) {
      problems.push(`migration state: ${lastMigration}, expected ${manifest.lastMigration}`)
    } else {
      console.warn(`${CHECK} schema is at ${lastMigration ?? '(no migrations)'}`)
    }

    await verifyChains(db, problems)
  } finally {
    await client.close()
  }

  if (problems.length > 0) {
    throw new Error(`The restore does not match the backup:\n  ${problems.join('\n  ')}`)
  }
  console.warn(`${CHECK} restore verified — the data came back intact`)
}

/**
 * Walks every clinic's audit chain over the restored documents.
 *
 * Recomputed here rather than through `@clinic/core`, deliberately: a restore rehearsal should
 * not depend on the application being importable, and an independent implementation of the same
 * rule is a stronger check than asking the code that wrote the hashes whether it likes them.
 */
async function verifyChains(db: mongo.Db, problems: string[]): Promise<void> {
  const genesis = '0'.repeat(64)
  const clinics = (await db.collection('auditLogs').distinct('clinicId')) as string[]
  let verifiedAnything = false

  for (const clinicId of clinics) {
    // Only the chain proper. Entries written before Phase 8 carry no position and no hash; they
    // are counted and reported rather than walked (see chain.repository.ts).
    const links = await db
      .collection('auditLogs')
      .find({ clinicId, chainSeq: { $exists: true } })
      .sort({ chainSeq: 1 })
      .toArray()
    const unchained = await db
      .collection('auditLogs')
      .countDocuments({ clinicId, chainSeq: { $exists: false } })

    let previous = genesis
    let checked = 0

    for (const link of links) {
      if (typeof link.hash !== 'string') {
        // A position but no hash: that is not legacy data, it is an entry somebody altered.
        problems.push(`audit chain for ${clinicId}: entry ${String(link._id)} has no hash`)
        break
      }
      if ((link.previousHash ?? genesis) !== previous) {
        problems.push(`audit chain for ${clinicId}: broken link at ${String(link._id)}`)
        break
      }
      if (canonicalHash(previous, link) !== link.hash) {
        problems.push(`audit chain for ${clinicId}: hash mismatch at ${String(link._id)}`)
        break
      }
      previous = link.hash
      checked += 1
    }

    if (checked > 0) verifiedAnything = true
    console.warn(
      `${CHECK} audit chain for ${clinicId}: ${checked} link(s) verified` +
        (unchained > 0
          ? `, ${unchained} older entr${unchained === 1 ? 'y' : 'ies'} not covered`
          : ''),
    )
  }

  // A chain check that walked nothing is not a passed chain check.
  //
  // Every entry written before the chain existed carries no hash and is skipped, so a database
  // full of them would print a row of ticks while proving nothing at all. Saying so is the
  // difference between a rehearsal and a ritual.
  if (!verifiedAnything) {
    console.warn(
      [
        `${CROSS} no audit entry in this backup carries a hash, so the chain proved nothing.`,
        '  Collection counts and the schema version were checked; the content was not.',
        '  Expected only for a database whose entries predate the chain (Phase 8).',
      ].join('\n'),
    )
  }
}

/** The canonical form from packages/core/src/modules/audit/domain/hash-chain.ts, independently. */
function canonicalHash(previousHash: string, link: Record<string, unknown>): string {
  const actor = (link.actor ?? {}) as {
    id?: string | null
    type?: string
    label?: string | null
    roles?: string[]
  }
  const entity = link.entity as
    { type?: string; id?: string | null; label?: string | null } | undefined

  const canonical = JSON.stringify([
    String(link.clinicId),
    (link.occurredAt as Date).toISOString(),
    [actor.id ?? '', actor.type ?? '', actor.label ?? '', [...(actor.roles ?? [])].sort()],
    String(link.action),
    String(link.category),
    entity && typeof entity.type === 'string' && entity.type !== ''
      ? [entity.type, entity.id ?? '', entity.label ?? '']
      : null,
    stable(link.before),
    stable(link.after),
    stable(link.metadata),
    String(link.severity),
    String(link.outcome),
  ])

  return createHash('sha256').update(previousHash).update(canonical).digest('hex')
}

function stable(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(stable)
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return Object.fromEntries(entries.map(([key, item]) => [key, stable(item)]))
}

main().catch((error: unknown) => {
  console.error(`${CROSS} ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
