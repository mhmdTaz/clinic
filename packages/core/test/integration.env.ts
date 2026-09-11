import { config } from 'dotenv'
import { resolve } from 'node:path'

/** A database and clinic of their own, set before the root .env so .env cannot override them. */
export const INTEGRATION_DB = 'clinic_test_core'
export const INTEGRATION_CLINIC_ID = 'clinic_itest'

export function loadIntegrationEnv(): void {
  process.env.MONGODB_DB = INTEGRATION_DB
  process.env.CLINIC_ID = INTEGRATION_CLINIC_ID
  config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true })
}
