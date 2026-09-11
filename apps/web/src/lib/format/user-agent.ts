export interface DeviceDescription {
  browser: string | null
  os: string | null
}

/**
 * Enough to recognise "that's my phone" on the sessions page — not a fingerprint.
 * Order matters: Edge and Opera also claim Chrome, Chrome claims Safari, iPadOS claims
 * Mac OS X and Android claims Linux, so the more specific names are tested first.
 */
export function describeUserAgent(userAgent: string | null): DeviceDescription | null {
  if (!userAgent) return null

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null

  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null

  return browser || os ? { browser, os } : null
}
