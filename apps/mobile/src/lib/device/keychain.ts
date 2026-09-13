import * as SecureStore from 'expo-secure-store'
import type { SecureStorage } from '@clinic/api-client'

/**
 * The device keychain: iOS Keychain, Android Keystore-backed storage.
 *
 * **After first unlock, this device only.** A background refresh must work while the phone sits
 * locked in a pocket, and nothing here may leave the device — not in an iCloud or Google backup,
 * not to a new phone restored from one. The offline vault's key lives here for exactly that
 * reason: a backup that carries the encrypted file cannot carry the key to it.
 */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

export const keychain: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  removeItem: (key) => SecureStore.deleteItemAsync(key, options),
}
