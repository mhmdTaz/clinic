import { useState } from 'react'
import { Alert, ScrollView, Text, View } from 'react-native'
import { ApiError } from '@clinic/api-client'
import type { AppointmentSummary } from '@clinic/contracts'
import { Button, Card, ListState, Muted, Screen, Title } from '~/components/ui'
import { useCancelAppointment, useMyAppointments } from '~/lib/queries'
import { useUser } from '~/lib/session'
import {
  formatWhen,
  isCancellable,
  pastAppointments,
  relativeDay,
  upcomingAppointments,
} from '~/lib/format'

/**
 * The diary (P3, P5).
 *
 * Upcoming first and past below, because the question somebody opens this screen with is almost
 * always about the future. Cancelling is here and booking is not: booking needs a doctor, a
 * window and a slot, which is a flow rather than a button.
 */
export default function AppointmentsScreen() {
  const user = useUser()
  const query = useMyAppointments(user.patientId ?? '')
  const cancel = useCancelAppointment()
  const [cancelling, setCancelling] = useState<string | null>(null)

  const all = query.data ?? []
  const upcoming = upcomingAppointments(all)
  const past = pastAppointments(all)

  function confirmCancel(appointment: AppointmentSummary) {
    Alert.alert(
      'Cancel this appointment?',
      `${formatWhen(appointment.startsAt, user.clinic.timezone)} with ${appointment.doctor.name}`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel it',
          style: 'destructive',
          onPress: () => {
            setCancelling(appointment.id)
            cancel.mutate(
              { appointmentId: appointment.id, reason: null },
              {
                // The server owns the cancellation window (ADR-0022). Rather than guess at it
                // here and drift, the refusal is shown as the clinic worded it.
                onError: (error) =>
                  Alert.alert(
                    'That could not be cancelled',
                    error instanceof ApiError
                      ? error.message
                      : 'Please ring the clinic to cancel this one.',
                  ),
                onSettled: () => setCancelling(null),
              },
            )
          },
        },
      ],
    )
  }

  return (
    <ScrollView>
      <Screen>
        <Title>Appointments</Title>

        <ListState
          loading={query.isLoading}
          error={query.error}
          empty={all.length === 0}
          emptyText="Nothing booked yet. Ring the clinic to arrange a visit."
          onRetry={() => void query.refetch()}
        >
          <View style={{ gap: 12 }}>
            {upcoming.map((appointment) => (
              <Card key={appointment.id}>
                <Text style={{ fontSize: 17, fontWeight: '600' }}>
                  {formatWhen(appointment.startsAt, user.clinic.timezone)}
                </Text>
                <Muted>
                  {`${appointment.doctor.name} · ${relativeDay(appointment.startsAt, user.clinic.timezone)}`}
                </Muted>
                {appointment.reason ? <Muted>{appointment.reason}</Muted> : null}
                {isCancellable(appointment) ? (
                  <Button
                    label="Cancel"
                    tone="danger"
                    pending={cancelling === appointment.id}
                    onPress={() => confirmCancel(appointment)}
                  />
                ) : null}
              </Card>
            ))}

            {past.length > 0 ? (
              <>
                <Text style={{ marginTop: 8, fontWeight: '600' }}>Past</Text>
                {past.slice(0, 20).map((appointment) => (
                  <Card key={appointment.id}>
                    <Text>{formatWhen(appointment.startsAt, user.clinic.timezone)}</Text>
                    <Muted>{`${appointment.doctor.name} · ${appointment.status.toLowerCase().replace('_', ' ')}`}</Muted>
                  </Card>
                ))}
              </>
            ) : null}
          </View>
        </ListState>
      </Screen>
    </ScrollView>
  )
}
