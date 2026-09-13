/**
 * The typed API client for every delivery mechanism (section 9.1).
 *
 * Depends on `@clinic/contracts` and nothing else — no framework, no platform module, no driver.
 * That is what lets a Next.js server component, a browser bundle and a React Native app all
 * import it, and it is the property to protect when adding anything here.
 */
export { createClient, type ApiClient, type ClientOptions, type Paged } from './client'
export { ApiError, ContractMismatchError } from './errors'
export {
  cookieTokenStore,
  memoryTokenStore,
  secureTokenStore,
  tokensFromSession,
  isNearlyExpired,
  type SecureStorage,
  type StoredTokens,
  type TokenStore,
} from './tokens'
export { authResource } from './resources/auth'
export { collectByIds, collectPages, PAGE_LIMIT_MAX, type Listed, type PageRequest } from './pages'
export { patientPortal, type AppointmentsRequest } from './resources/patient-portal'
export { doctorPortal } from './resources/doctor-portal'
export { queryKeys, invalidatedBy } from './query-keys'
