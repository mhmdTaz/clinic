import type { SecureStorage } from '@clinic/api-client'

/**
 * The keychain, in the **web development preview only**.
 *
 * `expo-secure-store` has no web implementation, and the preview exists so the screens can be
 * exercised in a browser against a local API without a simulator. Tab-scoped session storage:
 * nothing survives closing the tab. This file is never part of a device build — Metro picks
 * `keychain.ts` for iOS and Android.
 */
const memory = new Map<string, string>()

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export const keychain: SecureStorage = {
  getItem: async (key) => storage()?.getItem(key) ?? memory.get(key) ?? null,
  setItem: async (key, value) => {
    const store = storage()
    if (store) store.setItem(key, value)
    else memory.set(key, value)
  },
  removeItem: async (key) => {
    storage()?.removeItem(key)
    memory.delete(key)
  },
}
