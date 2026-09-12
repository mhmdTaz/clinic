import { defineConfig } from 'vitest/config'

/**
 * Live tests for the relay and the reminder sweep: `pnpm infra:up` first.
 *
 * Its own database, dropped and re-migrated per run, so it never touches development data and
 * never depends on what a previous run left behind — the same shape as core's.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    globalSetup: ['./test/integration.global-setup.ts'],
    setupFiles: ['./test/integration.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
