import AxeBuilder from '@axe-core/playwright'
import type { Browser, Page } from '@playwright/test'
import { E2E } from '../e2e.env'
import { newPersonPage, signIn } from '../helpers/session'
import { expect, test } from './fixtures'

/**
 * What a machine can check about accessibility, on the screens people spend their day in, in both
 * themes: names, contrast, ARIA, list and landmark structure (WCAG 2.1 A and AA). The first pass
 * found white text on the success colour at 3.9:1 and a clinic card whose definition list a
 * screen reader could not follow. It cannot judge whether a flow makes sense by ear, or at 200%
 * zoom — those stay manual.
 */

const SCREENS: Record<string, string[]> = {
  'admin@clinic.local': ['/admin', '/admin/clinic', '/admin/users'],
  'staff@clinic.local': ['/staff', '/staff/patients', '/staff/appointments'],
  'doctor@clinic.local': ['/doctor', '/doctor/appointments'],
  'patient@clinic.local': ['/patient', '/patient/appointments', '/patient/appointments/new'],
}

async function signedInAs(browser: Browser, email: string, scheme: 'light' | 'dark') {
  const page: Page = await newPersonPage(browser)
  await page.emulateMedia({ colorScheme: scheme })
  await signIn(page, email, E2E.password)
  return page
}

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return result.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }))
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the main screens have no automatically detectable WCAG A/AA failures (${scheme})`, async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const found: Array<{ path: string; rule: string }> = []
    for (const [email, paths] of Object.entries(SCREENS)) {
      const page = await signedInAs(browser, email, scheme)
      for (const path of paths) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        for (const violation of await violations(page)) {
          found.push({
            path,
            rule: `${violation.impact} ${violation.rule}: ${violation.targets[0]}`,
          })
        }
      }
      await page.context().close()
    }
    expect(found).toEqual([])
  })
}
