import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { destinationOf, homeOf, landingPortal, resolveHref, type RouteContext } from '../routes'

const patient: RouteContext = { portals: ['patient'], current: 'patient' }
const doctor: RouteContext = { portals: ['doctor'], current: 'doctor' }
const both: RouteContext = { portals: ['doctor', 'patient'], current: 'doctor' }

describe('which portal opens on launch', () => {
  it('is the one the person last chose, if they still hold it', () => {
    expect(landingPortal({ portals: ['doctor', 'patient'], preferredPortal: 'patient' })).toBe(
      'patient',
    )
    expect(landingPortal({ portals: ['doctor'], preferredPortal: 'patient' })).toBe('doctor')
  })

  it('skips the portals that live at a desk', () => {
    expect(landingPortal({ portals: ['admin', 'doctor'], preferredPortal: 'admin' })).toBe('doctor')
  })

  it('is nothing for an account the app has no screens for', () => {
    // A receptionist who installed the app is told so, rather than shown an empty tab bar.
    expect(landingPortal({ portals: ['staff', 'admin'], preferredPortal: null })).toBeNull()
  })
})

describe('where a link from the server lands', () => {
  it('follows the web paths the server actually writes', () => {
    expect(resolveHref('/patient/appointments', patient)).toBe('/patient/appointments')
    expect(resolveHref('/patient/appointments/new', patient)).toBe('/patient/book')
    expect(resolveHref('/support/t_123', patient)).toBe('/support/t_123')
    expect(resolveHref('/doctor/encounters/e_9', doctor)).toBe('/doctor/encounters/e_9')
  })

  it('opens the support list as a patient’s tab, and sends a doctor home', () => {
    expect(resolveHref('/support', patient)).toBe('/patient/messages')
    expect(resolveHref('/support', doctor)).toBe('/doctor')
  })

  it('goes home for a screen the app does not have, rather than to "page not found"', () => {
    expect(resolveHref('/patient/billing', patient)).toBe('/patient')
    expect(resolveHref('/staff/support/t_1', doctor)).toBe('/doctor')
    expect(resolveHref('/admin/audit', both)).toBe('/doctor')
  })

  it('does not open a portal the person does not hold', () => {
    // A notification for another account on a shared phone, say.
    expect(resolveHref('/doctor/encounters/e_1', patient)).toBe('/patient')
    expect(resolveHref('/patient/appointments', both)).toBe('/patient/appointments')
  })

  it('ignores a query string, a fragment and a trailing slash', () => {
    expect(resolveHref('/patient/appointments/?from=push#top', patient)).toBe(
      '/patient/appointments',
    )
  })

  /**
   * A notification payload is attacker-influenced in principle. Following an absolute URL out of
   * one would be an open redirect with a push notification as the delivery mechanism.
   */
  it('never leaves the app', () => {
    for (const href of [
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/support/../../etc',
      '/doctor/encounters/<script>',
    ]) {
      expect(resolveHref(href, patient)).toBe('/patient')
    }
  })

  it('falls back to home rather than doing nothing', () => {
    expect(destinationOf(undefined, doctor)).toBe('/doctor')
    expect(destinationOf({}, doctor)).toBe('/doctor')
    expect(destinationOf({ href: 42 }, doctor)).toBe('/doctor')
    expect(homeOf(null)).toBe('/')
  })
})

/**
 * The test the first version was missing.
 *
 * Its routing test fed the router the app's own paths, so it passed while every notification the
 * server really sends — which names web paths — would have opened "page not found". This reads the
 * hrefs out of the worker's source, and checks each lands on a screen file that exists.
 */
describe('every link the worker sends', () => {
  const repo = resolve(import.meta.dirname, '../../../../..')
  const workerHrefs = filesUnder(join(repo, 'apps/worker/src'))
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/href:\s*(?:[^'`]*\?\s*)?['`](\/[^'`]*)['`]/g)].map(
        (match) => (match[1] ?? '').replace(/\$\{[^}]+\}/g, 'abc123'),
      ),
    )
  const appRoutes = screenRoutes(join(repo, 'apps/mobile/app'))

  it('was found — the scan is not vacuous', () => {
    expect(workerHrefs).toEqual(
      expect.arrayContaining(['/patient/appointments', '/support/abc123']),
    )
  })

  it.each([
    ['a patient', patient],
    ['a doctor', doctor],
  ])('lands %s on a screen that exists', (_who, context) => {
    for (const href of workerHrefs) {
      const destination = resolveHref(href, context)
      expect(
        appRoutes.some((route) => route.test(destination)),
        `${href} resolved to ${destination}, which is no screen in apps/mobile/app`,
      ).toBe(true)
    }
  })
})

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** Each screen file under `app/` as the URL pattern expo-router gives it. */
function screenRoutes(appDirectory: string): RegExp[] {
  return filesUnder(appDirectory)
    .map((file) => relative(appDirectory, file).replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.tsx') && !file.split('/').pop()!.startsWith('_'))
    .map((file) => {
      const segments = file
        .replace(/\.tsx$/, '')
        .split('/')
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .filter((segment, index, all) => !(segment === 'index' && index === all.length - 1))
        .map((segment) => (/^\[.+\]$/.test(segment) ? '[^/]+' : segment))
      return new RegExp(`^/${segments.join('/')}$`)
    })
}
