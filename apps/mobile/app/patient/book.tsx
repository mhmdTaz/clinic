import { useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { ApiError } from '@clinic/api-client'
import { localDateIn, type DoctorSummary } from '@clinic/contracts'
import {
  Button,
  Card,
  Field,
  Heading,
  Muted,
  Notice,
  QueryState,
  Screen,
  inform,
  palette,
} from '~/components/ui'
import { messageFor } from '~/lib/errors'
import { bookingWeek, formatCalendarDate, formatTime, formatWhen, shiftDate } from '~/lib/format'
import {
  useBookAppointment,
  useBookableDoctors,
  useBookingWindow,
  useOpenTimes,
} from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import { reminderProblemText, useReminders } from '~/lib/use-reminders'
import { NoPatientRecord } from '~/screens/no-record'

const doctorName = (doctor: Pick<DoctorSummary, 'title' | 'displayName'>): string =>
  [doctor.title, doctor.displayName].filter(Boolean).join(' ')

/**
 * A patient booking for themselves (P5).
 *
 * The server decides who the patient is from the session, so this screen never names one, and the
 * clinic's notice period is already applied to the times offered (ADR-0022). How far ahead the
 * weeks go is the clinic's own horizon, read from `/api/v1/clinic/booking-window`.
 */
export default function BookScreen() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const zone = user.clinic.timezone
  const today = localDateIn(zone)

  const doctors = useBookableDoctors()
  // Every active doctor, as the web offers. `isAcceptingNew` is about new patients, and filtering
  // on it would hide a returning patient's own doctor.
  const bookable = useMemo(() => doctors.data ?? [], [doctors.data])

  const [doctorId, setDoctorId] = useState<string | null>(null)
  const chosenDoctorId = doctorId ?? (bookable.length === 1 ? (bookable[0]?.id ?? null) : null)
  const chosenDoctor = bookable.find((doctor) => doctor.id === chosenDoctorId) ?? null

  const bookingWindow = useBookingWindow()
  const horizonDays = bookingWindow.data?.horizonDays ?? null
  const [weekOffset, setWeekOffset] = useState(0)
  const { from, to, lastOffset } = bookingWeek(today, horizonDays, weekOffset)
  const currentWeek = Math.min(weekOffset, lastOffset)

  const times = useOpenTimes(chosenDoctorId, from, to)
  const [startsAt, setStartsAt] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [booked, setBooked] = useState<{ startsAt: string; doctor: string } | null>(null)

  /**
   * One key per attempt — per doctor and time chosen — reused if the person taps again, so the
   * server answers a retry with the appointment the first tap booked (`useBookAppointment`).
   */
  const attemptKey = useRef<{ for: string; key: string } | null>(null)
  const keyFor = (attempt: string): string => {
    if (attemptKey.current?.for !== attempt) {
      attemptKey.current = { for: attempt, key: Crypto.randomUUID() }
    }
    return attemptKey.current.key
  }

  const book = useBookAppointment()
  const reminders = useReminders()

  if (!user.patientId) return <NoPatientRecord />

  function choose(next: string | null) {
    setDoctorId(next)
    setStartsAt(null)
    setWeekOffset(0)
    setNotice(null)
  }

  function confirmBooking() {
    if (!chosenDoctor || !startsAt) return
    setNotice(null)
    book.mutate(
      {
        doctorId: chosenDoctor.id,
        startsAt,
        reason: reason.trim() || null,
        idempotencyKey: keyFor(`${chosenDoctor.id}|${startsAt}`),
      },
      {
        // A replay of a booking whose response was lost is a success like any other: it is the
        // appointment the first tap made, and there is only one.
        onSuccess: () => setBooked({ startsAt, doctor: doctorName(chosenDoctor) }),
        onError: (error) => {
          const refusal = error instanceof ApiError ? error : null
          if (refusal?.code === 'IDEMPOTENCY_KEY_IN_USE') {
            // The first tap is still being booked. Same time, same key: confirming again in a
            // moment gets its answer.
            setNotice('Your booking is still going through. Give it a moment, then confirm again.')
            return
          }
          if (!refusal || refusal.status === 0 || refusal.status >= 500) {
            // Not a refusal: the booking may or may not have been made. The choice and its key stay,
            // so confirming again is answered as the first attempt was.
            setNotice(messageFor(error))
            return
          }
          // A refusal about the time chosen. The server keeps that answer against the key, so a
          // later attempt at the same time — freed by a cancellation, say — needs a new one.
          attemptKey.current = null
          setNotice(
            refusal.code === 'SLOT_TAKEN'
              ? 'That time was just taken by someone else. Please choose another.'
              : messageFor(error),
          )
          setStartsAt(null)
          void times.refetch()
        },
      },
    )
  }

  if (booked) {
    return (
      <ScrollView>
        <Screen>
          <Notice tone="success">Your appointment is booked.</Notice>
          <Card>
            <Text style={{ fontSize: 20, fontWeight: '600', color: palette.text }}>
              {formatWhen(booked.startsAt, zone)}
            </Text>
            <Muted>{booked.doctor}</Muted>
          </Card>

          {reminders.known && !reminders.on ? (
            <Card>
              <Text style={{ fontWeight: '600', color: palette.text }}>
                Get a reminder on this phone?
              </Text>
              <Muted>A reminder before each appointment. You will still get them by email.</Muted>
              <Button
                label="Turn on reminders"
                tone="plain"
                pending={reminders.busy}
                onPress={() =>
                  void reminders.change(true).then((problem) => {
                    if (problem) {
                      const text = reminderProblemText(problem)
                      inform(text.title, text.message)
                    }
                  })
                }
              />
            </Card>
          ) : null}

          <Button
            label="See my appointments"
            onPress={() => router.dismissTo('/patient/appointments')}
          />
        </Screen>
      </ScrollView>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Screen>
          <Muted>Choose a doctor and one of the times they are open.</Muted>
          {offline ? (
            <Notice tone="warning">
              Booking needs a connection. Try again when you have signal.
            </Notice>
          ) : null}
          {notice ? <Notice tone="danger">{notice}</Notice> : null}

          <Heading>Doctor</Heading>
          <QueryState
            query={doctors}
            isEmpty={() => bookable.length === 0}
            emptyText="No doctors are taking appointments. Please call the clinic to arrange a time."
          >
            {() => (
              <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                {bookable.map((doctor) => (
                  <Choice
                    key={doctor.id}
                    selected={doctor.id === chosenDoctorId}
                    title={doctorName(doctor)}
                    subtitle={doctor.specialties.map((specialty) => specialty.name).join(', ')}
                    onPress={() => choose(doctor.id)}
                  />
                ))}
              </View>
            )}
          </QueryState>

          {chosenDoctor ? (
            <>
              <Heading>Open times</Heading>
              {bookingWindow.data ? (
                <Muted>
                  {`Booking is open up to ${formatCalendarDate(shiftDate(today, bookingWindow.data.horizonDays))}.`}
                </Muted>
              ) : bookingWindow.error ? (
                <Notice
                  tone="warning"
                  action={{ label: 'Try again', onPress: () => void bookingWindow.refetch() }}
                >
                  How far ahead you can book could not be loaded, so only this week is shown.
                </Notice>
              ) : null}
              <Text style={{ textAlign: 'center', color: palette.text, fontWeight: '600' }}>
                {`${formatCalendarDate(from, 'short')} – ${formatCalendarDate(to, 'short')}`}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="‹ Earlier week"
                    tone="plain"
                    compact
                    disabled={currentWeek === 0}
                    onPress={() => {
                      setWeekOffset(Math.max(0, currentWeek - 1))
                      setStartsAt(null)
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Later week ›"
                    tone="plain"
                    compact
                    disabled={currentWeek >= lastOffset}
                    onPress={() => {
                      setWeekOffset(Math.min(lastOffset, currentWeek + 1))
                      setStartsAt(null)
                    }}
                  />
                </View>
              </View>

              <QueryState
                query={times}
                isEmpty={(days) => days.every((day) => day.slots.length === 0)}
                emptyText={
                  currentWeek >= lastOffset
                    ? 'No open times this week.'
                    : 'No open times this week. Try the next one.'
                }
              >
                {(days) => (
                  <View style={{ gap: 12 }}>
                    {days
                      .filter((day) => day.slots.length > 0)
                      .map((day) => (
                        <View key={day.date} style={{ gap: 6 }}>
                          <Text style={{ fontWeight: '600', color: palette.text }}>
                            {formatCalendarDate(day.date, 'short')}
                          </Text>
                          <View
                            accessibilityRole="radiogroup"
                            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
                          >
                            {day.slots.map((slot) => (
                              <Chip
                                key={slot.startsAt}
                                label={formatTime(slot.startsAt, zone)}
                                selected={slot.startsAt === startsAt}
                                onPress={() => {
                                  setStartsAt(slot.startsAt)
                                  setNotice(null)
                                }}
                              />
                            ))}
                          </View>
                        </View>
                      ))}
                  </View>
                )}
              </QueryState>

              <Field
                nativeID="booking-reason"
                label="What is it about? (optional)"
                hint="A short note helps the clinic prepare. You can leave it blank."
                value={reason}
                onChangeText={setReason}
                maxLength={300}
              />

              {startsAt ? (
                <Card>
                  <Muted>You are booking</Muted>
                  <Text style={{ fontSize: 17, fontWeight: '600', color: palette.text }}>
                    {formatWhen(startsAt, zone)}
                  </Text>
                  <Muted>{doctorName(chosenDoctor)}</Muted>
                </Card>
              ) : null}

              <Button
                label="Confirm the booking"
                onPress={confirmBooking}
                pending={book.isPending}
                disabled={!startsAt || offline}
              />
            </>
          ) : null}
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Choice({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string
  subtitle: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={{
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? palette.primary : palette.border,
        backgroundColor: selected ? palette.primarySoft : palette.card,
        padding: 14,
        gap: 2,
        minHeight: 44,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text }}>{title}</Text>
      {subtitle ? <Muted>{subtitle}</Muted> : null}
    </Pressable>
  )
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: selected ? palette.primary : palette.border,
        backgroundColor: selected ? palette.primary : palette.card,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minWidth: 72,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: selected ? '#fff' : palette.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )
}
