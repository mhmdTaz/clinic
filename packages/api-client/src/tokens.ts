import type { SessionTokens } from '@clinic/contracts'

/**
 * Where the tokens live, which is the one thing web and mobile genuinely disagree about
 * (section 9.4).
 *
 * The browser never sees a token: the server sets httpOnly cookies and the fetch carries them
 * automatically, so the web's store holds nothing and says so. A device has no cookie jar worth
 * relying on, so the app keeps the pair in the platform's secure storage and sends the access
 * token as a Bearer header.
 *
 * Both are the same client with a different store, rather than two clients — which is what makes
 * "the same hooks, same cache keys" (§9.4) true rather than aspirational.
 */
export interface TokenStore {
  /**
   * How this store authenticates. `cookie` means "send credentials and add no header"; `bearer`
   * means "read the access token and add one".
   */
  readonly transport: 'cookie' | 'bearer'
  read(): Promise<StoredTokens | null>
  write(tokens: StoredTokens): Promise<void>
  clear(): Promise<void>
}

export interface StoredTokens {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
}

export const tokensFromSession = (tokens: SessionTokens): StoredTokens => ({
  accessToken: tokens.accessToken,
  accessTokenExpiresAt: tokens.accessTokenExpiresAt,
  refreshToken: tokens.refreshToken,
  refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
})

/**
 * The browser's store: there is nothing to keep.
 *
 * Returning `null` is correct rather than a stub — the tokens exist, in cookies the JavaScript
 * cannot read, which is the point. The client sees "no bearer token" and sends credentials
 * instead.
 */
export const cookieTokenStore = (): TokenStore => ({
  transport: 'cookie',
  read: async () => null,
  write: async () => undefined,
  clear: async () => undefined,
})

/**
 * A store held in memory only.
 *
 * For tests and for short-lived scripts. A mobile app must **not** use this: losing the session
 * every time the process is killed would sign somebody out each time they switch apps.
 */
export function memoryTokenStore(initial: StoredTokens | null = null): TokenStore {
  let held = initial
  return {
    transport: 'bearer',
    read: async () => held,
    write: async (tokens) => {
      held = tokens
    },
    clear: async () => {
      held = null
    },
  }
}

/**
 * A store backed by anything that can hold a string — `expo-secure-store`, the keychain, a test
 * double.
 *
 * Kept generic so this package never imports a platform module: `@clinic/api-client` is shared by
 * a Next.js server, a browser and a phone, and any one of those importing another's native
 * dependency is a build failure somewhere else.
 */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export function secureTokenStore(storage: SecureStorage, key = 'clinic.session'): TokenStore {
  return {
    transport: 'bearer',
    async read() {
      const raw = await storage.getItem(key)
      if (!raw) return null
      try {
        return JSON.parse(raw) as StoredTokens
      } catch {
        // Corrupt storage is a signed-out user, not a crash on launch.
        await storage.removeItem(key)
        return null
      }
    },
    async write(tokens) {
      await storage.setItem(key, JSON.stringify(tokens))
    },
    async clear() {
      await storage.removeItem(key)
    },
  }
}

/**
 * Whether the access token is close enough to expiry to refresh before using it.
 *
 * Refreshing *before* a request rather than reacting to a 401 matters on a phone: the round trip
 * that fails costs a second on a slow connection, and doing it pre-emptively while the app is
 * already waiting for the network costs nothing extra. The skew covers a device clock that is a
 * little fast — an access token has a fifteen-minute life, so a minute of margin is cheap.
 */
export function isNearlyExpired(tokens: StoredTokens, now: Date, skewMs = 60_000): boolean {
  const expiresAt = Date.parse(tokens.accessTokenExpiresAt)
  if (Number.isNaN(expiresAt)) return true
  return expiresAt - now.getTime() <= skewMs
}
