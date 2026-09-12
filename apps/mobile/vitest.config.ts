import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Unit tests for the app's **pure logic** — formatting, the offline rules, notification routing.
 *
 * Not the screens: rendering React Native needs a native runtime or a heavy shim, and a test of
 * `<View>` proves less than a test of "which appointment is next". What is tested here is what
 * would be silently wrong.
 */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: {
    alias: {
      '~': resolve(import.meta.dirname, 'src'),
      // The tested modules import nothing from React Native; the alias keeps a stray import from
      // pulling the whole runtime into a unit test by accident.
      'react-native': resolve(import.meta.dirname, 'test/react-native-stub.ts'),
    },
  },
})
