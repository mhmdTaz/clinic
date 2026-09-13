import { RefreshControl, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, Muted, QueryState, Row, Screen } from '~/components/ui'
import { formatWhen, ticketStatusLabel } from '~/lib/format'
import { useMyTickets } from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'

/**
 * The patient's questions to the clinic (P12), newest activity first.
 *
 * Every thread the person has opened, resolved ones included: this is their history with the
 * clinic, not a queue to be worked, and "what did they tell me last month" is a question it
 * should answer.
 */
export default function PatientMessages() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const query = useMyTickets()

  return (
    <ScrollView
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      <Screen>
        <Muted>Ask the clinic something, and read their answer here.</Muted>
        <Button
          label="Ask a question"
          onPress={() => router.push('/support/new')}
          disabled={offline}
        />

        <QueryState
          query={query}
          isEmpty={(tickets) => tickets.length === 0}
          emptyText="You have not asked anything yet. Anything you ask the clinic will appear here, along with their reply."
        >
          {(tickets) => (
            <View style={{ gap: 8 }}>
              {[...tickets]
                .sort(
                  (left, right) =>
                    Date.parse(right.lastMessageAt ?? right.createdAt ?? '') -
                    Date.parse(left.lastMessageAt ?? left.createdAt ?? ''),
                )
                .map((ticket) => (
                  <Row
                    key={ticket.id}
                    title={ticket.subject}
                    subtitle={[
                      ticketStatusLabel(ticket.status),
                      ticket.lastMessageAt
                        ? formatWhen(ticket.lastMessageAt, user.clinic.timezone)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    detail={
                      ticket.messageCount === 1 ? '1 message' : `${ticket.messageCount} messages`
                    }
                    onPress={() =>
                      router.push({
                        pathname: '/support/[ticketId]',
                        params: { ticketId: ticket.id },
                      })
                    }
                  />
                ))}
            </View>
          )}
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
