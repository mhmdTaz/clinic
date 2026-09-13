import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useNavigation } from 'expo-router'
import type { EncounterDetail } from '@clinic/contracts'
import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  Muted,
  Notice,
  QueryState,
  Screen,
  confirm,
  palette,
} from '~/components/ui'
import {
  NOTE_SECTIONS,
  NOTE_SECTION_TEXT,
  isNoteDirty,
  maySign,
  noteMode,
  noteStateOf,
  noteUpdate,
  rebaseNote,
  sameNote,
  vitalsReadings,
  type NoteState,
} from '~/lib/clinical'
import { messageFor } from '~/lib/errors'
import { encounterTypeLabel, formatWhen } from '~/lib/format'
import {
  useAddAddendum,
  useChart,
  useEncounter,
  useGrants,
  useSaveNote,
  useSignNote,
} from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import { ChartBanner } from '~/screens/chart-banner'

/**
 * The visit and its note (D6–D9), on a phone.
 *
 * Two states, not one screen with fields disabled: a draft is written, and a signed note is read.
 * After signing, the only thing that can be added is an addendum beneath it (ADR-0024), and the
 * screen says so rather than showing a form the server would refuse.
 *
 * Narrower than the web's workspace on purpose: vitals and diagnoses are shown, not edited, and
 * prescribing and stock stay at the desk. They are forms with pick-lists; the note is prose, and
 * prose is what a phone is good for between patients.
 */
