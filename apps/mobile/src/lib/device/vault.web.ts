import type { Vault } from '../offline'

/**
 * The offline vault in the **web development preview only**: memory, and nothing else.
 *
 * The preview is for exercising screens against a local API. Offline reads are a device feature,
 * and a browser build that wrote patient data to `localStorage` in plain text would be the exact
 * thing `vault.ts` exists to prevent.
 */
let held: string | null = null

export const vault: Vault = {
  read: async () => held,
  write: async (text) => {
    held = text
  },
  destroy: async () => {
    held = null
  },
}
