import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

/**
 * The handful of primitives every screen needs.
 *
 * Deliberately small and local rather than a shared design system: `@clinic/ui` is Tailwind and
 * the DOM, and React Native has neither. Sharing *components* across the two would mean an
 * abstraction that fits neither; sharing the **contracts, the client and the cache keys** is
 * where the leverage actually is (§9.4).
 */

export const palette = {
  background: '#f6f7f9',
  card: '#ffffff',
  border: '#e3e6eb',
  text: '#1d2433',
  muted: '#6b7385',
  primary: '#2f5bd3',
  danger: '#c0392b',
  success: '#1e8e5a',
} as const

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  )
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  pending = false,
  disabled = false,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'danger' | 'plain'
  pending?: boolean
  disabled?: boolean
}) {
  const inactive = disabled || pending
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: pending }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        tone === 'danger' && styles.buttonDanger,
        tone === 'plain' && styles.buttonPlain,
        inactive && styles.buttonInactive,
        pressed && styles.buttonPressed,
      ]}
    >
      {pending ? <ActivityIndicator color="#fff" /> : null}
      <Text style={[styles.buttonLabel, tone === 'plain' && styles.buttonLabelPlain]}>{label}</Text>
    </Pressable>
  )
}

/**
 * The three states every list has, in one place (§14.2).
 *
 * `error` before `loading` on purpose: a refetch that fails while stale data is on screen should
 * say so rather than silently showing yesterday's answer as though it were today's.
 */
export function ListState({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  children,
}: {
  loading: boolean
  error: Error | null
  empty: boolean
  emptyText: string
  onRetry?: () => void
  children: ReactNode
}) {
  if (error) {
    return (
      <Card>
        <Text style={styles.error}>{error.message}</Text>
        {onRetry ? <Button label="Try again" tone="plain" onPress={onRetry} /> : null}
      </Card>
    )
  }
  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </View>
    )
  }
  if (empty) {
    return (
      <Card>
        <Muted>{emptyText}</Muted>
      </Card>
    )
  }
  return <>{children}</>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, padding: 16, gap: 12 },
  card: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  title: { fontSize: 24, fontWeight: '600', color: palette.text },
  muted: { fontSize: 14, color: palette.muted },
  error: { fontSize: 14, color: palette.danger },
  centred: { paddingVertical: 32, alignItems: 'center' },
  button: {
    backgroundColor: palette.primary,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    // 44pt is the smallest reliably tappable target; anything less is a button people miss.
    minHeight: 44,
  },
  buttonDanger: { backgroundColor: palette.danger },
  buttonPlain: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.border },
  buttonInactive: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { color: '#fff', fontWeight: '600', fontSize: 16 },
  buttonLabelPlain: { color: palette.text },
})
