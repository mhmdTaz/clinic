export { getClinicOverview } from './application/get-clinic-overview'
export { getClinicProfile } from './application/get-clinic-profile'
export { getClinicSessionInfo } from './application/get-clinic-session-info'
export {
  hasBookableBranch,
  activeBranches,
  type Clinic,
  type Branch,
  type ClinicSessionInfo,
} from './domain/clinic'
// NOT exported: clinicRepository, or anything else under infrastructure/.
