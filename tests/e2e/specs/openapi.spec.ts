import { E2E } from '../e2e.env'
import { expect, test } from './fixtures'

/**
 * Phase 10: the OpenAPI document is served, to anybody, from the running app — not merely built in
 * a unit test. The catalogue test proves it is complete; this proves an integrator can fetch it.
 */
test('serves the OpenAPI document without credentials', async () => {
  const response = await fetch(`${E2E.appUrl}/api/v1/openapi.json`, { credentials: 'omit' })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')

  const document = (await response.json()) as {
    openapi: string
    paths: Record<string, Record<string, { operationId?: string; parameters?: unknown[] }>>
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> }
  }
  expect(document.openapi).toBe('3.1.0')
  expect(document.paths['/api/v1/me/appointments']?.post?.operationId).toBe('postMeAppointments')
  expect(document.paths['/api/v1/encounters']?.get).toBeTruthy()
  expect(document.components.schemas.AppointmentDetail).toBeTruthy()
  expect(Object.keys(document.components.securitySchemes).sort()).toEqual(['bearer', 'cookie'])
})
