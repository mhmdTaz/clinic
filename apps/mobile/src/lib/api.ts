import Constants from 'expo-constants'
import {
  authResource,
  createClient,
  doctorPortal,
  patientPortal,
  secureTokenStore,
  type ApiClient,
  type StoredTokens,
} from '@clinic/api-client'
import { keychain } from './device/keychain'

/**
 * The app's one API client (§9.1).
 *
 * It is the **same client the web uses**, with a different token store: the browser sends cookies
 * it cannot read, this sends a Bearer header from the device keychain. Every hook, every cache
 * key, every response type above this file is shared — which is what Phase 9 exists to
 * demonstrate rather than merely assert.
 */

/*
 * The keychain is `device/keychain.ts`, behind the interface `@clinic/api-client` asks for. The
 * adapter exists so the client package never imports an Expo module: it is shared by a Next.js
 * server, a browser bundle and this app, and any one of those pulling in another's native
 * dependency is a build failure somewhere else entirely.
 */

/**
 * Where the clinic is.
 *
 * From app config rather than hard-coded, because a build for a different clinic is a different
 * `extra.apiUrl` and not a different source tree (ADR-0005: one clinic per installation).
 */
export function apiBaseUrl(): string {
  const configured = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl
  if (!configured) {
    throw new Error(
      'No apiUrl in app config. Set expo.extra.apiUrl (see app.config.ts) before building.',
    )
  }
  return configured
}

let listener: ((tokens: StoredTokens | null) => void) | null = null

/**
 * Told when the session changes — refreshed, replaced, or ended.
 *
 * One listener rather than a subscription list: exactly one thing cares, and it is the root
 * provider. A list would invite a screen to subscribe and then leak when it unmounts.
 */
export function onSessionChanged(next: ((tokens: StoredTokens | null) => void) | null): void {
  listener = next
}

export const tokenStore = secureTokenStore(keychain)

export const client: ApiClient = createClient({
  baseUrl: apiBaseUrl(),
  tokens: tokenStore,
  onSessionChanged: (tokens) => listener?.(tokens),
  // Kept on. An app from a store can be months older than the server it is talking to, and a
  // field that quietly stopped arriving is a crash three components deep rather than one clear
  // error naming the endpoint.
  validateResponses: true,
})

export const auth = authResource(client)
export const portal = patientPortal(client)
export const doctor = doctorPortal(client)
