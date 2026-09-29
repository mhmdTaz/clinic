import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  guardNavigation,
  hasUnsavedWork,
  inAppDestination,
  installNavigationGuard,
} from '@/lib/navigation/navigation-guard'

const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
}
const here = {
  href: 'https://clinic.test/doctor/encounters/e1',
  origin: 'https://clinic.test',
}
const link = (href: string, extra: Partial<{ target: string; download: boolean }> = {}) => ({
  href,
  target: '',
  download: false,
  ...extra,
})

describe('which clicks leave the page (audit F02)', () => {
  it('holds an ordinary link to another page of the app', () => {
    expect(inAppDestination(plain, link('/doctor/patients/p1'), here)).toBe('/doctor/patients/p1')
    expect(inAppDestination(plain, link('https://clinic.test/doctor?date=2026-10-01'), here)).toBe(
      '/doctor?date=2026-10-01',
    )
  })

  it('lets through what keeps this page: new tabs, downloads, in-page jumps', () => {
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      expect(inAppDestination({ ...plain, [modifier]: true }, link('/doctor'), here)).toBeNull()
    }
    expect(inAppDestination({ ...plain, button: 1 }, link('/doctor'), here)).toBeNull()
    expect(inAppDestination(plain, link('/doctor', { target: '_blank' }), here)).toBeNull()
    expect(inAppDestination(plain, link('/files/x.pdf', { download: true }), here)).toBeNull()
    expect(inAppDestination(plain, link('#main'), here)).toBeNull()
    expect(inAppDestination(plain, link(here.href), here)).toBeNull()
  })

  it('leaves other sites to the browser’s own unload warning', () => {
    expect(inAppDestination(plain, link('https://example.org/'), here)).toBeNull()
    expect(inAppDestination(plain, link('mailto:clinic@example.org'), here)).toBeNull()
  })

  it('ignores a click something else has already handled', () => {
    expect(inAppDestination({ ...plain, defaultPrevented: true }, link('/doctor'), here)).toBeNull()
  })

  it('treats the same page with a different query as leaving it', () => {
    expect(inAppDestination(plain, link('/doctor/encounters/e1?tab=files'), here)).toBe(
      '/doctor/encounters/e1?tab=files',
    )
  })
})

describe('programmatic navigation asks the installed guard', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => uninstall?.())

  it('goes straight through with nothing installed', () => {
    const go = vi.fn()
    guardNavigation(go)
    expect(go).toHaveBeenCalledOnce()
    expect(hasUnsavedWork()).toBe(false)
  })

  it('holds navigation while the page is blocking and hands over the way to continue', () => {
    let blocking = true
    const held: Array<() => void> = []
    uninstall = installNavigationGuard({
      isBlocking: () => blocking,
      onBlocked: (go) => held.push(go),
    })
    const go = vi.fn()

    guardNavigation(go)
    expect(go).not.toHaveBeenCalled()
    expect(hasUnsavedWork()).toBe(true)
    held[0]?.()
    expect(go).toHaveBeenCalledOnce()

    blocking = false
    guardNavigation(go)
    expect(go).toHaveBeenCalledTimes(2)
    expect(held).toHaveLength(1)
  })

  it('uninstalls only itself', () => {
    const first = installNavigationGuard({ isBlocking: () => true, onBlocked: () => {} })
    uninstall = installNavigationGuard({ isBlocking: () => true, onBlocked: () => {} })
    first()
    expect(hasUnsavedWork()).toBe(true)
  })
})
