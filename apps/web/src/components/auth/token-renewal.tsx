'use client'

import { useEffect } from 'react'
import { apiFetch } from '@/lib/api/client'

/**
 * Stores a replacement access token after the grants behind the current one changed. The page
 * around it was already authorised against the current grants; any API route answers a stale
 * token with its replacement cookie, and /api/v1/me is the cheapest. It does not rotate the
 * refresh token, so two tabs renewing at once cannot sign each other out.
 *
 * The portal shell renders it, so it runs on a full page load or a refresh. A navigation inside a
 * portal re-renders only the page, which stays correctly authorised until then.
 */
export function TokenRenewal() {
  useEffect(() => {
    // A failure costs only a repeat: the next page is authorised against current grants too.
    void apiFetch('/api/v1/me').catch(() => undefined)
  }, [])
  return null
}