export default function EncounterScreen() {
  const { encounterId } = useLocalSearchParams<{ encounterId: string }>()
  const user = useUser()
  const query = useEncounter(encounterId)
  const chart = useChart(query.data?.patient.id ?? '', { enabled: query.data !== undefined })
  const { grants, known } = useGrants()

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title: query.data?.patient.name ?? 'Visit' }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <Screen>
          <QueryState query={query} emptyText="">
            {(encounter) => (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 4 }}>
                  <Text
                    accessibilityRole="header"
                    style={{ fontSize: 22, fontWeight: '600', color: palette.text }}
                  >
                    {encounter.patient.name}
                  </Text>
                  <Muted>
                    {`${encounter.number} · ${encounterTypeLabel(encounter.encounterType)} · started ${formatWhen(encounter.startedAt, user.clinic.timezone)}`}
                  </Muted>
                  {encounter.chiefComplaint ? <Muted>{encounter.chiefComplaint}</Muted> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Badge
                      label={
                        encounter.note.status === 'SIGNED' ? 'Note signed' : 'Note in progress'
                      }
                      tone={encounter.note.status === 'SIGNED' ? 'success' : 'warning'}
                    />
                    {encounter.note.isPatientVisible ? (
                      <Badge label="Shared with the patient" tone="info" />
                    ) : null}
                  </View>
                </View>

                {chart.data ? (
                  <ChartBanner
                    allergies={chart.data.allergies}
                    conditions={chart.data.chronicConditions}
                  />
                ) : chart.error ? (
                  // The banner is the part that prevents harm, so its absence is said out loud.
                  <Notice
                    tone="warning"
                    action={{ label: 'Try again', onPress: () => void chart.refetch() }}
                  >
                    Allergies and chronic conditions could not be loaded.
                  </Notice>
                ) : null}

                {known ? (
                  <NoteCard encounter={encounter} doctorId={user.doctorId} grants={grants} />
                ) : (
                  <Card>
                    <Muted>Loading…</Muted>
                  </Card>
                )}

                <VitalsCard encounter={encounter} />
                <DiagnosesCard encounter={encounter} />
              </View>
            )}
          </QueryState>
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function NoteCard({
  encounter,
  doctorId,
  grants,
}: {
  encounter: EncounterDetail
  doctorId: string | null
  grants: ReturnType<typeof useGrants>['grants']
}) {
  const user = useUser()
  const mode = noteMode(encounter, doctorId, grants)
  const signable = maySign(encounter, doctorId, grants)

  if (mode === 'write') {
    return <NoteEditor encounter={encounter} canSign={signable} />
  }

  const note = encounter.note
  return (
    <Card>
      <Heading>Clinical note</Heading>
      {mode === 'signed' ? (
        <>
          <Muted>
            {`Signed by ${note.signedBy?.name ?? 'the doctor'}${note.signedAt ? ` on ${formatWhen(note.signedAt, user.clinic.timezone)}` : ''}.`}
          </Muted>
          <Notice tone="info">
            This note is signed. Its text can no longer be changed — add an addendum below instead.
          </Notice>
        </>
      ) : encounter.doctor.id === doctorId ? (
        <Notice tone="info">
          Your role does not include writing notes, so this one is read-only.
        </Notice>
      ) : (
        <Notice tone="info">
          This visit was recorded by another doctor, so its note is not yours to change.
        </Notice>
      )}

      {NOTE_SECTIONS.map((section) => (
        <View key={section} style={{ gap: 2 }}>
          <Text style={{ fontWeight: '600', color: palette.text }}>
            {NOTE_SECTION_TEXT[section].label}
          </Text>
          {/* A dash, not "None": on a colleague's visit the server leaves text out (ADR-0025), and
              "None" would claim the section is empty when it may only be unshared. */}
          <Text
            selectable
            style={{ color: note[section] ? palette.text : palette.muted, lineHeight: 21 }}
          >
            {note[section] ?? '—'}
          </Text>
        </View>
      ))}

      {note.addenda.length > 0 ? (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 10 }}>
          <Text style={{ fontWeight: '600', color: palette.text }}>Addenda</Text>
          {note.addenda.map((addendum) => (
            <View key={addendum.id} style={{ gap: 2 }}>
              <Muted>
                {[
                  addendum.author?.name,
                  addendum.createdAt ? formatWhen(addendum.createdAt, user.clinic.timezone) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
              <Text selectable style={{ color: palette.text, lineHeight: 21 }}>
                {addendum.body}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {mode === 'signed' && signable ? <AddendumForm encounterId={encounter.id} /> : null}
    </Card>
  )
}

/**
 * The draft.
 *
 * **Saving is explicit**, as on the web. An autosaving clinical note sounds kind until you picture
 * a half-typed differential written to the record because the phone locked. Leaving with unsaved
 * changes asks first, which does the same job without the risk.
 */
function NoteEditor({ encounter, canSign }: { encounter: EncounterDetail; canSign: boolean }) {
  const offline = useIsOffline()
  const navigation = useNavigation()
  const save = useSaveNote(encounter.id)
  const sign = useSignNote(encounter.id)

  const [current, setCurrent] = useState<NoteState>(() => noteStateOf(encounter.note))
  const [baseline, setBaseline] = useState<NoteState>(() => noteStateOf(encounter.note))
  const [saved, setSaved] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signature, setSignature] = useState(encounter.doctor.name)

  // The server's note changed — a save from here or from the desk, or a refetch. Take its sections
  // wherever nothing has been typed here (see `rebaseNote`).
  const server = noteStateOf(encounter.note)
  if (!sameNote(server, baseline)) {
    setCurrent(rebaseNote(current, baseline, server))
    setBaseline(server)
  }

  const dirty = isNoteDirty(current, baseline)

  // Asks before leaving a note with unsaved changes. A ref, so the listener is added once and
  // still sees the latest state.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!dirtyRef.current) return
        event.preventDefault()
        confirm({
          title: 'Leave without saving?',
          message: 'What you have written since the last save will be lost.',
          cancelLabel: 'Keep writing',
          confirmLabel: 'Leave',
          destructive: true,
          onConfirm: () => navigation.dispatch(event.data.action),
        })
      }),
    [navigation],
  )

  function saveNote() {
    const update = noteUpdate(current, baseline)
    if (!update) return
    setSaved(false)
    save.mutate(update, { onSuccess: () => setSaved(true) })
  }

  function signNote() {
    sign.mutate(signature.trim(), { onSuccess: () => setSigning(false) })
  }

  return (
    <Card>
      <Heading>Clinical note</Heading>
      <Muted>
        Still a draft. Nothing here is visible to the patient until it is signed and shared.
      </Muted>

      {saved && !dirty ? <Notice tone="success">Note saved.</Notice> : null}
      {save.error ? <Notice tone="danger">{messageFor(save.error)}</Notice> : null}

      {NOTE_SECTIONS.map((section) => (
        <Field
          key={section}
          nativeID={`note-${section}`}
          label={NOTE_SECTION_TEXT[section].label}
          placeholder={NOTE_SECTION_TEXT[section].hint}
          value={current.draft[section]}
          onChangeText={(text) => {
            setCurrent((state) => ({ ...state, draft: { ...state.draft, [section]: text } }))
            setSaved(false)
          }}
          multiline
          maxLength={5000}
          editable={!save.isPending && !sign.isPending}
        />
      ))}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontWeight: '600', color: palette.text }}>
            Share this note with the patient
          </Text>
          <Muted>They see it in their own records once it has been signed.</Muted>
        </View>
        <Switch
          accessibilityLabel="Share this note with the patient"
          value={current.shared}
          onValueChange={(next) => {
            setCurrent((state) => ({ ...state, shared: next }))
            setSaved(false)
          }}
          trackColor={{ true: palette.primary }}
        />
      </View>

      <Button
        label="Save the note"
        onPress={saveNote}
        pending={save.isPending}
        disabled={!dirty || offline || sign.isPending}
      />
      {dirty && !save.isPending ? <Muted>Unsaved changes</Muted> : null}

      {canSign ? (
        signing ? (
          <View
            style={{ gap: 10, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12 }}
          >
            <Text style={{ fontWeight: '600', color: palette.text }}>Sign this note</Text>
            <Notice tone="warning">
              Once signed, the text of this note cannot be changed by anyone — including you.
              Corrections are added underneath as addenda.
            </Notice>
            {sign.error ? <Notice tone="danger">{messageFor(sign.error)}</Notice> : null}
            <Field
              nativeID="note-signature"
              label="Signature"
              hint="Type your name as it should appear beneath the note."
              value={signature}
              onChangeText={setSignature}
              maxLength={120}
              autoCorrect={false}
            />
            <Button
              label="Sign the note"
              onPress={signNote}
              pending={sign.isPending}
              disabled={signature.trim() === '' || offline}
            />
            <Button
              label="Cancel"
              tone="plain"
              onPress={() => setSigning(false)}
              disabled={sign.isPending}
            />
          </View>
        ) : (
          <>
            <Button
              label="Sign the note"
              tone="plain"
              // Signing freezes what the server holds, not what is on screen — so unsaved words
              // would not be in the signed note. Save first, and the button says why it waits.
              disabled={dirty || offline}
              onPress={() => {
                setSignature(encounter.doctor.name)
                setSigning(true)
              }}
            />
            {dirty ? <Muted>Save your changes before signing.</Muted> : null}
          </>
        )
      ) : null}
    </Card>
  )
}

