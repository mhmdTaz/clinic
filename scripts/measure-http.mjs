/**
 * HTTP timings and page weights for a running production build (audit, performance).
 *
 *   node scripts/measure-http.mjs --base http://localhost:3000 --samples 30 --out result.json
 *
 * What it measures, and what it does not:
 * - Complete HTTP responses from Node on the same machine, unthrottled. Not rendering, not
 *   interaction, not a phone on a mobile network — those are browser measurements.
 * - Per route: the first request of this run (not a process cold start, unless the server was
 *   started just before), then `samples` warm requests, all kept raw in the output.
 * - Statistics over the warm requests: min, median (the conventional one — the mean of the two
 *   middle values for an even count), p90, p95, max, mean and standard deviation.
 * - Weight: decoded HTML bytes, and the bytes actually transferred with `Accept-Encoding: gzip`
 *   as the server compressed them.
 *
 * Signs in as the seeded demo users with SEED_PASSWORD (or the demo default). Local data only.
 */
import http from 'node:http'
import https from 'node:https'
import { writeFile } from 'node:fs/promises'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]])
    return pairs
  }, []),
)
const BASE = args.base ?? 'http://localhost:3000'
const SAMPLES = Number(args.samples ?? 30)
const PASSWORD = process.env.SEED_PASSWORD ?? 'Clinic-Demo-2026!'
const ROUTES = {
  admin: ['/admin', '/admin/clinic', '/admin/analytics', '/admin/audit'],
  staff: ['/staff', '/staff/patients', '/staff/appointments', '/staff/billing', '/staff/inventory'],
  doctor: ['/doctor', '/doctor/appointments', '/doctor/patients'],
  patient: [
    '/patient',
    '/patient/appointments',
    '/patient/appointments/new',
    '/patient/records',
    '/patient/billing',
  ],
}

/** One GET, timed, with the raw (compressed) body kept apart from the decoded one. */
function get(path, cookie) {
  const url = new URL(path, BASE)
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const start = performance.now()
    let firstByte = null
    const request = client.get(
      url,
      { headers: { cookie, 'accept-encoding': 'gzip' } },
      (response) => {
        const chunks = []
        response.once('data', () => (firstByte = performance.now()))
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const raw = Buffer.concat(chunks)
          const encoding = response.headers['content-encoding']
          const decoded =
            encoding === 'gzip'
              ? gunzipSync(raw)
              : encoding === 'br'
                ? brotliDecompressSync(raw)
                : encoding === 'deflate'
                  ? inflateSync(raw)
                  : raw
          const end = performance.now()
          resolve({
            status: response.statusCode,
            ttfbMs: round((firstByte ?? end) - start),
            totalMs: round(end - start),
            transferBytes: raw.length,
            decodedBytes: decoded.length,
            encoding: encoding ?? 'identity',
          })
        })
      },
    )
    request.on('error', reject)
  })
}

const round = (value) => Math.round(value * 10) / 10

function quantile(sorted, q) {
  // Linear interpolation between closest ranks (the common "type 7" definition).
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower))
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return {
    n: values.length,
    min: sorted[0],
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    max: sorted.at(-1),
    mean: round(mean),
    stdev: round(Math.sqrt(variance)),
  }
}

async function signIn(role) {
  const response = await fetch(new URL('/api/v1/auth/login', BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: `${role}@clinic.local`, password: PASSWORD }),
  })
  if (!response.ok) throw new Error(`${role} sign-in: ${response.status}`)
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

const results = []
for (const [role, paths] of Object.entries(ROUTES)) {
  const cookie = await signIn(role)
  for (const path of paths) {
    const first = await get(path, cookie)
    const warm = []
    for (let index = 0; index < SAMPLES; index += 1) warm.push(await get(path, cookie))
    const last = warm.at(-1)
    results.push({
      role,
      path,
      statuses: [...new Set([first, ...warm].map((sample) => sample.status))],
      firstRequest: first,
      warmTotalMs: stats(warm.map((sample) => sample.totalMs)),
      warmTtfbMs: stats(warm.map((sample) => sample.ttfbMs)),
      decodedBytes: last.decodedBytes,
      transferBytes: last.transferBytes,
      encoding: last.encoding,
      raw: warm.map(({ totalMs, ttfbMs }) => [totalMs, ttfbMs]),
    })
    console.log(
      `${path.padEnd(28)} median ${String(results.at(-1).warmTotalMs.median).padStart(6)} ms  ` +
        `p95 ${String(results.at(-1).warmTotalMs.p95).padStart(6)} ms  ` +
        `html ${(last.decodedBytes / 1024).toFixed(1)} KB (${(last.transferBytes / 1024).toFixed(1)} KB ${last.encoding})`,
    )
  }
  await fetch(new URL('/api/v1/auth/logout', BASE), {
    method: 'POST',
    headers: { cookie, origin: BASE },
  })
}

const output = {
  measuredAt: new Date().toISOString(),
  base: BASE,
  method:
    `Production server, same machine, unthrottled HTTP; per route one first request of this run ` +
    `then ${SAMPLES} sequential warm requests with Accept-Encoding: gzip. Timings are complete ` +
    `responses in Node, not browser rendering or Web Vitals. raw = [totalMs, ttfbMs] per warm request.`,
  node: process.version,
  results,
}
if (args.out) await writeFile(args.out, JSON.stringify(output, null, 2))
