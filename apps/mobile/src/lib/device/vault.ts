import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import type { Vault } from '../offline'
import { decodeUtf8, encodeUtf8 } from '../utf8'
import { keychain } from './keychain'

/**
 * Where the offline reads live on a phone: **encrypted, in the cache directory, with the key in
 * the keychain** (§16.1 — PHI at rest on a device).
 *
 * The first version kept them in SecureStore itself, which could never have worked: SecureStore
 * accepts keys of letters, digits, `.`, `-` and `_` — the cache keys were JSON — and warns past
 * 2 KB a value, which one month's appointments exceed. So:
 *
 * - **AES-256-GCM**, authenticated, with a purpose string as additional data. A file that has been
 *   tampered with, or belongs to some other use, fails to decrypt rather than decrypting to
 *   something plausible.
 * - **The cache directory**, which the OS excludes from backups and may clear when space is short.
 *   Both are right for a cache: a lost read is a refetch, and a backed-up one is PHI in the cloud.
 * - **The key in the keychain, this device only.** A backup or a copied file without the key is
 *   noise.
 * - **Destroyed key-first.** Sign-out deletes the key before the file, so even a file the OS kept a
 *   copy of, or a delete that failed, leaves nothing readable behind — crypto-shredding.
 */

const KEY_ITEM = 'clinic.vault.key'
const FILE_NAME = 'clinic-offline-reads.bin'
const PURPOSE = encodeUtf8('clinic.offline-reads.v1')

const vaultFile = () => new File(Paths.cache, FILE_NAME)

async function readKey(): Promise<AESEncryptionKey | null> {
  const stored = await keychain.getItem(KEY_ITEM)
  return stored ? AESEncryptionKey.import(stored, 'base64') : null
}

async function keyForWriting(): Promise<AESEncryptionKey> {
  const existing = await readKey()
  if (existing) return existing
  const fresh = await AESEncryptionKey.generate()
  await keychain.setItem(KEY_ITEM, await fresh.encoded('base64'))
  return fresh
}

export const vault: Vault = {
  async read() {
    const file = vaultFile()
    if (!file.exists) return null

    const key = await readKey()
    if (!key) {
      // A file with no key — the keychain was wiped, or the app reinstalled over a cache the OS
      // had not cleared yet. Unreadable by construction, so it goes.
      file.delete()
      return null
    }

    const sealed = AESSealedData.fromCombined(await file.bytes())
    const plain = await aesDecryptAsync(sealed, key, { additionalData: PURPOSE })
    return decodeUtf8(plain)
  },

  async write(text) {
    const key = await keyForWriting()
    const sealed = await aesEncryptAsync(encodeUtf8(text), key, { additionalData: PURPOSE })
    vaultFile().write(await sealed.combined())
  },

  async destroy() {
    await keychain.removeItem(KEY_ITEM)
    const file = vaultFile()
    if (file.exists) file.delete()
  },
}
