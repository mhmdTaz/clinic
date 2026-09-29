import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIENT_NAMESPACES, pickMessages } from '@/lib/i18n/client-messages'
import messages from '../../../messages/en.json'

const SRC = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/**
 * The namespaces a module asks for. `useTranslations('a.b')` is `a.b`; a root translator —
 * `useTranslations()` — is followed through its literal keys to their first segment.
 */
function namespacesOf(source: string): string[] {
  const found = [...source.matchAll(/useTranslations\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] ?? '')
  if (/useTranslations\(\s*\)/.test(source)) {
    for (const match of source.matchAll(/\bt(?:\.rich|\.has)?\(\s*[`']([a-zA-Z]+)/g)) {
      found.push(match[1] ?? '')
    }
  }
  return found
}

const covered = (namespace: string) =>
  CLIENT_NAMESPACES.some((entry) => namespace === entry || namespace.startsWith(`${entry}.`))

describe('the messages sent to the browser', () => {
  const modules = sourceFiles(SRC).map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  // A server component with an async body uses getTranslations; a module calling the hook may
  // run on the client, so every one is checked — a server-only use is merely over-covered.
  const users = modules.filter(({ source }) => /useTranslations\(/.test(source))

  it('cover every namespace a component can look up in the browser', () => {
    const missing = users.flatMap(({ path, source }) =>
      namespacesOf(source)
        .filter((namespace) => !covered(namespace))
        .map((namespace) => `${path.slice(SRC.length)}: ${namespace}`),
    )
    expect(missing).toEqual([])
  })

  it('never pass a namespace to a translator by variable, which this check could not follow', () => {
    const dynamic = users.filter(({ source }) => /useTranslations\(\s*[^'\s)]/.test(source))
    expect(dynamic.map(({ path }) => path.slice(SRC.length))).toEqual([])
  })

  it('name only namespaces that exist', () => {
    const picked = pickMessages(messages, CLIENT_NAMESPACES)
    for (const namespace of CLIENT_NAMESPACES) {
      const value = namespace.split('.').reduce<unknown>((node, key) => {
        return node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined
      }, picked)
      expect(value, namespace).toBeDefined()
    }
  })

  it('are a good deal smaller than the whole catalogue', () => {
    const whole = JSON.stringify(messages).length
    const sent = JSON.stringify(pickMessages(messages, CLIENT_NAMESPACES)).length
    expect(sent).toBeLessThan(whole * 0.75)
  })
})

describe('pickMessages', () => {
  it('copies the named subtrees and nothing else', () => {
    const catalogue = { a: { b: { c: '1' }, d: '2' }, e: '3', f: { g: '4' } }
    expect(pickMessages(catalogue, ['a.b', 'e', 'missing.path'])).toEqual({
      a: { b: { c: '1' } },
      e: '3',
    })
  })
})
