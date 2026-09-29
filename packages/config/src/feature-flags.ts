/**
 * Module-level feature flags (principle 2.3). Defaults live here; a clinic document
 * may override any of them, which is how one codebase serves a solo dentist and a
 * forty-doctor polyclinic.
 */
export const FEATURE_FLAGS = {
  billing: true,
  inventory: true,
  support: true,
  // Lab work sent out for a tooth — a crown, a bridge, a denture (Phase 13). Needs `dental`.
  labOrders: false,
  // The tooth chart. Off by default: a general practice has no use for a jaw on every patient.
  dental: false,
  // Charting by voice (Phase 13, ADR-0037). Off unless the clinic turns it on and accepts that the
  // browser's speech service may send the audio away to be transcribed.
  dentalVoice: false,
  onlinePayments: false,
  patientSelfRegistration: false, // ADR-0006 is still open
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS
export type FeatureFlags = Record<FeatureFlagKey, boolean>

export function resolveFeatureFlags(overrides?: Partial<FeatureFlags> | null): FeatureFlags {
  return { ...FEATURE_FLAGS, ...(overrides ?? {}) }
}
