import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ApiError } from '@clinic/api-client'
import {
  Badge,
  Button,
  Card,
  Field,
  Muted,
  Notice,
  QueryState,
  Screen,
  palette,
} from '~/components/ui'
import { messageFor } from '~/lib/errors'
import { formatWhen, ticketStatusLabel } from '~/lib/format'
import { useReplyToTicket, useTicket } from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'

const REPLY_MAX = 4000

/**
 * One conversation, from the asker's side (P12).
 *
 * Internal notes never arrive here: the server filters them out for anybody who is not
 * clinic-side, so there is no `if` in this file deciding what to hide (ADR-0031).
 *
 * Reached from a patient's list, and from a notification — which is why it lives outside either
 * portal: a doctor who asked the clinic something gets the reply here too.
 */
export default function TicketScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>()
  const user = useUser()
  const offline = useIsOffline()
  const query = useTicket(ticketId)
  const reply = useReplyToTicket(ticketId)
  const [draft, setDraft] = useState('')

  const closed = query.data?.status === 'CLOSED'

  function send() {
    const body = draft.trim()
    if (!body) return
    reply.mutate(body, {
      // Cleared only once the clinic has it. A reply that failed to send and vanished from the box
      // is a reply the person has to remember and type again.
      onSuccess: () => setDraft(''),
    })
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title: query.data?.subject ?? 'Conversation' }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <Screen>
          <QueryState query={query} emptyText="">
            {(ticket) => (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <Text
                    accessibilityRole="header"
                    style={{ fontSize: 20, fontWeight: '600', color: palette.text }}
                  >
                    {ticket.subject}
                  </Text>
                  <Muted>{ticket.number}</Muted>
                  <Badge
                    label={ticketStatusLabel(ticket.status)}
                    tone={
                      ticket.status === 'PENDING'
                        ? 'warning'
                        : ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
                          ? 'success'
                          : 'info'
                    }
                  />
                </View>

                {ticket.status === 'CLOSED' ? (
                  <Notice tone="info">
                    This is closed. If you need anything else, ask a new question.
                  </Notice>
                ) : null}

                {ticket.messages.map((message) => {
                  const mine = message.author?.id === user.id
                  return (
                    <Card key={message.id}>
                      <Muted>
                        {`${mine ? 'You' : (message.author?.name ?? 'Someone')} · ${formatWhen(message.createdAt, user.clinic.timezone)}`}
                      </Muted>
                      <Text
                        selectable
                        style={{ fontSize: 15, lineHeight: 21, color: palette.text }}
                      >
                        {message.body}
                      </Text>
                    </Card>
                  )
                })}
              </View>
            )}
          </QueryState>

          {query.data && !closed ? (
            <View style={{ gap: 8 }}>
              {reply.error ? (
                <Notice tone="danger">
                  {reply.error instanceof ApiError && reply.error.code === 'TICKET_CLOSED'
                    ? 'This conversation was closed a moment ago. Ask a new question instead.'
                    : messageFor(reply.error)}
                </Notice>
              ) : null}
              <Field
                nativeID="ticket-reply"
                label="Your reply"
                placeholder="Write your reply…"
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={REPLY_MAX}
                editable={!reply.isPending}
              />
              <Button
                label="Send reply"
                onPress={send}
                pending={reply.isPending}
                disabled={draft.trim() === '' || offline}
              />
            </View>
          ) : null}
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
