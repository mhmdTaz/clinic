import { afterAll, beforeAll } from 'vitest'
import { loadIntegrationEnv } from './integration.env'

loadIntegrationEnv()

const { connect, disconnect } = await import('@clinic/db')
const { flushAudit, installAuditCapture } = await import('../src/modules/audit')
const { installDefaultScopeResolvers } = await import('../src/modules/access')
const { installPatientScopeResolvers } = await import('../src/modules/patients')
const { installDoctorScopeResolvers } = await import('../src/modules/doctors')
const { installAppointmentScopeResolvers } = await import('../src/modules/appointments')
const { installEncounterScopeResolvers, careRelationshipFromEncounters } =
  await import('../src/modules/clinical')
const { installPrescriptionScopeResolvers } = await import('../src/modules/prescriptions')
const { installFileScopeResolvers } = await import('../src/modules/files')
const { installBillingScopeResolvers } = await import('../src/modules/billing')
const { installTicketScopeResolvers } = await import('../src/modules/support')
const { provideCareRelationship } = await import('../src/modules/access')
const { rateLimiter } = await import('../src/modules/identity/infrastructure/rate-limiter')

beforeAll(async () => {
  await connect()
  installAuditCapture()
  installDefaultScopeResolvers()
  installPatientScopeResolvers()
  installDoctorScopeResolvers()
  // Every resolver the server installs (src/server.ts). A missing one denies rather than
  // throws, so leaving one out here would fail a test for a reason the code does not have.
  installAppointmentScopeResolvers()
  installEncounterScopeResolvers()
  installPrescriptionScopeResolvers()
  installFileScopeResolvers()
  installBillingScopeResolvers()
  installTicketScopeResolvers()
  provideCareRelationship(careRelationshipFromEncounters)
})

afterAll(async () => {
  await flushAudit()
  await rateLimiter.close()
  await disconnect()
})
