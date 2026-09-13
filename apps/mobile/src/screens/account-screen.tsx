import { ScrollView, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, Card, Heading, Muted, Screen, confirm, inform, palette } from '~/components/ui'
import { auth } from '~/lib/api'
import { homeOf, mobilePortalsOf, type MobilePortal } from '~/lib/routes'
import { useSession, useUser } from '~/lib/session'
import { reminderProblemText, useReminders } from '~/lib/use-reminders'

const PORTAL_NAMES: Record<MobilePortal, string> = { patient: 'Patient', doctor: 'Doctor' }

/**
 * Who you are, how the clinic reaches you, and the way out (P13, §9.4).
 *
 * The same screen in both portals. Push is asked for **here**, from a switch somebody
 * deliberately turned on, and never on launch: iOS gives an app exactly one chance to ask.
 */
export function AccountScreen({ portal }: { portal: MobilePortal }) {
  const user = useUser()
  const router = useRouter()
  const { signOut, state } = useSession()
  const reminders = useReminders()
  const offline = state.status === 'signedIn' && state.offline
  const others = mobilePortalsOf(user).filter((other) => other !== portal)

  return (
    <ScrollView>
      <Screen>
        <Card>
          <Text style={{ fontSize: 17, fontWeight: '600', color: palette.text }}>
            {user.displayName}
          </Text>
          <Muted>{user.email}</Muted>
          <Muted>{user.clinic.name}</Muted>
        </Card>

        <Card>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ fontWeight: '600', flex: 1, color: palette.text }}>
              {portal === 'doctor' ? 'Notifications on this phone' : 'Appointment reminders'}
            </Text>
            <Switch
              accessibilityLabel={
                portal === 'doctor'
                  ? 'Notifications on this phone'
                  : 'Appointment reminders on this phone'
              }
              value={reminders.on}
              disabled={!reminders.known || reminders.busy || offline}
              onValueChange={(next) =>
                void reminders.change(next).then((problem) => {
                  if (problem) {
                    const text = reminderProblemText(problem)
                    inform(text.title, text.message)
                  }
                })
              }
              trackColor={{ true: palette.primary }}
            />
          </View>
          <Muted>
            {portal === 'doctor'
              ? 'Replies to your questions and anything the clinic sends you, on this phone.'
              : 'A reminder on this phone before each appointment. You will still get them by email.'}
          </Muted>
        </Card>

        {others.length > 0 ? (
          <>
            <Heading>Switch portal</Heading>
            {others.map((other) => (
              <Button
                key={other}
                label={`Open the ${PORTAL_NAMES[other].toLowerCase()} portal`}
                tone="plain"
                onPress={() => {
                  // Remembered on the account, so the next launch opens here too (§10.1). Best-effort:
                  // switching must not wait on, or fail with, the network.
                  void auth.updateMe({ preferredPortal: other }).catch(() => undefined)
                  router.replace(homeOf(other) as '/patient' | '/doctor')
                }}
              />
            ))}
          </>
        ) : null}

        <Button
          label="Sign out"
          tone="danger"
          onPress={() =>
            confirm({
              title: 'Sign out?',
              message: offline
                ? 'You are offline. This phone will be signed out now, and anything kept on it removed.'
                : 'You will need your password to sign back in.',
              cancelLabel: 'Stay signed in',
              confirmLabel: 'Sign out',
              destructive: true,
              onConfirm: () => void signOut(),
            })
          }
        />
      </Screen>
    </ScrollView>
  )
}
