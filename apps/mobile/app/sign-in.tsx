import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native'
import type { ApiError } from '@clinic/api-client'
import { Button, Muted, Screen, Title, palette } from '~/components/ui'
import { useSession } from '~/lib/session'

/**
 * Signing in (§10).
 *
 * The same endpoint the browser uses, asking for `tokenDelivery: 'body'` so the pair goes into
 * the keychain instead of into cookies. One verification path, one session shape.
 */
export default function SignInScreen() {
  const { signIn, error } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    try {
      await signIn(email.trim(), password)
    } catch {
      // Shown from `error` below; the throw is how the provider reports it.
    } finally {
      setPending(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.fill} keyboardShouldPersistTaps="handled">
        <Screen>
          <Title>Sign in</Title>
          <Muted>Use the email address the clinic has on file.</Muted>

          <Text style={styles.label} nativeID="email-label">
            Email
          </Text>
          <TextInput
            accessibilityLabelledBy="email-label"
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            textContentType="username"
            style={styles.input}
          />

          <Text style={styles.label} nativeID="password-label">
            Password
          </Text>
          <TextInput
            accessibilityLabelledBy="password-label"
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={() => void submit()}
            style={styles.input}
          />

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {messageFor(error)}
            </Text>
          ) : null}

          <Button
            label="Sign in"
            onPress={() => void submit()}
            pending={pending}
            disabled={email.trim() === '' || password === ''}
          />
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/**
 * What to say about a failure.
 *
 * Wrong credentials get one deliberately unhelpful sentence: saying whether the email exists
 * turns a sign-in form into an account-enumeration oracle (§16.1). A rate limit and an
 * unreachable server, by contrast, are worth being specific about — they tell somebody whether
 * to wait or to find better signal.
 */
function messageFor(error: ApiError): string {
  if (error.code === 'RATE_LIMITED') {
    const wait = error.retryAfterSeconds
    return wait
      ? `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`
      : 'Too many attempts. Try again shortly.'
  }
  if (error.code === 'NETWORK_UNREACHABLE') {
    return 'The clinic could not be reached. Check your connection and try again.'
  }
  if (error.status === 401) return 'That email and password do not match.'
  return error.message
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  label: { fontSize: 13, fontWeight: '500', color: palette.muted, marginTop: 4 },
  input: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    color: palette.text,
  },
  error: { color: palette.danger, fontSize: 14 },
})
