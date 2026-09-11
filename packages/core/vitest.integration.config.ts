import { defineConfig } from 'vitest/config'

/**
 * Live tests against MongoDB, Redis and Mailpit: `pnpm infra:up` first.
 * They run in their own database, dropped and re-migrated on every run, so they never
 * touch development data and never depend on what an earlier run left behind.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./test/integration.global-setup.ts'],
    setupFiles: ['./test/integration.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
