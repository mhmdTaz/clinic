import type { ExpoConfig } from 'expo/config'

/**
 * The app's build-time configuration.
 *
 * `apiUrl` comes from the environment rather than being hard-coded, because a build for a
 * different clinic is a different value and not a different source tree (ADR-0005: one clinic per
 * installation). There is no default: a build with no clinic behind it should fail at the door,
 * not at the first request a patient makes.
 */
const config: ExpoConfig = {
  name: 'Clinic',
  slug: 'clinic',
  scheme: 'clinic',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { supportsTablet: true, bundleIdentifier: 'com.clinic.patient' },
  android: {
    package: 'com.clinic.patient',
    // Reminders arrive while the phone is locked, which is the point of them.
    permissions: ['NOTIFICATIONS'],
  },
  plugins: ['expo-router', 'expo-secure-store', 'expo-notifications'],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.CLINIC_API_URL,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
}

export default config
