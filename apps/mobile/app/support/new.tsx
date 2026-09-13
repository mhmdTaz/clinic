import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ApiError } from '@clinic/api-client'
import { TicketCategory } from '@clinic/contracts'
import { Button, Field, Muted, Notice, Screen, palette } from '~/components/ui'
import { messageFor } from '~/lib/errors'
import { TICKET_CATEGORY_LABELS } from '~/lib/format'
import { useOpenTicket } from '~/lib/queries'

const SUBJECT_MAX = 160
const BODY_MAX = 4000

/**
 * Asking the clinic something (P12).
 *
 * No priority and no attachments. A patient's priority is ignored by the server anyway — only the
 * clinic sets it — and attaching a photo from the camera roll is an upload flow with scanning
 * behind it that the web has and the app does not yet.
 */
export default function OpenTicketScreen() {
  const router = useRouter()
  const open = useOpenTicket()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<TicketCategory>('OTHER')
  const [body, setBody] = useState('')

  const ready = subject.trim() !== '' && body.trim() !== ''
  const fieldErrors = open.error instanceof ApiError ? open.error.fieldErrors() : {}

  function send() {
    open.mutate(
      { subject: subject.trim(), category, body: body.trim() },
      {
        onSuccess: (ticket) =>
          // Replace, not push: back from the new thread should go to the list, not to a form that
          // would send the same question twice.
          router.replace({ pathname: '/support/[ticketId]', params: { ticketId: ticket.id } }),
      },
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Screen>
          <Muted>Tell us what you need. Somebody will read it and reply here.</Muted>

          {open.error ? <Notice tone="danger">{messageFor(open.error)}</Notice> : null}

          <Field
            nativeID="ticket-subject"
            label="What is it about?"
            value={subject}
            onChangeText={setSubject}
            maxLength={SUBJECT_MAX}
            error={fieldErrors.subject ? 'Give your question a short subject.' : null}
          />

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: palette.muted }}>
              Kind of question
            </Text>
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
            >
              {TicketCategory.options.map((option) => {
                const selected = option === category
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setCategory(option)}
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? palette.primary : palette.border,
                      backgroundColor: selected ? palette.primarySoft : palette.card,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      minHeight: 44,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: selected ? palette.primary : palette.text }}>
                      {TICKET_CATEGORY_LABELS[option]}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <Field
            nativeID="ticket-body"
            label="Your message"
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={BODY_MAX}
            hint={
              body.length > BODY_MAX - 200 ? `${BODY_MAX - body.length} characters left` : undefined
            }
            error={fieldErrors.body ? 'Write a message for the clinic.' : null}
          />

          <Button label="Send it" onPress={send} pending={open.isPending} disabled={!ready} />
          <Button
            label="Cancel"
            tone="plain"
            onPress={() => router.back()}
            disabled={open.isPending}
          />
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
