import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { Button, Card, Muted, QueryState, Screen, palette } from '~/components/ui'
import { formatWhen } from '~/lib/format'
import { useMarkNotificationsRead, useNotifications } from '~/lib/queries'
import { resolveHref } from '~/lib/routes'
import { useIsOffline, useUser } from '~/lib/session'

/**
 * The bell (section 8.12).
 *
 * "Mark all read" rather than a per-row control: a list where every row has a button is a list
 * nobody reads, and the thing people actually want is the count gone. A row with somewhere to go
 * opens it, through the same route table a push notification uses.
 */
export default function UpdatesScreen() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const query = useNotifications()
  const markRead = useMarkNotificationsRead()

  return (
    <ScrollView
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      <Screen>
        {query.data && query.data.unreadCount > 0 ? (
          <Button
            label={`Mark ${query.data.unreadCount} as read`}
            tone="plain"
            pending={markRead.isPending}
            disabled={offline}
            onPress={() => markRead.mutate([])}
          />
        ) : null}

        <QueryState
          query={query}
          isEmpty={(feed) => feed.items.length === 0}
          emptyText="Nothing new."
        >
          {(feed) => (
            <View style={{ gap: 12 }}>
              {feed.items.map((notification) => {
                const content = (
                  <>
                    <Text
                      style={{
                        fontWeight: notification.isRead ? '400' : '600',
                        fontSize: 15,
                        color: palette.text,
                      }}
                    >
                      {notification.title}
                    </Text>
                    <Muted>{notification.body}</Muted>
                    <Muted>{formatWhen(notification.createdAt, user.clinic.timezone)}</Muted>
                  </>
                )
                if (!notification.href) return <Card key={notification.id}>{content}</Card>
                const destination = resolveHref(notification.href, {
                  portals: user.portals,
                  current: 'patient',
                })
                return (
                  <Card key={notification.id}>
                    {content}
                    <Button
                      label="Open"
                      tone="plain"
                      onPress={() => router.push(destination as Href)}
                    />
                  </Card>
                )
              })}
            </View>
          )}
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
