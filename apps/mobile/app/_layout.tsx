import { useEffect, useMemo, useRef } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { ApiError } from '@clinic/api-client'
import { SessionProvider, useSession } from '~/lib/session'
import { createOfflineCache, type CacheStorage } from '~/lib/offline'
import { destinationOf, foregroundBehaviour } from '~/lib/push'

/**
 * The root of the app: data, session, and the gate between them.
 *
 * `Slot` rather than `Stack` at this level because the only routing decision here is *whether*
 * somebody is signed in. The screens below own their own navigation.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => foregroundBehaviour,
})

/**
 * The offline cache's storage.
 *
 * SecureStore rather than AsyncStorage: what is cached is an appointment time and a notification
 * body — PHI in miniature — and a phone is lost far more often than a laptop. It caps values at
 * 2 KB per key, which is why the cached set is deliberately small (see offline.ts).
 */
const cacheStorage: CacheStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
  // SecureStore cannot enumerate. The keys it holds are tracked in one index entry, which is the
  // only way a sign-out can clear everything belonging to a person.
  keys: async () => {
    const raw = await SecureStore.getItemAsync('clinic.cache.index')
    try {
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  },
}

const offlineCache = createOfflineCache(cacheStorage)

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A phone changes network constantly. Refetching on every reconnect would hammer the API
        // from a pocket; a minute of staleness is invisible to a person and cheap to the server.
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        retry: (failureCount, error) => {
          // Only what is worth retrying. A 403 fails identically however many times it is sent,
          // and each attempt costs a second on a slow connection.
          if (error instanceof ApiError && !error.isTransient) return false
          return failureCount < 2
        },
      },
      mutations: {
        // Never automatically. A retried booking without an idempotency key is a second
        // appointment; the mutations that are safe to retry carry one and say so.
        retry: false,
      },
    },
  })
}

/**
 * Sends somebody to the sign-in screen, or away from it, once the session is known.
 *
 * It waits for `loading` deliberately: redirecting before the keychain has been read would flash
 * the sign-in screen at somebody who is already signed in, on every single launch.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { state } = useSession()
  const segments = useSegments()
  const router = useRouter()

  const onSignIn = segments[0] === 'sign-in'

  useEffect(() => {
    if (state.status === 'loading') return
    if (state.status === 'signedOut' && !onSignIn) router.replace('/sign-in')
    if (state.status === 'signedIn' && onSignIn) router.replace('/')
  }, [state.status, onSignIn, router])

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Opening the app" />
      </View>
    )
  }

  return <>{children}</>
}

/** Taps on a notification, turned into navigation. */
function NotificationRouting() {
  const router = useRouter()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    // A notification that launched the app from cold. Read once — the reference stops a re-render
    // from navigating a second time and stealing a screen the person has since opened.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response || handled.current === response.notification.request.identifier) return
      handled.current = response.notification.request.identifier
      router.push(destinationOf(response.notification.request.content.data))
    })

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      router.push(destinationOf(response.notification.request.content.data))
    })
    return () => subscription.remove()
  }, [router])

  return null
}

export default function RootLayout() {
  const queryClient = useMemo(makeQueryClient, [])

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider
          onSignedOut={async () => {
            await offlineCache.clear()
            // The in-memory cache too: the next person to sign in on a shared phone must not be
            // shown the previous one's appointments while their own load.
            queryClient.clear()
          }}
        >
          <StatusBar style="auto" />
          <NotificationRouting />
          <AuthGate>
            <Slot />
          </AuthGate>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
