import { afterAll, beforeAll } from 'vitest'
import { loadIntegrationEnv } from './integration.env'

loadIntegrationEnv()

const { connect, disconnect } = await import('@clinic/db')
const { flushAudit, installAuditCapture } = await import('../src/modules/audit')
const { installDefaultScopeResolvers } = await import('../src/modules/access')
const { installPatientScopeResolvers } = await import('../src/modules/patients')
const { installDoctorScopeResolvers } = await import('../src/modules/doctors')
const { rateLimiter } = await import('../src/modules/identity/infrastructure/rate-limiter')

beforeAll(async () => {
  await connect()
  installAuditCapture()
  installDefaultScopeResolvers()
  installPatientScopeResolvers()
  installDoctorScopeResolvers()
})

afterAll(async () => {
  await flushAudit()
  await rateLimiter.close()
  await disconnect()
})
