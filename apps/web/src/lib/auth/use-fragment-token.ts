'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Reads the one-time token from the URL fragment (#token=…), which browsers never send
 * to a server, then removes it from the address bar and history.
 *
 * Returns undefined until read, null when absent. The ref guards against React's
 * development double-run of effects: the second run would find the fragment already
 * cleared and wrongly report the link as broken.
 */
export function useFragmentToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const read = useRef(false)

  useEffect(() => {
    if (read.current) return
    read.current = true
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token')
    setToken(value && value.length >= 20 ? value : null)
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  return token
}
