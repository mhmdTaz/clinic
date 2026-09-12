import { Tabs } from 'expo-router'
import { palette } from '~/components/ui'

/**
 * The patient's four destinations (P1–P12).
 *
 * Four, not five, and not a "More" sheet: a tab bar is the only navigation on a phone, and a
 * destination behind a menu is a destination people do not find. If a fifth is ever needed, the
 * right answer is to ask which of these four is not earning its place.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        headerStyle: { backgroundColor: palette.card },
        headerTitleStyle: { color: palette.text },
        tabBarStyle: { backgroundColor: palette.card, borderTopColor: palette.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="appointments" options={{ title: 'Appointments' }} />
      <Tabs.Screen name="notifications" options={{ title: 'Updates' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  )
}
