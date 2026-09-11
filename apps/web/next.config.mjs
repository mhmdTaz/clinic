import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// One .env, at the repository root. Next would otherwise look only in apps/web.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true })

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, so there is no build step between an
  // edit in packages/* and seeing it here.
  transpilePackages: [
    '@clinic/ui',
    '@clinic/core',
    '@clinic/contracts',
    '@clinic/config',
    '@clinic/events',
  ],
  serverExternalPackages: ['mongoose'],
  experimental: { typedRoutes: true },
  poweredByHeader: false,
}

export default nextConfig
