import { useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { AppointmentSummary } from '@clinic/contracts'
import {
  Badge,
  Button,
  Card,
  Heading,
  Muted,
  QueryState,
  Screen,
  confirm,
  inform,
} from '~/components/ui'
import { messageFor } from '~/lib/errors'
import { useCancelAppointment, useMyAppointments } from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import {
  appointmentStatusLabel,
  formatWhen,
  isCancellable,
  pastAppointments,
  relativeDay,
  upcomingAppointments,
} from '~/lib/format'
import { NoPatientRecord } from '~/screens/no-record'

/** How far back the list goes on screen. The window loaded is wider; a phone list should not be. */
const PAST_SHOWN = 20

/**
 * The diary (P3, P5).
 *
 * Upcoming first and past below, because the question somebody opens this screen with is almost
 * always about the future.
 */
export default function PatientAppointments() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const query = useMyAppointments(user.patientId, user.clinic.timezone)
  const cancel = useCancelAppointment()
  const [cancelling, setCancelling] = useState<string | null>(null)

  if (!user.patientId) return <NoPatientRecord />

  const zone = user.clinic.timezone

  function askToCancel(appointment: AppointmentSummary) {
    confirm({
      title: 'Cancel this appointment?',
      message: `${formatWhen(appointment.startsAt, zone)} with ${appointment.doctor.name}`,
      cancelLabel: 'Keep it',
      confirmLabel: 'Cancel it',
      destructive: true,
      onConfirm: () => {
        setCancelling(appointment.id)
        cancel.mutate(
          { appointmentId: appointment.id, reason: null },
          {
            // The server owns the cancellation window (ADR-0022). Rather than guess at it here and
            // drift, the refusal is shown as the clinic worded it.
            onError: (error) => inform('That could not be cancelled', messageFor(error)),
            onSettled: () => setCancelling(null),
          },
        )
      },
    })
  }

  return (
    <ScrollView
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      <Screen>
        <Button
          label="Book an appointment"
          onPress={() => router.push('/patient/book')}
          disabled={offline}
          accessibilityHint={offline ? 'Booking needs a connection.' : undefined}
        />

        <QueryState
          query={query}
          isEmpty={(list) => list.length === 0}
          emptyText="Nothing booked yet."
        >
          {(list) => {
            const upcoming = upcomingAppointments(list)
            const past = pastAppointments(list).slice(0, PAST_SHOWN)
            return (
              <View style={{ gap: 12 }}>
                <Heading>Upcoming</Heading>
                {upcoming.length === 0 ? (
                  <Card>
                    <Muted>You have no upcoming appointments.</Muted>
                  </Card>
                ) : null}
                {upcoming.map((appointment) => (
                  <Card key={appointment.id}>
                    <Text style={{ fontSize: 17, fontWeight: '600' }}>
                      {formatWhen(appointment.startsAt, zone)}
                    </Text>
                    <Muted>
                      {`${appointment.doctor.name} · ${relativeDay(appointment.startsAt, zone)}`}
                    </Muted>
                    {appointment.reason ? <Muted>{appointment.reason}</Muted> : null}
                    <Badge
                      label={appointmentStatusLabel(appointment.status)}
                      tone={appointment.status === 'SCHEDULED' ? 'info' : 'success'}
                    />
                    {isCancellable(appointment) ? (
                      <Button
                        label="Cancel"
                        tone="plain"
                        pending={cancelling === appointment.id}
                        disabled={offline || (cancelling !== null && cancelling !== appointment.id)}
                        onPress={() => askToCancel(appointment)}
                      />
                    ) : null}
                  </Card>
                ))}

                {past.length > 0 ? (
                  <>
                    <Heading>Past and cancelled</Heading>
                    {past.map((appointment) => (
                      <Card key={appointment.id}>
                        <Text style={{ fontSize: 15 }}>
                          {formatWhen(appointment.startsAt, zone)}
                        </Text>
                        <Muted>{appointment.doctor.name}</Muted>
                        <Badge
                          label={appointmentStatusLabel(appointment.status)}
                          tone={
                            appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW'
                              ? 'danger'
                              : 'neutral'
                          }
                        />
                      </Card>
                    ))}
                  </>
                ) : null}
              </View>
            )
          }}
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
