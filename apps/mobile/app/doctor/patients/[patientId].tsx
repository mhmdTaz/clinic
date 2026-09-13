import { useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { localDateIn } from '@clinic/contracts'
import {
  Badge,
  Button,
  Card,
  Heading,
  Muted,
  Notice,
  QueryState,
  Row,
  Screen,
  confirm,
  inform,
  palette,
} from '~/components/ui'
import { doctor } from '~/lib/api'
import { holds } from '~/lib/clinical'
import { messageFor } from '~/lib/errors'
import { ageOn, encounterTypeLabel, formatCalendarDate, formatWhen } from '~/lib/format'
import {
  useChart,
  useGrants,
  useOpenVisit,
  usePatientFiles,
  usePatientPrescriptions,
  usePatientVisits,
} from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import { ChartBanner } from '~/screens/chart-banner'
import { DocumentList } from '~/screens/document-list'

/**
 * The patient chart, read (D4): the banner first, then who they are, then what has happened.
 *
 * A doctor reaches this chart because they have treated this patient. What they can read *inside*
 * it stays strict per row — a colleague's note text is still out of reach — which is the line
 * ADR-0004 draws. Each section loads on its own, so one that is refused or fails does not take the
 * banner down with it.
 */
export default function ChartScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>()
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const zone = user.clinic.timezone

  const chart = useChart(patientId)
  const visits = usePatientVisits(patientId)
  const prescriptions = usePatientPrescriptions(patientId)
  const files = usePatientFiles(patientId)
  const { grants } = useGrants()
  const openVisit = useOpenVisit()
  const [showAllVisits, setShowAllVisits] = useState(false)

  const name = chart.data ? `${chart.data.firstName} ${chart.data.lastName}` : 'Patient chart'

  function startVisit() {
    confirm({
      title: 'Start a visit now?',
      message: `A new visit for ${name}, not attached to an appointment.`,
      confirmLabel: 'Start the visit',
      onConfirm: () =>
        openVisit.mutate(
          {
            patientId,
            appointmentId: null,
            encounterType: 'CONSULTATION',
            chiefComplaint: null,
          },
          {
            onSuccess: (encounterId) =>
              router.push({
                pathname: '/doctor/encounters/[encounterId]',
                params: { encounterId },
              }),
            onError: (error) => inform('The visit could not be started', messageFor(error)),
          },
        ),
    })
  }

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={chart.isRefetching}
          onRefresh={() => {
            void chart.refetch()
            void visits.refetch()
            void prescriptions.refetch()
            void files.refetch()
          }}
        />
      }
    >
      <Stack.Screen options={{ title: name }} />
      <Screen>
        <QueryState query={chart} emptyText="">
          {(patient) => {
            const age = patient.dateOfBirth ? ageOn(patient.dateOfBirth, localDateIn(zone)) : null
            return (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 2 }}>
                  <Text
                    accessibilityRole="header"
                    style={{ fontSize: 22, fontWeight: '600', color: palette.text }}
                  >
                    {name}
                  </Text>
                  <Muted>{patient.medicalRecordNo}</Muted>
                </View>

                <ChartBanner allergies={patient.allergies} conditions={patient.chronicConditions} />

                <Card>
                  <Fact
                    term="Date of birth"
                    value={
                      patient.dateOfBirth
                        ? `${formatCalendarDate(patient.dateOfBirth, 'plain')}${age === null ? '' : ` · ${age === 1 ? '1 year old' : `${age} years old`}`}`
                        : 'Not set'
                    }
                  />
                  <Fact
                    term="Blood type"
                    value={patient.bloodType === 'UNKNOWN' ? 'Unknown' : patient.bloodType}
                  />
                  <Fact term="Phone" value={patient.contact.phone ?? 'Not set'} />
                </Card>

                {holds(grants, 'encounter:write') ? (
                  <Button
                    label="Start a visit"
                    tone="plain"
                    onPress={startVisit}
                    pending={openVisit.isPending}
                    disabled={offline}
                  />
                ) : null}
              </View>
            )
          }}
        </QueryState>

        <Heading>Visits</Heading>
        <QueryState
          query={visits}
          isEmpty={(list) => list.length === 0}
          emptyText="No visits recorded yet."
        >
          {(list) => {
            const newestFirst = [...list].sort(
              (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
            )
            const shown = showAllVisits ? newestFirst : newestFirst.slice(0, 5)
            return (
              <View style={{ gap: 8 }}>
                {shown.map((visit) => (
                  <Row
                    key={visit.id}
                    title={formatWhen(visit.startedAt, zone)}
                    subtitle={[
                      encounterTypeLabel(visit.encounterType),
                      visit.chiefComplaint,
                      visit.doctor.id === user.doctorId ? null : visit.doctor.name,
                      visit.noteStatus === 'SIGNED' ? 'Note signed' : 'Note in progress',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() =>
                      router.push({
                        pathname: '/doctor/encounters/[encounterId]',
                        params: { encounterId: visit.id },
                      })
                    }
                  />
                ))}
                {newestFirst.length > shown.length ? (
                  <Button
                    label={`Show all ${newestFirst.length} visits`}
                    tone="plain"
                    onPress={() => setShowAllVisits(true)}
                  />
                ) : null}
              </View>
            )
          }}
        </QueryState>

        <Heading>Prescriptions</Heading>
        <QueryState
          query={prescriptions}
          isEmpty={(list) => list.length === 0}
          emptyText="No prescriptions."
        >
          {(list) => (
            <View style={{ gap: 8 }}>
              {list.map((prescription) => {
                const expired =
                  prescription.validUntil !== null && prescription.validUntil < localDateIn(zone)
                return (
                  <Card key={prescription.id}>
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontWeight: '600', color: palette.text }}>
                        {prescription.number}
                      </Text>
                      {expired ? <Badge label="Expired" tone="neutral" /> : null}
                    </View>
                    <Muted>
                      {[
                        formatWhen(prescription.issuedAt, zone),
                        prescription.doctor.name,
                        prescription.validUntil
                          ? `valid until ${formatCalendarDate(prescription.validUntil, 'short')}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Muted>
                    {prescription.items.map((item) => (
                      <Text key={item.id} style={{ color: palette.text }}>
                        {[
                          [item.drugName, item.strength, item.form].filter(Boolean).join(' '),
                          `${item.dosage}, ${item.frequency}`,
                          item.durationDays
                            ? item.durationDays === 1
                              ? 'for 1 day'
                              : `for ${item.durationDays} days`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      </Text>
                    ))}
                  </Card>
                )
              })}
            </View>
          )}
        </QueryState>

        <Heading>Documents</Heading>
        <QueryState query={files} isEmpty={(list) => list.length === 0} emptyText="No documents.">
          {(list) => (
            <DocumentList
              files={list}
              timeZone={zone}
              disabled={offline}
              linkFor={(fileId) => doctor.downloadLink(fileId)}
            />
          )}
        </QueryState>

        {offline ? (
          <Notice tone="warning">You are offline. The chart needs a connection.</Notice>
        ) : null}
      </Screen>
    </ScrollView>
  )
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text style={{ width: 110, color: palette.muted }}>{term}</Text>
      <Text selectable style={{ flex: 1, color: palette.text }}>
        {value}
      </Text>
    </View>
  )
}
