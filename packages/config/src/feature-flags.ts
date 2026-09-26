/**
 * Module-level feature flags (principle 2.3). Defaults live here; a clinic document
 * may override any of them, which is how one codebase serves a solo dentist and a
 * forty-doctor polyclinic.
 */
export const FEATURE_FLAGS = {
  billing: true,
  inventory: true,
  support: true,
  labOrders: false,
  // The tooth chart. Off by default: a general practice has no use for a jaw on every patient.
  dental: false,
  onlinePayments: false,
  patientSelfRegistration: false, // ADR-0006 is still open
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS
export type FeatureFlags = Record<FeatureFlagKey, boolean>

export function resolveFeatureFlags(overrides?: Partial<FeatureFlags> | null): FeatureFlags {
  return { ...FEATURE_FLAGS, ...(overrides ?? {}) }
}
