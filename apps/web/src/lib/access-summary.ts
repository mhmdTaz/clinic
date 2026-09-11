import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  type PermissionGroup,
  type PermissionMap,
} from '@clinic/core/access'

/** How many permissions an actor holds in each area, in catalogue order. */
export function summariseAccess(
  permissions: PermissionMap,
): Array<{ group: PermissionGroup; count: number }> {
  const counts = new Map<PermissionGroup, number>()
  for (const key of permissions.keys()) {
    const group = PERMISSIONS[key].group
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return PERMISSION_GROUPS.filter((group) => counts.has(group)).map((group) => ({
    group,
    count: counts.get(group) ?? 0,
  }))
}
