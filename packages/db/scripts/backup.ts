import './bootstrap-env'
import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { describeRunner, findRunner, runTool, toolVersion, uriFor } from './mongo-tools'

/**
 * A backup (section 16.1).
 *
 *   pnpm db:backup [--out <directory>] [--keep <n>]
 *
 * `mongodump --oplog` is the flag that matters. Without it the dump is a set of collections read
 * at slightly different instants, and restoring it gives a database that never existed — an
 * invoice carrying a payment allocated against a version of itself that was not captured. With
 * it, the dump records the oplog span it covers and `--oplogReplay` collapses that span on
 * restore, producing a single consistent point in time.
 *
 * One gzipped archive rather than a directory tree: a single file is one thing to checksum, one
 * thing to copy off the machine, and one thing that is either there or is not.
 *
 * Two files are written beside it, and both exist because of what goes wrong at 3am:
 *
 *  - a **manifest** recording the database, the migration the schema is at, the collection counts
 *    and the archive's checksum. A restore is only correct if what comes back matches what went
 *    in, and the only way to check that is to have written down what went in.
 *  - a **checksum** of the archive. A backup that silently truncated is worse than no backup,
 *    because it is trusted.
 */

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const CHECK = '✓'
const CROSS = '✗'

/**
 * The database being backed up.
 *
 * `MONGODB_DB` is the source of truth, not the URI's path: the connection passes `dbName`
 * separately (see src/connection.ts) so one URI can serve the main and audit databases, and a
 * backup that took the name from the path would dump whatever `admin` the driver defaulted to.
 */
function databaseOf(): string {
  const name = process.env.MONGODB_DB
  if (!name) throw new Error('MONGODB_DB is not set.')
  return name
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

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set.')
  const database = databaseOf()

  const runner = findRunner()
  console.warn(`Using ${describeRunner(runner)}`)

  const root = resolve(flag('out') ?? resolve(process.cwd(), '../../backups'))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = resolve(root, `${database}-${stamp}`)
  mkdirSync(target, { recursive: true })

  const archive = resolve(target, 'dump.archive.gz')
  console.warn(`Backing up "${database}" to ${archive}`)

  const handle = openSync(archive, 'w')
  try {
    runTool(
      runner,
      'mongodump',
      // No --db: `--oplog` is only supported on a full dump, and a full dump is what you
      // actually want anyway. The application database and the audit database are separate
      // connections, and a backup that captured one without the other would restore an invoice
      // whose audit trail stops mid-sentence. The restore narrows with --nsInclude.
      ['--uri', uriFor(runner, uri), '--archive', '--gzip', '--oplog', '--quiet'],
      { stdout: handle },
    )
  } finally {
    closeSync(handle)
  }

  const bytes = statSync(archive).size
  if (bytes === 0) throw new Error('mongodump produced an empty archive.')

  // The counts and the migration state, read from the live database. They are what the restore
  // rehearsal checks against, so an empty answer here is a broken backup, not a quiet one.
  const { connect, disconnect, getConnection } = await import('../src/index')
  await connect()
  const db = getConnection().db
  if (!db) throw new Error('No database handle after connecting.')

  const counts: Record<string, number> = {}
  for (const collection of (await db.listCollections().toArray()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    counts[collection.name] = await db.collection(collection.name).countDocuments()
  }

  const applied = await db
    .collection('migrations')
    .find({}, { projection: { fileName: 1 } })
    .sort({ appliedAt: -1 })
    .limit(1)
    .toArray()

  await disconnect()

  const manifest = {
    database,
    createdAt: new Date().toISOString(),
    tool: toolVersion(runner, 'mongodump'),
    archive: 'dump.archive.gz',
    bytes,
    sha256: await sha256Of(archive),
    // Restoring a dump into a differently migrated database is a silent corruption, so the
    // number that says which travels with the data.
    lastMigration: (applied[0] as { fileName?: string } | undefined)?.fileName ?? null,
    counts,
  }

  writeFileSync(resolve(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.warn(`${CHECK} archive: ${(bytes / 1024).toFixed(1)} KiB`)
  console.warn(`${CHECK} ${Object.keys(counts).length} collection(s) recorded`)
  console.warn(`${CHECK} schema at ${manifest.lastMigration ?? '(no migrations)'}`)

  const keep = Number(flag('keep') ?? '7')
  if (Number.isFinite(keep) && keep > 0) prune(root, database, keep)

  console.warn(`${CHECK} backup complete: ${target}`)
}

/**
 * Keeps the newest `keep` backups of this database.
 *
 * Retention lives in the same script as the backup, because a disk that fills up stops the
 * backups — and backups that stopped weeks ago are discovered on the day they are needed.
 */
function prune(root: string, database: string, keep: number): void {
  const mine = readdirSync(root)
    .filter((name) => name.startsWith(`${database}-`))
    .sort()
    .reverse()

  for (const stale of mine.slice(keep)) {
    rmSync(resolve(root, stale), { recursive: true, force: true })
    console.warn(`  pruned ${stale}`)
  }
}

main().catch((error: unknown) => {
  console.error(`${CROSS} ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
