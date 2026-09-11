import mongoose, { type Connection } from 'mongoose'
import { env, processSingleton } from '@clinic/config'

/**
 * Two connections, deliberately (section 11.5):
 *
 *  - `main`  — everything the application does.
 *  - `audit` — audit writes only. In production its user holds insert+find on
 *              auditLogs and nothing else, so a compromised request handler cannot
 *              rewrite history even with arbitrary code execution.
 *
 * Locally both point at the same URI because dev runs without auth. The separation
 * is structural from day one so the production credential is a config change, not a
 * refactor. See docs/adr/0016.
 */
type ConnectionCache = { main?: Connection; audit?: Connection }

// One pool per process, not one per bundle copy.
const cache = processSingleton<ConnectionCache>('db:connections', () => ({}))

const CONNECT_OPTIONS = {
  serverSelectionTimeoutMS: 8_000,
  maxPoolSize: 20,
  minPoolSize: 2,
  retryWrites: true,
  /**
   * Migrations own collections and indexes. Left on, Mongoose builds indexes in the
   * background when a model compiles and reports conflicts as events nobody listens
   * to — so an index could silently differ from what the migration declared. A test
   * asserts the schema declarations and the migrated database agree instead.
   */
  autoIndex: false,
  autoCreate: false,
} as const

export function getConnection(): Connection {
  cache.main ??= mongoose.createConnection(env().MONGODB_URI, {
    ...CONNECT_OPTIONS,
    dbName: env().MONGODB_DB,
  })
  return cache.main
}

export function getAuditConnection(): Connection {
  cache.audit ??= mongoose.createConnection(env().MONGODB_AUDIT_URI, {
    ...CONNECT_OPTIONS,
    maxPoolSize: 5,
    dbName: env().MONGODB_DB,
  })
  return cache.audit
}

/** Resolves once the connection is usable. Safe to call repeatedly. */
export async function connect(): Promise<Connection> {
  const conn = getConnection()
  if (conn.readyState !== 1) await conn.asPromise()
  return conn
}

export async function disconnect(): Promise<void> {
  await Promise.all([cache.main?.close(), cache.audit?.close()])
  cache.main = undefined
  cache.audit = undefined
}

export async function ping(): Promise<number> {
  const started = performance.now()
  const conn = await connect()
  await conn.db?.admin().command({ ping: 1 })
  return Math.round(performance.now() - started)
}

export type TopologyInfo = { isReplicaSet: boolean; setName: string | null; topology: string }

/**
 * Transactions and change streams both require a replica set. A standalone fails
 * those paths late and confusingly, so we assert the topology explicitly.
 */
export async function inspectTopology(): Promise<TopologyInfo> {
  const conn = await connect()
  const hello = (await conn.db?.admin().command({ hello: 1 })) as
    { setName?: string; msg?: string; isWritablePrimary?: boolean } | undefined

  const setName = hello?.setName ?? null
  return {
    isReplicaSet: Boolean(setName),
    setName,
    topology: setName ? 'replicaSet' : hello?.msg === 'isdbgrid' ? 'sharded' : 'standalone',
  }
}

/** Runs `fn` inside a transaction. Throws a clear error if the topology cannot support one. */
export async function withTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const conn = await connect()
  const session = await conn.startSession()
  try {
    let result!: T
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result
  } finally {
    await session.endSession()
  }
}
