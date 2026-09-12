import { ScrollView, Text, View } from 'react-native'
import { Button, Card, ListState, Muted, Screen, Title } from '~/components/ui'
import { useMarkNotificationsRead, useNotifications } from '~/lib/queries'
import { useUser } from '~/lib/session'
import { formatWhen } from '~/lib/format'

/**
 * The bell (section 8.12).
 *
 * "Mark all read" rather than a per-row control: a list where every row has a button is a list
 * nobody reads, and the thing people actually want is the badge gone.
 */
export default function NotificationsScreen() {
  const user = useUser()
  const query = useNotifications()
  const markRead = useMarkNotificationsRead()

  const feed = query.data
  const items = feed?.items ?? []

  return (
    <ScrollView>
      <Screen>
        <Title>Updates</Title>

        {feed && feed.unreadCount > 0 ? (
          <Button
            label={`Mark ${feed.unreadCount} as read`}
            tone="plain"
            pending={markRead.isPending}
            onPress={() => markRead.mutate([])}
          />
        ) : null}

        <ListState
          loading={query.isLoading}
          error={query.error}
          empty={items.length === 0}
          emptyText="Nothing new."
          onRetry={() => void query.refetch()}
        >
          <View style={{ gap: 12 }}>
            {items.map((notification) => (
              <Card key={notification.id}>
                <Text style={{ fontWeight: notification.isRead ? '400' : '600' }}>
                  {notification.title}
                </Text>
                <Muted>{notification.body}</Muted>
                <Muted>{formatWhen(notification.createdAt, user.clinic.timezone)}</Muted>
              </Card>
            ))}
          </View>
        </ListState>
      </Screen>
    </ScrollView>
  )
}
