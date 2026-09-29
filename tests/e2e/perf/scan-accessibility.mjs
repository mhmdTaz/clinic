/**
 * An automated accessibility pass over the main screens (audit, accessibility).
 *
 *   node perf/scan-accessibility.mjs --base http://localhost:3000 --out a11y.json
 *
 * axe-core finds what a machine can: missing names, contrast, ARIA misuse, landmark and heading
 * structure. It cannot say whether a flow makes sense with a screen reader, or works at 200%
 * zoom; those remain manual checks. Findings are printed and saved, not hidden.
 */
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]])
    return pairs
  }, []),
)
const BASE = args.base ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Clinic-Demo-2026!'

const SCREENS = {
  null: ['/login', '/forgot-password'],
  admin: ['/admin', '/admin/clinic', '/admin/users', '/admin/audit'],
  staff: [
    '/staff',
    '/staff/patients',
    '/staff/patients/new',
    '/staff/appointments',
    '/staff/billing',
  ],
  doctor: ['/doctor', '/doctor/appointments', '/doctor/patients', 'ENCOUNTER'],
  patient: ['/patient', '/patient/appointments', '/patient/appointments/new', '/patient/records'],
}

const browser = await chromium.launch()
const findings = []
for (const [role, paths] of Object.entries(SCREENS)) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme: scheme })
    if (role !== 'null') {
      const response = await context.request.post(`${BASE}/api/v1/auth/login`, {
        headers: { origin: BASE },
        data: { email: `${role}@clinic.local`, password: PASSWORD },
      })
      if (!response.ok()) throw new Error(`${role} sign-in: ${response.status()}`)
    }
    const page = await context.newPage()
    for (let path of paths) {
      if (path === 'ENCOUNTER') {
        const visits = await context.request.get(
          `${BASE}/api/v1/encounters?noteStatus=DRAFT&limit=1`,
        )
        const id = (await visits.json()).data?.[0]?.id
        if (!id) continue
        path = `/doctor/encounters/${id}`
      }
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      for (const violation of result.violations) {
        findings.push({
          role,
          scheme,
          path,
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.slice(0, 5).map((node) => ({
            target: node.target.join(' '),
            summary: node.failureSummary?.split('\n').slice(0, 3).join(' '),
          })),
          count: violation.nodes.length,
        })
      }
    }
    await context.close()
  }
}
await browser.close()

const byRule = {}
for (const finding of findings) {
  const key = `${finding.impact} ${finding.id}`
  byRule[key] ??= { help: finding.help, pages: new Set(), nodes: 0 }
  byRule[key].pages.add(`${finding.path} (${finding.scheme})`)
  byRule[key].nodes += finding.count
}
for (const [key, { help, pages, nodes }] of Object.entries(byRule)) {
  console.log(
    `${key} — ${help} — ${nodes} nodes on ${pages.size} page/theme(s): ${[...pages].slice(0, 6).join(', ')}`,
  )
}
if (findings.length === 0) console.log('No axe violations at WCAG 2.1 A/AA.')
if (args.out)
  await writeFile(
    args.out,
    JSON.stringify({ scannedAt: new Date().toISOString(), base: BASE, findings }, null, 2),
  )
