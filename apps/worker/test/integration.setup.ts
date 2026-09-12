import { afterAll, beforeAll } from 'vitest'
import { loadIntegrationEnv } from './integration.env'

loadIntegrationEnv()

const { bootstrapServer, connect, disconnect, flushAudit } = await import('@clinic/core/server')

beforeAll(async () => {
  await connect()
  // The same composition root the worker runs: scope resolvers, the care-relationship port and
  // audit capture. Anything the process does at boot, the tests do too.
  bootstrapServer()
})

afterAll(async () => {
  await flushAudit()
  await disconnect()
})
