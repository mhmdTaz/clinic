import { config } from 'dotenv'
import { resolve } from 'node:path'

/**
 * Live tests use a database of their own — set BEFORE the root .env is read, so .env
 * cannot point them at development data. The global setup drops and migrates it.
 */
export const DB_INTEGRATION_DATABASE = 'clinic_test_db'

process.env.MONGODB_DB = DB_INTEGRATION_DATABASE
process.env.CLINIC_ID ??= 'clinic_itest_db'
config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true })
