import { Tabs } from 'expo-router'
import { tabIcon } from '~/components/tab-icon'
import { palette } from '~/components/ui'

/**
 * A doctor's three destinations on a phone: the day, the people, and the account.
 *
 * Deliberately not the web's doctor portal in miniature. The schedule editor, prescribing and
 * stock are desk work; between two patients a doctor wants to know who is next, read a chart, and
 * get a note down (D3, D4, D6–D9).
 */
export default function DoctorTabs() {
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
        options={{ title: 'My day', tabBarIcon: tabIcon('today', 'today-outline') }}
      />
      <Tabs.Screen
        name="patients"
        options={{ title: 'My patients', tabBarIcon: tabIcon('people', 'people-outline') }}
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
