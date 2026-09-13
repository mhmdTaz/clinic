import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { messageFor } from '~/lib/errors'
import { ageLabel } from '~/lib/format'

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
  primarySoft: '#e8eefc',
  danger: '#c0392b',
  dangerSoft: '#fbeceb',
  warning: '#8a5a00',
  warningSoft: '#fdf3e1',
  success: '#1e8e5a',
  successSoft: '#e6f4ed',
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

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  )
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  pending = false,
  disabled = false,
  compact = false,
  accessibilityHint,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'danger' | 'plain'
  pending?: boolean
  disabled?: boolean
  /** Less padding, one line: for a pair of buttons sharing a row with something else. */
  compact?: boolean
  accessibilityHint?: string
}) {
  const inactive = disabled || pending
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: pending }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        tone === 'danger' && styles.buttonDanger,
        tone === 'plain' && styles.buttonPlain,
        compact && styles.buttonCompact,
        inactive && styles.buttonInactive,
        pressed && styles.buttonPressed,
      ]}
    >
      {pending ? <ActivityIndicator color={tone === 'plain' ? palette.text : '#fff'} /> : null}
      <Text
        numberOfLines={compact ? 1 : undefined}
        style={[
          styles.buttonLabel,
          tone === 'plain' && styles.buttonLabelPlain,
          compact && styles.buttonLabelCompact,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** A tappable row: a list entry that opens something. */
export function Row({
  title,
  subtitle,
  detail,
  onPress,
  accessibilityLabel,
}: {
  title: string
  subtitle?: string | null
  detail?: string | null
  onPress: () => void
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? [title, subtitle, detail].filter(Boolean).join(', ')
      }
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.row, pressed && styles.buttonPressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      <Text style={styles.chevron} importantForAccessibility="no">
        ›
      </Text>
    </Pressable>
  )
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}) {
  const colours = {
    neutral: { backgroundColor: palette.background, color: palette.muted },
    success: { backgroundColor: palette.successSoft, color: palette.success },
    warning: { backgroundColor: palette.warningSoft, color: palette.warning },
    danger: { backgroundColor: palette.dangerSoft, color: palette.danger },
    info: { backgroundColor: palette.primarySoft, color: palette.primary },
  }[tone]
  return (
    <View style={[styles.badge, { backgroundColor: colours.backgroundColor }]}>
      <Text style={[styles.badgeLabel, { color: colours.color }]}>{label}</Text>
    </View>
  )
}

/** A message in the flow of the screen: something went wrong, or is worth knowing. */
export function Notice({
  tone,
  children,
  action,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success'
  children: ReactNode
  action?: { label: string; onPress: () => void }
}) {
  const colours = {
    info: [palette.primarySoft, palette.primary],
    warning: [palette.warningSoft, palette.warning],
    danger: [palette.dangerSoft, palette.danger],
    success: [palette.successSoft, palette.success],
  }[tone]
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: colours[0] }]}
    >
      <Text style={[styles.noticeText, { color: colours[1] }]}>{children}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8}>
          <Text style={[styles.noticeAction, { color: colours[1] }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** A labelled text input. The label is a real label, so a screen reader says what it is for. */
export function Field({
  label,
  hint,
  error,
  nativeID,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; nativeID: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label} nativeID={`${nativeID}-label`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabelledBy={`${nativeID}-label`}
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        {...input}
        style={[styles.input, input.multiline && styles.inputMultiline, error && styles.inputError]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Muted>{hint}</Muted> : null}
    </View>
  )
}

/** The subset of a TanStack query the screens render from. */
interface QueryView<T> {
  data: T | undefined
  error: Error | null
  isPending: boolean
  dataUpdatedAt: number
  isRefetching: boolean
  refetch: () => unknown
}

/**
 * The states every read has, in one place (§14.2) — including the one the first version got wrong.
 *
 * **A failed refresh with data on screen shows the data, and says how old it is.** The first
 * `ListState` put the error first, so with no signal a list the phone had loaded a minute ago was
 * replaced by an error card. That is safe and useless: the offline cache exists precisely so a
 * patient outside the clinic can still read their appointment time.
 *
 * With no data at all, the error is the screen — there is nothing true to show instead.
 */
export function QueryState<T>({
  query,
  isEmpty,
  emptyText,
  children,
}: {
  query: QueryView<T>
  isEmpty?: (data: T) => boolean
  emptyText: string
  children: (data: T) => ReactNode
}) {
  const retry = () => void query.refetch()

  if (query.data === undefined) {
    if (query.error) {
      return (
        <Notice tone="danger" action={{ label: 'Try again', onPress: retry }}>
          {messageFor(query.error)}
        </Notice>
      )
    }
    return (
      <View style={styles.centred}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </View>
    )
  }

  return (
    <>
      {query.error && !query.isRefetching ? (
        <Notice tone="warning" action={{ label: 'Try again', onPress: retry }}>
          {`Could not refresh. Showing what was loaded ${ageLabel(query.dataUpdatedAt)}.`}
        </Notice>
      ) : null}
      {isEmpty?.(query.data) ? (
        <Card>
          <Muted>{emptyText}</Muted>
        </Card>
      ) : (
        children(query.data)
      )}
    </>
  )
}

/**
 * Asks before doing something that cannot be taken back.
 *
 * `Alert.alert` on a phone. React Native Web implements `Alert` as a no-op, so in the development
 * preview a confirmation would silently never appear — and neither would the action behind it.
 */
export function confirm(options: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${options.title}\n\n${options.message}`)) options.onConfirm()
    return
  }
  Alert.alert(options.title, options.message, [
    { text: options.cancelLabel ?? 'Cancel', style: 'cancel' },
    {
      text: options.confirmLabel,
      style: options.destructive ? 'destructive' : 'default',
      onPress: options.onConfirm,
    },
  ])
}

/** Tells somebody something that needs no answer. The same web caveat as `confirm`. */
export function inform(title: string, message: string): void {
  if (Platform.OS === 'web') {
    globalThis.alert?.(`${title}\n\n${message}`)
    return
  }
  Alert.alert(title, message)
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
  heading: { fontSize: 17, fontWeight: '600', color: palette.text, marginTop: 8 },
  muted: { fontSize: 14, color: palette.muted },
  body: { fontSize: 15, color: palette.text, lineHeight: 21 },
  centred: { paddingVertical: 32, alignItems: 'center' },
  button: {
    backgroundColor: palette.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    // 44pt is the smallest reliably tappable target; anything less is a button people miss.
    minHeight: 44,
  },
  buttonCompact: { paddingHorizontal: 10, paddingVertical: 10 },
  buttonLabelCompact: { fontSize: 15 },
  buttonDanger: { backgroundColor: palette.danger },
  buttonPlain: { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
  buttonInactive: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { color: '#fff', fontWeight: '600', fontSize: 16 },
  buttonLabelPlain: { color: palette.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: palette.text },
  rowDetail: { fontSize: 14, color: palette.muted },
  chevron: { fontSize: 22, color: palette.muted },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeLabel: { fontSize: 12, fontWeight: '600' },
  notice: { borderRadius: 10, padding: 12, gap: 6 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  noticeAction: { fontSize: 14, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: palette.muted },
  input: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    fontSize: 16,
    color: palette.text,
  },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  inputError: { borderColor: palette.danger },
  fieldError: { fontSize: 13, color: palette.danger },
})
