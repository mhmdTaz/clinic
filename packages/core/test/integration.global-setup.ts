import { resolve } from 'node:path'
import { loadIntegrationEnv } from './integration.env'

/** Runs once, before any worker starts: a clean database migrated from scratch. */
export default async function setup(): Promise<void> {
  loadIntegrationEnv()

  const migrateMongo = (await import('migrate-mongo')) as unknown as {
    default?: unknown
  } & MigrateMongo
  const { config, database, up } = (migrateMongo.default ?? migrateMongo) as MigrateMongo

  config.set({
    mongodb: {
      url: process.env.MONGODB_URI,
      databaseName: process.env.MONGODB_DB,
      options: { serverSelectionTimeoutMS: 10_000 },
    },
    migrationsDir: resolve(import.meta.dirname, '../../db/migrations'),
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

interface MigrateMongo {
  config: { set: (value: unknown) => void }
  database: {
    connect: () => Promise<{
      db: { dropDatabase: () => Promise<unknown> }
      client: { close: () => Promise<void> }
    }>
  }
  up: (db: unknown, client: unknown) => Promise<string[]>
}
