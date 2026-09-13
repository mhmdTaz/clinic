/**
 * The app in a browser, against the local API — for exercising screens without a simulator.
 *
 *   pnpm --filter @clinic/web start          # the API on :3000
 *   pnpm --filter @clinic/mobile preview:web # then open http://localhost:8090
 *
 * Development only, and not a shipped target. It runs Expo's web build behind a small proxy on one
 * origin: `/api/*` goes to the API and everything else to Metro. The proxy **drops the `Origin`
 * header** on API requests, because a phone sends none and the API refuses a foreign one on writes
 * (§16.1, CSRF) — so what the API sees is what it sees from a device, not a cross-site browser.
 *
 * What it cannot show is everything native: the keychain, the encrypted vault (the web build keeps
 * both in memory — see `*.web.ts`), push permission and delivery, the OS opening a notification,
 * the in-app browser, the keyboard. Those need a device.
 */
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROXY_PORT = Number(process.env.PREVIEW_PORT ?? 8090)
const API_PORT = Number(process.env.API_PORT ?? 3000)
const METRO_PORT = Number(process.env.METRO_PORT ?? 8081)
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const server = http.createServer((request, response) => {
  const toApi = request.url?.startsWith('/api/') ?? false
  const port = toApi ? API_PORT : METRO_PORT
  const headers = { ...request.headers, host: `localhost:${port}` }
  if (toApi) {
    // As a device: no Origin, no Referer, no cookies — the Bearer header is the only credential.
    delete headers.origin
    delete headers.referer
    delete headers.cookie
  }

  const upstream = http.request(
    { host: '127.0.0.1', port, path: request.url, method: request.method, headers },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(response)
    },
  )
  upstream.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'text/plain' })
    response.end(`web-preview: ${toApi ? 'the API' : 'Metro'} is not answering (${error.message})`)
  })
  request.pipe(upstream)
})

// Metro's reload socket.
server.on('upgrade', (request, socket, head) => {
  const upstream = net.connect(METRO_PORT, '127.0.0.1', () => {
    const lines = [`${request.method} ${request.url} HTTP/1.1`]
    for (const [key, value] of Object.entries(request.headers)) lines.push(`${key}: ${value}`)
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PROXY_PORT, () => {
  console.log(
    `web-preview: open http://localhost:${PROXY_PORT} (API :${API_PORT}, Metro :${METRO_PORT})`,
  )
})

const expo = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--port', String(METRO_PORT)], {
  cwd: appDirectory,
  shell: process.platform === 'win32',
  stdio: 'inherit',
  env: {
    ...process.env,
    CLINIC_API_URL: `http://localhost:${PROXY_PORT}`,
    BROWSER: 'none',
    EXPO_NO_TELEMETRY: '1',
  },
})
expo.on('exit', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => expo.kill(signal))
