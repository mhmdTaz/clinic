import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native'
import { Button, Muted, Screen, Title, palette } from '~/components/ui'
import { signInMessageFor } from '~/lib/errors'
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
              {signInMessageFor(error)}
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
