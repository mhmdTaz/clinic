import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Next.js resolves "@/" from tsconfig; tests need to be told, so they import the way the app does. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
})
