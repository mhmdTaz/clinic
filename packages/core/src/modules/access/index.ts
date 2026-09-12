export {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_GROUPS,
  isPermissionKey,
  permissionLabelKey,
  subjectOf,
  type PermissionKey,
  type PermissionGroup,
  type PermissionDefinition,
} from './domain/permissions.catalog'
export {
  unionGrants,
  encodePermissions,
  decodePermissions,
  toGrantList,
  isScope,
  widerScope,
  scopeAtLeast,
  type Scope,
  type ScopeCode,
  type PermissionMap,
} from './domain/scopes'
export {
  decide,
  can,
  holds,
  registerScopeResolver,
  clearScopeResolvers,
  installDefaultScopeResolvers,
  type Actor,
  type ActorKind,
  type ScopedResource,
  type ScopeResolver,
  type Decision,
  type DenialReason,
} from './domain/policy'
export {
  PORTALS,
  NO_PORTAL_PATH,
  isPortalKey,
  orderPortals,
  landingPortal,
  landingPath,
  portalFromPath,
  type PortalDefinition,
} from './domain/portals'
export {
  provideCareRelationship,
  careRelationship,
  type CareRelationship,
} from './domain/care-relationship'
export {
  NAVIGATION,
  NAV_ICONS,
  visibleNavigation,
  type NavIcon,
  type NavItemDefinition,
  type NavSectionDefinition,
} from './domain/navigation'
export {
  validateGrants,
  grantsBeyondActor,
  diffGrants,
  widenedGrants,
  administratorRemains,
  grantsAdministration,
  roleKeyFrom,
  uniqueKey,
  ADMINISTRATION_KEYS,
  type Grant,
  type GrantInput,
  type GrantChanges,
} from './domain/grant-rules'
export { SYSTEM_ROLES, type SystemRoleDefinition, type SystemRoleKey } from './domain/system-roles'
export { systemActor, SYSTEM_ACTOR_ID } from './domain/system-actor'
export { resolveAccess, type ResolvedAccess } from './application/resolve-access'
export { assertCan } from './application/assert-can'
export { listRoleSummaries, type RoleSummary } from './application/list-role-summaries'
export {
  getPermissionCatalogue,
  getRole,
  createRole,
  updateRole,
  setRolePermissions,
  deleteRole,
} from './application/manage-roles'
export {
  authorizeRoleAssignment,
  assertAdministratorRemainsWithout,
  bumpPermissionVersion,
  findSystemRole,
  roleDirectory,
} from './application/role-assignment'
// NOT exported: the repositories.
