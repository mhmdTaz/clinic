import { config } from 'dotenv'
import createNextIntlPlugin from 'next-intl/plugin'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// One .env, at the repository root. Next would otherwise look only in apps/web.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true })

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source, so there is no build step between an
  // edit in packages/* and seeing it here.
  transpilePackages: [
    '@clinic/ui',
    '@clinic/core',
    '@clinic/contracts',
    '@clinic/config',
    '@clinic/events',
  ],
  // Native bindings and Node-only drivers are loaded at runtime, never bundled.
  //
  // Each one must ALSO be listed in this app's package.json dependencies. pnpm installs
  // strictly, so a package that only @clinic/core depends on cannot be resolved from
  // apps/web — and when Next cannot resolve an external package it silently bundles it
  // instead, which fails outright on argon2's native .node binary. Lint still forbids
  // importing any of them from this app.
  serverExternalPackages: ['mongoose', '@node-rs/argon2', 'ioredis', 'nodemailer'],

  // Security headers are NOT here. They live in src/middleware.ts, because the CSP carries a
  // per-request nonce and a static config cannot generate one — and two places setting security
  // headers is one place too many to keep in agreement. See src/lib/security/csp.ts.
}

export default withNextIntl(nextConfig)
