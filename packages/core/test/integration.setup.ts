import { afterAll, beforeAll } from 'vitest'
import { loadIntegrationEnv } from './integration.env'

loadIntegrationEnv()

const { connect, disconnect } = await import('@clinic/db')
const { flushAudit, installAuditCapture } = await import('../src/modules/audit')
const { installDefaultScopeResolvers } = await import('../src/modules/access')
const { rateLimiter } = await import('../src/modules/identity/infrastructure/rate-limiter')

beforeAll(async () => {
  await connect()
  installAuditCapture()
  installDefaultScopeResolvers()
})

afterAll(async () => {
  await flushAudit()
  await rateLimiter.close()
  await disconnect()
})
