import { Stack } from 'expo-router'
import { palette } from '~/components/ui'

/**
 * The doctor portal: the tabs, and the chart and the note that open over them.
 *
 * `initialRouteName` so a notification that opens a note from cold still has the day beneath it
 * to go back to.
 */
export const unstable_settings = { initialRouteName: '(tabs)' }

export default function DoctorLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.card },
        headerTitleStyle: { color: palette.text },
        headerTintColor: palette.primary,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="patients/[patientId]" options={{ title: 'Patient chart' }} />
      <Stack.Screen name="encounters/[encounterId]" options={{ title: 'Visit' }} />
    </Stack>
  )
}
