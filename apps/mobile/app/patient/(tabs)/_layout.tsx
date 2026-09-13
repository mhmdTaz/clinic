import { Tabs } from 'expo-router'
import { tabIcon } from '~/components/tab-icon'
import { palette } from '~/components/ui'

/**
 * The patient's five destinations (P1–P12).
 *
 * Four became five when documents and support arrived, and the updates feed moved off the tab bar
 * to make room: it is reached from home, which already leads with the unread count. Five is the
 * most a tab bar holds legibly on a small phone, and a destination behind a "More" sheet is a
 * destination people do not find — so if a sixth is ever needed, the right question is which of
 * these five is not earning its place.
 */
export default function PatientTabs() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        headerStyle: { backgroundColor: palette.card },
        headerTitleStyle: { color: palette.text },
        tabBarStyle: { backgroundColor: palette.card, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="appointments"
        options={{ title: 'Appointments', tabBarIcon: tabIcon('calendar', 'calendar-outline') }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: 'Documents',
          tabBarIcon: tabIcon('document-text', 'document-text-outline'),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{ title: 'Get help', tabBarIcon: tabIcon('chatbubbles', 'chatbubbles-outline') }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: tabIcon('person-circle', 'person-circle-outline'),
        }}
      />
    </Tabs>
  )
}
