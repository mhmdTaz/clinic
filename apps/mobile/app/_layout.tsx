import { useEffect, useMemo, useRef } from 'react'
import { Stack, useRouter, useSegments, type Href } from 'expo-router'
import { ActivityIndicator, AppState, Platform, ScrollView, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { ApiError } from '@clinic/api-client'
import { Body, Button, Muted, Screen, Title, palette } from '~/components/ui'
import { portal } from '~/lib/api'
import { vault } from '~/lib/device/vault'
import { createOfflineStore } from '~/lib/offline'
import { createOfflineSession } from '~/lib/offline-session'
import {
  deviceLabel,
  forgetOptIn,
  foregroundBehaviour,
  optedInToken,
  renewPushRegistration,
} from '~/lib/push'
import { destinationOf, landingPortal, portalOfPath } from '~/lib/routes'
import { SessionProvider, useSession } from '~/lib/session'

/**
 * The root of the app: data, session, and the gate between them.
 *
 * A `Stack` at this level, so a screen shared by both portals — a support thread, opened from a
 * patient's messages or from a doctor's notification — is pushed over whichever portal the person
 * is in and has a way back.
 */

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({ handleNotification: async () => foregroundBehaviour })
}

/**
 * React Query's idea of "focused", from the app's foreground state.
 *
 * A browser has window focus; a phone has the app coming back from the background, which is
 * exactly when a stale list should refresh. Without this, React Query in React Native never
 * considers the app refocused at all.
 */
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) =>
    handleFocus(state === 'active'),
  )
  return () => subscription.remove()
})

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A phone changes network constantly. A minute of staleness is invisible to a person and
        // cheap to the server; refetching on every reconnect would hammer the API from a pocket.
        staleTime: 60_000,
        // Kept for a day, so what is restored from the vault on launch is not collected before a
        // screen asks for it. What may be *shown* is still capped by MAX_AGE_MS.
        gcTime: 24 * 60 * 60_000,
        retry: (failureCount, error) => {
          // Only what is worth retrying. A 403 fails identically however many times it is sent,
          // and each attempt costs a second on a slow connection.
          if (error instanceof ApiError && !error.isTransient) return false
          return failureCount < 2
        },
      },
      mutations: {
        // Never automatically. The server does not yet honour idempotency keys on bookings
        // (ARCHITECTURE §17), so a retried POST is a second attempt, not the same one.
        retry: false,
      },
    },
  })
}

/*
 * The session's collaborators, at module level so their identity never changes between renders.
 */
const renewPush = (): void => {
  void renewPushRegistration((input) => portal.registerDevice(input)).catch(() => undefined)
}

/**
 * What is shown before there is a session to route: launch, an unreachable server, and an account
 * the app has no screens for.
 *
 * **Who may open which screen is the router's job, not an effect's** — see the `Stack.Protected`
 * groups in `Routes`. The first version redirected from an effect here, which runs *after* a
 * render: on sign-out the screen still mounted re-rendered once with nobody signed in, called
 * `useUser`, and threw. That was every sign-out, and every session that expired with the app open.
 * Running the app in a browser found it within a minute; typechecking and unit tests never could.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { state, reconnect, signOut } = useSession()
  const signedInUser = state.status === 'signedIn' ? state.user : null
  const landing = signedInUser ? landingPortal(signedInUser) : null

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Opening the app" />
      </View>
    )
  }

  if (state.status === 'unreachable') {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: palette.background }}>
        <Screen>
          <Title>
            {state.reason === 'outdated' ? 'This app needs updating' : 'Cannot reach the clinic'}
          </Title>
          <Body>
            {state.reason === 'outdated'
              ? 'The clinic has moved on since this version of the app. Update it from the app store to carry on.'
              : 'You are still signed in. Nothing has been kept on this phone to show you yet, so the app needs a connection to open. Check your signal and try again.'}
          </Body>
          <Button label="Try again" onPress={() => void reconnect()} />
          <Button label="Sign out" tone="plain" onPress={() => void signOut()} />
        </Screen>
      </ScrollView>
    )
  }

  if (signedInUser && landing === null) {
    return (
      <Screen>
        <Title>This app is for patients and doctors</Title>
        <Body>
          Your account works at a desk rather than on a phone. Sign in to the clinic’s website to
          carry on.
        </Body>
        <Muted>{signedInUser.email}</Muted>
        <Button label="Sign out" tone="plain" onPress={() => void signOut()} />
      </Screen>
    )
  }

  return <>{children}</>
}

/** Taps on a notification, turned into navigation. */
function NotificationRouting() {
  const router = useRouter()
  const segments = useSegments()
  const { state } = useSession()
  const handled = useRef<string | null>(null)

  const user = state.status === 'signedIn' ? state.user : null
  const context = useMemo(
    () =>
      user
        ? { portals: user.portals, current: portalOfPath(segments) ?? landingPortal(user) }
        : null,
    [user, segments],
  )
  const latest = useRef(context)
  latest.current = context

  useEffect(() => {
    if (Platform.OS === 'web' || !user) return

    const open = (response: Notifications.NotificationResponse) => {
      const context = latest.current
      if (!context || handled.current === response.notification.request.identifier) return
      handled.current = response.notification.request.identifier
      router.push(destinationOf(response.notification.request.content.data, context) as Href)
    }

    // A notification that launched the app from cold, read once. The identifier stops a later
    // render from navigating again and stealing a screen the person has since opened.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response)
    })
    const subscription = Notifications.addNotificationResponseReceivedListener(open)
    return () => subscription.remove()
  }, [router, user])

  return null
}

/**
 * The routes, each behind the guard that decides who may be on it.
 *
 * When a guard turns false — signing out, a session expiring, a role losing a portal — the router
 * removes those screens and moves to one that is allowed. Signed out, the only screen left is
 * sign-in; signed in, sign-in is gone and `/` sends the person to their portal.
 */
function Routes() {
  const { state } = useSession()
  const user = state.status === 'signedIn' ? state.user : null
  const holds = (portal: 'patient' | 'doctor') => user?.portals.includes(portal) ?? false

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.card },
        headerTitleStyle: { color: palette.text },
        headerTintColor: palette.primary,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={user !== null}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* A portal this person does not hold — a bookmark, or a notification meant for another
            account on a shared phone — is not a route at all for them. */}
        <Stack.Protected guard={holds('patient')}>
          <Stack.Screen name="patient" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={holds('doctor')}>
          <Stack.Screen name="doctor" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="support/new" options={{ title: 'Ask the clinic' }} />
        <Stack.Screen name="support/[ticketId]" options={{ title: 'Conversation' }} />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  const queryClient = useMemo(makeQueryClient, [])
  const offline = useMemo(
    () => createOfflineSession(queryClient, createOfflineStore(vault)),
    [queryClient],
  )

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider
          offline={offline}
          deviceName={deviceLabel()}
          onConfirmed={renewPush}
          pushTokenForSignOut={optedInToken}
          onSignedOut={forgetOptIn}
        >
          <StatusBar style="auto" />
          <AuthGate>
            <NotificationRouting />
            <Routes />
          </AuthGate>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