function AddendumForm({ encounterId }: { encounterId: string }) {
  const offline = useIsOffline()
  const add = useAddAddendum(encounterId)
  const [body, setBody] = useState('')

  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12 }}>
      {add.error ? <Notice tone="danger">{messageFor(add.error)}</Notice> : null}
      <Field
        nativeID="note-addendum"
        label="Add an addendum"
        hint="A correction or an addition. It appears beneath the signed note."
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        editable={!add.isPending}
      />
      <Button
        label="Add the addendum"
        onPress={() => add.mutate({ body: body.trim() }, { onSuccess: () => setBody('') })}
        pending={add.isPending}
        disabled={body.trim() === '' || offline}
      />
    </View>
  )
}

function VitalsCard({ encounter }: { encounter: EncounterDetail }) {
  const readings = vitalsReadings(encounter.vitals)
  return (
    <Card>
      <Heading>Vitals</Heading>
      {readings.length === 0 ? (
        <Muted>None recorded</Muted>
      ) : (
        readings.map((reading) => (
          <View
            key={reading.label}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
          >
            <Text style={{ color: palette.muted }}>{reading.label}</Text>
            <Text style={{ color: palette.text, fontWeight: '600' }}>{reading.value}</Text>
          </View>
        ))
      )}
    </Card>
  )
}

function DiagnosesCard({ encounter }: { encounter: EncounterDetail }) {
  return (
    <Card>
      <Heading>Diagnoses</Heading>
      {encounter.diagnoses.length === 0 ? (
        <Muted>None coded.</Muted>
      ) : (
        encounter.diagnoses.map((diagnosis) => (
          <View key={diagnosis.id} style={{ gap: 4 }}>
            <Text
              style={{ color: palette.text }}
            >{`${diagnosis.code} — ${diagnosis.description}`}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {diagnosis.isPrimary ? <Badge label="Primary" tone="info" /> : null}
              {diagnosis.isChronic ? <Badge label="Chronic" /> : null}
            </View>
          </View>
        ))
      )}
    </Card>
  )
}
