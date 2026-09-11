import { defineConfig } from 'vitest/config'

/** Unit tests only. Live tests need the Docker stack: `pnpm test:integration`. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
  },
})
