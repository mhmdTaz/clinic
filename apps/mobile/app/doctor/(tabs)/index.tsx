import { useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { localDateIn } from '@clinic/contracts'
import {
  Badge,
  Button,
  Card,
  Muted,
  Notice,
  QueryState,
  Screen,
  inform,
  palette,
} from '~/components/ui'
import { agenda, agendaAction, holds, type AgendaEntry } from '~/lib/clinical'
import { messageFor } from '~/lib/errors'
import { appointmentStatusLabel, formatCalendarDate, formatTime, shiftDate } from '~/lib/format'
import { useDoctorDay, useGrants, useOpenVisit, useVisitsAround } from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import { NoDoctorProfile } from '~/screens/no-record'

/**
 * My day (D3): who is next, and the note for each of them.
 *
 * One day at a time, not a week. On a phone the question is "who is in the waiting room", and a
 * week view on a screen this size answers it worse than a list does.
 */
export default function DoctorDay() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const zone = user.clinic.timezone
  const today = localDateIn(zone)
  const [date, setDate] = useState(today)

  const day = useDoctorDay(date)
  const visits = useVisitsAround(date)
  const { grants } = useGrants()
  const openVisit = useOpenVisit()
  const [starting, setStarting] = useState<string | null>(null)

  if (!user.doctorId) return <NoDoctorProfile />

  function record(entry: AgendaEntry) {
    setStarting(entry.appointment.id)
    openVisit.mutate(
      {
        patientId: entry.appointment.patient.id,
        appointmentId: entry.appointment.id,
        encounterType: 'CONSULTATION',
        chiefComplaint: entry.appointment.reason,
      },
      {
        onSuccess: (encounterId) =>
          router.push({ pathname: '/doctor/encounters/[encounterId]', params: { encounterId } }),
        onError: (error) => inform('The visit could not be started', messageFor(error)),
        onSettled: () => setStarting(null),
      },
    )
  }

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={day.isRefetching}
          onRefresh={() => {
            void day.refetch()
            void visits.refetch()
          }}
        />
      }
    >
      <Screen>
        <View style={{ gap: 4 }}>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 20, fontWeight: '600', color: palette.text }}
          >
            {date === today ? 'Today' : formatCalendarDate(date, 'short')}
          </Text>
          <Muted>{formatCalendarDate(date)}</Muted>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="‹ Previous"
              tone="plain"
              compact
              onPress={() => setDate(shiftDate(date, -1))}
            />
          </View>
          {date !== today ? (
            <View style={{ flex: 1 }}>
              <Button label="Today" tone="plain" compact onPress={() => setDate(today)} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button
              label="Next ›"
              tone="plain"
              compact
              onPress={() => setDate(shiftDate(date, 1))}
            />
          </View>
        </View>

        {offline ? (
          <Notice tone="warning">
            You are offline. This is the day as it was last loaded; notes need a connection.
          </Notice>
        ) : null}

        <QueryState
          query={day}
          isEmpty={(appointments) => appointments.length === 0}
          emptyText="Nothing booked."
        >
          {(appointments) => {
            const entries = agenda(appointments, visits.data ?? [])
            const visitsKnown = visits.data !== undefined && !offline
            return (
              <View style={{ gap: 12 }}>
                <Muted>
                  {entries.length === 1 ? '1 appointment' : `${entries.length} appointments`}
                </Muted>
                {visits.error && visits.data === undefined ? (
                  <Notice
                    tone="warning"
                    action={{ label: 'Try again', onPress: () => void visits.refetch() }}
                  >
                    Which appointments already have a note could not be loaded.
                  </Notice>
                ) : null}

                {entries.map((entry) => {
                  const { appointment, visit } = entry
                  const action = agendaAction(entry, {
                    visitsKnown,
                    canWrite: holds(grants, 'encounter:write'),
                  })
                  const inactive =
                    appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW'
                  return (
                    <Card key={appointment.id}>
                      <Text
                        style={{
                          fontSize: 17,
                          fontWeight: '600',
                          color: inactive ? palette.muted : palette.text,
                        }}
                      >
                        {`${formatTime(appointment.startsAt, zone)} – ${formatTime(appointment.endsAt, zone)}`}
                      </Text>
                      <Text style={{ fontSize: 16, color: palette.text }}>
                        {appointment.patient.name}
                      </Text>
                      <Muted>
                        {[appointment.patient.medicalRecordNo, appointment.reason]
                          .filter(Boolean)
                          .join(' · ')}
                      </Muted>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        <Badge
                          label={appointmentStatusLabel(appointment.status)}
                          tone={
                            inactive
                              ? 'danger'
                              : appointment.status === 'COMPLETED'
                                ? 'success'
                                : 'info'
                          }
                        />
                        {visit ? (
                          <Badge
                            label={
                              visit.noteStatus === 'SIGNED' ? 'Note signed' : 'Note in progress'
                            }
                            tone={visit.noteStatus === 'SIGNED' ? 'success' : 'warning'}
                          />
                        ) : null}
                      </View>

                      {action === 'openNote' && visit ? (
                        <Button
                          label="Open the note"
                          onPress={() =>
                            router.push({
                              pathname: '/doctor/encounters/[encounterId]',
                              params: { encounterId: visit.id },
                            })
                          }
                        />
                      ) : null}
                      {action === 'recordVisit' ? (
                        <Button
                          label="Record the visit"
                          pending={starting === appointment.id}
                          disabled={starting !== null && starting !== appointment.id}
                          onPress={() => record(entry)}
                        />
                      ) : null}
                      <Button
                        label="Patient chart"
                        tone="plain"
                        onPress={() =>
                          router.push({
                            pathname: '/doctor/patients/[patientId]',
                            params: { patientId: appointment.patient.id },
                          })
                        }
                      />
                    </Card>
                  )
                })}
              </View>
            )
          }}
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
