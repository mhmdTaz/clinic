/**
 * The worker runs with its own package as cwd, so `dotenv/config` would look for
 * apps/worker/.env and find nothing. There is one .env, at the repository root.
 *
 * Imported FIRST in index.ts, before anything that reads configuration — the same shape the
 * seed script uses, and for the same reason.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rootEnv = resolve(here, '../../../.env')

if (existsSync(rootEnv)) {
  // Values already in the environment win, so a container's own configuration is not
  // overwritten by a file that happens to be mounted beside it.
  config({ path: rootEnv, quiet: true })
}
