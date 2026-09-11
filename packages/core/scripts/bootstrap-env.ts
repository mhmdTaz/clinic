/**
 * Scripts run with their own package as cwd, so `dotenv/config` would look for
 * packages/core/.env and find nothing. There is one .env, at the repository root.
 *
 * Import this FIRST in any script, before anything that reads configuration.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rootEnv = resolve(here, '../../../.env')

if (!existsSync(rootEnv)) {
  console.error(
    `No .env found at ${rootEnv}.\nCopy .env.example to .env at the repository root first.`,
  )
  process.exit(1)
}

// Values already in the environment win, so CI and tests can point at another database.
config({ path: rootEnv, quiet: true })
