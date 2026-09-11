import { config } from 'dotenv'
import { resolve } from 'node:path'

// The shared services (MongoDB, Redis, Mailpit) come from the root .env.
config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true })

const PORT = 3100

/**
 * End-to-end runs get their own port, database and clinic. A developer's `pnpm dev` on
 * port 3000 against the `clinic` database is never touched, and the suite never picks up
 * whatever state that database happens to be in.
 */
export const E2E = {
  port: PORT,
  appUrl: `http://localhost:${PORT}`,
  database: 'clinic_e2e',
  clinicId: 'e2e_clinic',
  password: 'E2E-Demo-Password-2026!',
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27018/?replicaSet=rs0',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  mailpitApi: process.env.MAILPIT_API ?? 'http://localhost:8025/api/v1',
  repoRoot: resolve(import.meta.dirname, '../..'),
}

/** The environment both the web server and the seed run with. */
export const E2E_ENV: Record<string, string> = {
  APP_URL: E2E.appUrl,
  MONGODB_DB: E2E.database,
  CLINIC_ID: E2E.clinicId,
  // The suite sends X-Real-IP so each test signs in from its own address and per-IP
  // limits never couple unrelated tests. Nothing else should run with this on locally.
  TRUST_PROXY: 'true',
  SEED_PASSWORD: E2E.password,
}
