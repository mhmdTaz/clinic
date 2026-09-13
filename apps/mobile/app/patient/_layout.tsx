import { Stack } from 'expo-router'
import { palette } from '~/components/ui'

/**
 * The patient portal: the tabs, and the screens that open over them.
 *
 * `initialRouteName` matters for a notification that opens the app from cold straight into a
 * screen above the tabs — booking, say. Without it the stack would hold that one screen and no way
 * back to anything.
 */
export const unstable_settings = { initialRouteName: '(tabs)' }

export default function PatientLayout() {
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
      <Stack.Screen name="book" options={{ title: 'Book an appointment' }} />
      <Stack.Screen name="updates" options={{ title: 'Updates' }} />
    </Stack>
  )
}
