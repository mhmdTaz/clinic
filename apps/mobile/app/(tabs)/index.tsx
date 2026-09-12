import { ScrollView, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, Card, ListState, Muted, Screen, Title } from '~/components/ui'
import { useMyAppointments, useNotifications } from '~/lib/queries'
import { useUser } from '~/lib/session'
import { formatWhen, nextUpcoming } from '~/lib/format'

/**
 * What a patient opens the app to find out (P1).
 *
 * One question, answered above the fold: **when am I next seen?** Everything else on this screen
 * is secondary to that, and a home screen that made somebody scroll or tap to find it would have
 * failed at the only job it reliably has.
 */
export default function HomeScreen() {
  const user = useUser()
  const router = useRouter()
  const appointments = useMyAppointments(user.patientId ?? '')
  const notifications = useNotifications()

  const next = nextUpcoming(appointments.data ?? [])
  const unread = notifications.data?.unreadCount ?? 0

  return (
    <ScrollView>
      <Screen>
        <Title>{`Hello, ${user.firstName}`}</Title>

        <ListState
          loading={appointments.isLoading}
          error={appointments.error}
          empty={next === null}
          emptyText="You have no upcoming appointments."
          onRetry={() => void appointments.refetch()}
        >
          {next ? (
            <Card>
              <Muted>Your next appointment</Muted>
              <Text style={{ fontSize: 20, fontWeight: '600' }}>
                {formatWhen(next.startsAt, user.clinic.timezone)}
              </Text>
              <Muted>{`${next.doctor.name}${next.reason ? ` · ${next.reason}` : ''}`}</Muted>
              <Button
                label="See all appointments"
                tone="plain"
                onPress={() => router.push('/appointments')}
              />
            </Card>
          ) : null}
        </ListState>

        {unread > 0 ? (
          <Card>
            <Text style={{ fontWeight: '600' }}>
              {unread === 1 ? '1 new update' : `${unread} new updates`}
            </Text>
            <Button label="Read them" tone="plain" onPress={() => router.push('/notifications')} />
          </Card>
        ) : null}
      </Screen>
    </ScrollView>
  )
}
