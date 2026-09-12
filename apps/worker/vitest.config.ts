import { defineConfig } from 'vitest/config'

/**
 * Unit tests only. Everything the worker does worth testing needs a database and a clinic, so
 * the real coverage lives in `pnpm test:integration` — this config exists to keep the two runs
 * from colliding, not because there is much here.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/**'],
  },
})
