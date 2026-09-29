/**
 * Lab measurements of page loads in Chromium (audit, performance).
 *
 *   node perf/measure-vitals.mjs --base http://localhost:3000 --runs 5 --out vitals.json
 *
 * Settings, the same for every page and run:
 * - Pixel-7-like phone: 412×915 viewport, device scale 2.625, touch, mobile user agent.
 * - Network via CDP: 150 ms round trip, 1.6 Mb/s down, 750 kb/s up (roughly "fast 3G").
 * - CPU slowed 4× via CDP.
 * - A fresh browser context per run: no HTTP cache, a new sign-in.
 *
 * Reported per page: TTFB, FCP, LCP and CLS from the browser's own performance entries, as the
 * median and range of the runs. These are lab numbers from one machine, not field data, and
 * there is no INP here: INP needs real interactions over a real visit, which a scripted page
 * load does not have.
 */
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]])
    return pairs
  }, []),
)
const BASE = args.base ?? 'http://localhost:3000'
const RUNS = Number(args.runs ?? 5)
const PASSWORD = process.env.SEED_PASSWORD ?? 'Clinic-Demo-2026!'

const PAGES = [
  { name: 'sign-in', path: '/login', as: null },
  { name: 'patient overview', path: '/patient', as: 'patient' },
  { name: 'patient booking', path: '/patient/appointments/new', as: 'patient' },
  { name: 'doctor overview', path: '/doctor', as: 'doctor' },
  { name: 'encounter editor', path: 'ENCOUNTER', as: 'doctor' },
]

const OBSERVE = () => {
  window.__vitals = { lcp: null, cls: 0 }
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1)
    if (last) window.__vitals.lcp = last.startTime
  }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (!entry.hadRecentInput) window.__vitals.cls += entry.value
  }).observe({ type: 'layout-shift', buffered: true })
}

async function signedInContext(browser, role) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  })
  if (role) {
    const response = await context.request.post(`${BASE}/api/v1/auth/login`, {
      headers: { origin: BASE },
      data: { email: `${role}@clinic.local`, password: PASSWORD },
    })
    if (!response.ok()) throw new Error(`${role} sign-in: ${response.status()}`)
  }
  return context
}

async function encounterPath(browser) {
  const context = await signedInContext(browser, 'doctor')
  const response = await context.request.get(`${BASE}/api/v1/encounters?limit=1`)
  const body = await response.json()
  await context.close()
  const id = body.data?.[0]?.id
  if (!id) throw new Error('No encounter to open: record a visit first.')
  return `/doctor/encounters/${id}`
}

async function measure(browser, path, role) {
  const context = await signedInContext(browser, role)
  const page = await context.newPage()
  await page.addInitScript(OBSERVE)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  await page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const result = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    const paint = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      url: location.pathname,
      ttfb: navigation ? navigation.responseStart : null,
      fcp: paint ? paint.startTime : null,
      lcp: window.__vitals.lcp,
      cls: window.__vitals.cls,
    }
  })
  await context.close()
  return result
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const summary = (values, digits = 0) => {
  const clean = values.filter((value) => typeof value === 'number')
  const round = (value) => Number(value.toFixed(digits))
  return {
    median: round(median(clean)),
    min: round(Math.min(...clean)),
    max: round(Math.max(...clean)),
  }
}

const browser = await chromium.launch()
const results = []
for (const target of PAGES) {
  const path = target.path === 'ENCOUNTER' ? await encounterPath(browser) : target.path
  const runs = []
  for (let run = 0; run < RUNS; run += 1) runs.push(await measure(browser, path, target.as))
  const landed = [...new Set(runs.map((run) => run.url))]
  results.push({
    page: target.name,
    path,
    landed,
    ttfbMs: summary(runs.map((run) => run.ttfb)),
    fcpMs: summary(runs.map((run) => run.fcp)),
    lcpMs: summary(runs.map((run) => run.lcp)),
    cls: summary(
      runs.map((run) => run.cls),
      3,
    ),
    runs,
  })
  const last = results.at(-1)
  console.log(
    `${target.name.padEnd(18)} LCP ${String(last.lcpMs.median).padStart(5)} ms ` +
      `(${last.lcpMs.min}–${last.lcpMs.max})  FCP ${String(last.fcpMs.median).padStart(5)} ms  ` +
      `CLS ${last.cls.median}  TTFB ${last.ttfbMs.median} ms`,
  )
}
await browser.close()

if (args.out) {
  await writeFile(
    args.out,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        base: BASE,
        runsPerPage: RUNS,
        settings:
          'Chromium via Playwright; 412x915 @2.625, mobile UA, touch; CDP network 150 ms RTT, ' +
          '1.6 Mb/s down, 750 kb/s up; CDP CPU throttling 4x; fresh context per run. Lab data, ' +
          'one machine; no INP (needs real interactions).',
        results,
      },
      null,
      2,
    ),
  )
}
