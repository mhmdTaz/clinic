import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { Button, Card, Muted, Notice, QueryState, Screen, palette } from '~/components/ui'
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
 *
 * Older updates a page at a time, on request: a feed has no natural end, and reading all of it to
 * show the top of it would cost a patient's data plan for nothing.
 */
export default function UpdatesScreen() {
  const user = useUser()
  const router = useRouter()
  const offline = useIsOffline()
  const query = useNotifications()
  const markRead = useMarkNotificationsRead()

  const unread = query.data?.pages[0]?.unreadCount ?? 0

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
        />
      }
    >
      <Screen>
        {unread > 0 ? (
          <Button
            label={`Mark ${unread} as read`}
            tone="plain"
            pending={markRead.isPending}
            disabled={offline}
            onPress={() => markRead.mutate([])}
          />
        ) : null}

        <QueryState
          // A page of older updates that would not load is said beside the button that asked for
          // it, not as "could not refresh" over a list that is perfectly current.
          query={{ ...query, error: query.isFetchNextPageError ? null : query.error }}
          isEmpty={(feed) => feed.pages.every((page) => page.items.length === 0)}
          emptyText="Nothing new."
        >
          {(feed) => (
            <View style={{ gap: 12 }}>
              {feed.pages
                .flatMap((page) => page.items)
                .map((notification) => {
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
              {query.isFetchNextPageError ? (
                <Notice
                  tone="warning"
                  action={{ label: 'Try again', onPress: () => void query.fetchNextPage() }}
                >
                  Older updates could not be loaded.
                </Notice>
              ) : query.hasNextPage ? (
                <Button
                  label="Show older updates"
                  tone="plain"
                  pending={query.isFetchingNextPage}
                  disabled={offline}
                  onPress={() => void query.fetchNextPage()}
                />
              ) : null}
            </View>
          )}
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
