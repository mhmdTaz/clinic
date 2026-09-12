import { config } from 'dotenv'
import { resolve } from 'node:path'

/** A database and clinic of the worker's own, so it never races core's integration suite. */
export const INTEGRATION_DB = 'clinic_test_worker'
export const INTEGRATION_CLINIC_ID = 'clinic_wtest'

export function loadIntegrationEnv(): void {
  process.env.MONGODB_DB = INTEGRATION_DB
  process.env.CLINIC_ID = INTEGRATION_CLINIC_ID
  config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true })
}
