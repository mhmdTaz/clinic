import { useEffect, useState } from 'react'
import { Alert, ScrollView, Switch, Text, View } from 'react-native'
import { Button, Card, Muted, Screen, Title, palette } from '~/components/ui'
import { portal } from '~/lib/api'
import { enrolForPush } from '~/lib/push'
import { useSession, useUser } from '~/lib/session'

/**
 * Who you are, and how the clinic reaches you (P13, §9.4).
 *
 * Push is asked for **here**, from a switch somebody deliberately turned on, and never on launch.
 * iOS gives an app exactly one chance to ask; spending it on a prompt that appears before the app
 * has shown anything is how an app ends up permanently unable to send a reminder.
 */
export default function AccountScreen() {
  const user = useUser()
  const { signOut } = useSession()
  const [pushOn, setPushOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)

  // Whether this installation is already registered. Asked once, on mount.
  useEffect(() => {
    let cancelled = false
    void portal
      .myDevices()
      .then((devices) => {
        if (cancelled) return
        const mine = devices.find((device) => device.isThisDevice) ?? null
        setDeviceId(mine?.id ?? null)
        setPushOn(mine !== null)
      })
      // A device list that will not load is not worth an error on this screen: the switch simply
      // shows off, and turning it on re-registers.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      if (!next) {
        if (deviceId) await portal.removeDevice(deviceId)
        setDeviceId(null)
        setPushOn(false)
        return
      }

      const enrolment = await enrolForPush()
      if (enrolment.status === 'denied') {
        // Being specific matters: the app cannot ask again, and the only way back is Settings.
        Alert.alert(
          'Notifications are switched off',
          'Turn them on for this app in your phone’s Settings to get appointment reminders.',
        )
        setPushOn(false)
        return
      }
      if (enrolment.status === 'unsupported') {
        Alert.alert('Not available on this device', enrolment.reason)
        setPushOn(false)
        return
      }

      const device = await portal.registerDevice(enrolment.registration)
      setDeviceId(device.id)
      setPushOn(true)
    } catch {
      Alert.alert('That did not work', 'Reminders could not be switched on. Try again shortly.')
      setPushOn(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView>
      <Screen>
        <Title>Account</Title>

        <Card>
          <Text style={{ fontSize: 17, fontWeight: '600' }}>{user.displayName}</Text>
          <Muted>{user.email}</Muted>
          <Muted>{user.clinic.name}</Muted>
        </Card>

        <Card>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ fontWeight: '600', flex: 1 }}>Appointment reminders</Text>
            <Switch
              accessibilityLabel="Appointment reminders on this device"
              value={pushOn}
              disabled={busy}
              onValueChange={(next) => void toggle(next)}
              trackColor={{ true: palette.primary }}
            />
          </View>
          <Muted>
            A reminder on this phone before each appointment. You will still get them by email.
          </Muted>
        </Card>

        <Button
          label="Sign out"
          tone="danger"
          onPress={() => {
            Alert.alert('Sign out?', 'You will need your password to sign back in.', [
              { text: 'Stay signed in', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }}
        />
      </Screen>
    </ScrollView>
  )
}
