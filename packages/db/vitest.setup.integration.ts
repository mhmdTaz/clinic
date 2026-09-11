import { config } from 'dotenv'
import { resolve } from 'node:path'

// One .env, at the repository root — vitest runs with the package as cwd.
config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true })
