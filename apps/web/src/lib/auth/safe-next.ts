/**
 * A post-sign-in destination arrives in the URL, so it is attacker-influenced and only a
 * same-site path is accepted:
 *  - "//evil.example" and "/\evil.example" are read by browsers as a different host;
 *  - API paths are refused, so a crafted link cannot bounce a browser into a loop;
 *  - control characters are refused, since some can split a redirect header.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (value === '/api' || value.startsWith('/api/')) return fallback
  for (const character of value) {
    if (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) return fallback
  }
  return value
}
