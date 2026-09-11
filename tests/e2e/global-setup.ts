import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Redis } from 'ioredis'
import { E2E, E2E_ENV } from './e2e.env'

/**
 * A known starting point for every run: a dropped and freshly migrated database, no rate
 * limit counters left by a previous run, an empty mailbox, then the seed — which also
 * emails the invitation the activation journey follows.
 */
export default async function globalSetup(): Promise<void> {
  await resetDatabase()
  await clearRateLimits()
  await clearMailbox()

  execSync('pnpm --filter @clinic/core seed', {
    cwd: E2E.repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...E2E_ENV },
  })
}

async function resetDatabase(): Promise<void> {
  const migrateMongo = (await import('migrate-mongo')) as unknown as { default?: unknown }
  const { config, database, up } = (migrateMongo.default ?? migrateMongo) as {
    config: { set: (value: unknown) => void }
    database: {
      connect: () => Promise<{
        db: { dropDatabase: () => Promise<unknown> }
        client: { close: () => Promise<void> }
      }>
    }
    up: (db: unknown, client: unknown) => Promise<string[]>
  }

  config.set({
    mongodb: { url: E2E.mongoUri, databaseName: E2E.database, options: {} },
    migrationsDir: resolve(E2E.repoRoot, 'packages/db/migrations'),
    changelogCollectionName: 'migrations',
    migrationFileExtension: '.js',
    useFileHash: false,
    moduleSystem: 'esm',
  })

  const { db, client } = await database.connect()
  try {
    await db.dropDatabase()
    await up(db, client)
  } finally {
    await client.close()
  }
}

async function clearRateLimits(): Promise<void> {
  const redis = new Redis(E2E.redisUrl, { maxRetriesPerRequest: 2 })
  try {
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `rl:${E2E.clinicId}:*`, 'COUNT', 500)
      cursor = next
      if (keys.length > 0) await redis.del(...keys)
    } while (cursor !== '0')
  } finally {
    await redis.quit()
  }
}

async function clearMailbox(): Promise<void> {
  const response = await fetch(`${E2E.mailpitApi}/messages`, { method: 'DELETE' })
  if (!response.ok)
    throw new Error(`Mailpit is not reachable at ${E2E.mailpitApi} (${response.status})`)
}
