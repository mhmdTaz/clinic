import { defineConfig } from 'vitest/config'

/** Integration tests need the Docker stack up: `pnpm infra:up && pnpm db:migrate`. */
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.integration.test.ts'],
    setupFiles: ['./vitest.setup.integration.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
