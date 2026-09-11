import { defineConfig } from 'vitest/config'

/**
 * Live tests need the Docker stack: `pnpm infra:up`. They run in their own database,
 * dropped and migrated from scratch on every run, so they never touch development data
 * and the index-drift test always compares against a freshly migrated schema.
 */
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.integration.test.ts'],
    globalSetup: ['./vitest.global-setup.integration.ts'],
    setupFiles: ['./vitest.setup.integration.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
