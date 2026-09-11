import { defineConfig, devices } from '@playwright/test'
import { E2E, E2E_ENV } from './e2e.env'

const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './specs',
  // One database and one seeded clinic: serial runs keep the journeys independent.
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: E2E.appUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: {
    // Requires `pnpm build` first. Never reuses a running server: a dev server on another
    // database would make the suite pass or fail for reasons unrelated to the code.
    command: `pnpm --filter @clinic/web exec next start --port ${E2E.port}`,
    url: `${E2E.appUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
    cwd: E2E.repoRoot,
  },
})
