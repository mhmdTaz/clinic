import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, Card, Muted, Notice, QueryState, Row, Screen, Title } from '~/components/ui'
import { useMyAppointments, useNotifications } from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import { formatWhen, nextUpcoming, relativeDay } from '~/lib/format'
import { NoPatientRecord } from '~/screens/no-record'

/**
 * What a patient opens the app to find out (P1).
 *
 * One question, answered above the fold: **when am I next seen?** Everything else on this screen
 * is secondary to that, and a home screen that made somebody scroll or tap to find it would have
 * failed at the only job it reliably has.
 */
export default function PatientHome() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const appointments = useMyAppointments(user.patientId, user.clinic.timezone)
  const notifications = useNotifications()

  if (!user.patientId) return <NoPatientRecord />

  const unread = notifications.data?.unreadCount ?? 0

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={appointments.isRefetching}
          onRefresh={() => {
            void appointments.refetch()
            void notifications.refetch()
          }}
        />
      }
    >
      <Screen>
        <Title>{`Hello, ${user.firstName}`}</Title>

        {offline ? (
          <Notice tone="warning">
            You are offline. This is what the app last loaded; booking and messages need a
            connection.
          </Notice>
        ) : null}

        <QueryState
          query={appointments}
          isEmpty={(list) => nextUpcoming(list) === null}
          emptyText="You have no upcoming appointments."
        >
          {(list) => {
            const next = nextUpcoming(list)
            if (!next) return null
            return (
              <Card>
                <Muted>Your next appointment</Muted>
                <Text style={{ fontSize: 20, fontWeight: '600' }}>
                  {formatWhen(next.startsAt, user.clinic.timezone)}
                </Text>
                <Muted>
                  {[relativeDay(next.startsAt, user.clinic.timezone), next.doctor.name, next.reason]
                    .filter(Boolean)
                    .join(' · ')}
                </Muted>
                <Button
                  label="See all appointments"
                  tone="plain"
                  onPress={() => router.push('/patient/appointments')}
                />
              </Card>
            )
          }}
        </QueryState>

        <Button label="Book an appointment" onPress={() => router.push('/patient/book')} />

        <View style={{ gap: 8 }}>
          <Row
            title="Updates"
            subtitle={
              notifications.data === undefined
                ? null
                : unread === 0
                  ? 'Nothing new'
                  : unread === 1
                    ? '1 new update'
                    : `${unread} new updates`
            }
            onPress={() => router.push('/patient/updates')}
          />
          <Row
            title="My documents"
            subtitle="Everything the clinic has shared with you."
            onPress={() => router.push('/patient/documents')}
          />
          <Row
            title="Get help"
            subtitle="Ask the clinic something, and read their answer here."
            onPress={() => router.push('/patient/messages')}
          />
        </View>
      </Screen>
    </ScrollView>
  )
}
