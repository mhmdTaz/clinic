/**
 * `pnpm infra:up`: the local Docker stack, up and usable — or a clear reason why not.
 *
 * `docker compose up -d --wait` alone could not tell these apart: it reported failure when the
 * one-shot initialisers (replica set, bucket) finished *successfully*, because a container that
 * exits is not "running"; and when MongoDB could not bind its port, the replica-set initialiser
 * waited for ever. So, in order:
 *
 * 1. Preflight. Every port this project publishes that something outside the project already
 *    holds is named, with its owner when that is a container, and the way round it. Nothing is
 *    stopped: the other thing on the port is somebody's, not ours to close.
 * 2. Start everything, then wait for the initialisers to finish and require exit code 0 from each.
 *    A failed initialiser fails setup, with its log.
 * 3. Wait for the long-running services to report healthy — MongoDB's check is `rs.status()`, so
 *    healthy means a usable replica set, not only a process.
 *
 * Runs as it is on Windows, macOS and Linux: Node and the Docker CLI, nothing else.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INITIALISERS = ['mongo-init', 'minio-init']
const SERVICES = ['mongo', 'redis', 'minio', 'mailpit']
const INIT_TIMEOUT_MS = 180_000
const HEALTH_TIMEOUT_S = 120

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    timeout: options.timeout,
    env: process.env,
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') fail('Docker is not installed, or not on PATH.')
    if (result.error.code === 'ETIMEDOUT') return { status: null, stdout: '', stderr: 'timed out' }
    throw result.error
  }
  return result
}

/** The root .env, for the values compose interpolates and the URIs the app will use. */
function dotenv() {
  const file = resolve(root, '.env')
  if (!existsSync(file)) return {}
  const values = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

/** Whether anything accepts a connection on this port on this machine. */
function listening(port) {
  return new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(750)
    socket.once('connect', () => (socket.destroy(), done(true)))
    socket.once('timeout', () => (socket.destroy(), done(false)))
    socket.once('error', () => done(false))
  })
}

/** The container publishing `port`, if a container is what holds it. */
function containerOnPort(port) {
  const listed = docker(['ps', '--format', '{{.Names}}\t{{.Ports}}'])
  for (const line of listed.stdout.split('\n')) {
    const [name, ports = ''] = line.split('\t')
    // "0.0.0.0:27018->27017/tcp", and ranges: "0.0.0.0:9000-9001->9000-9001/tcp".
    for (const match of ports.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
      const first = Number(match[1])
      const last = Number(match[2] ?? match[1])
      if (port >= first && port <= last) return name
    }
  }
  return null
}

async function preflight(env) {
  const config = docker(['compose', 'config', '--format', 'json'])
  if (config.status !== 0) fail(`docker compose config failed:\n${config.stderr}`)
  const project = JSON.parse(config.stdout)

  // Ports this project already holds are fine: running infra:up twice is normal.
  const ours = new Set(
    docker(['compose', 'ps', '--format', '{{.Name}}']).stdout.split('\n').filter(Boolean),
  )

  const problems = []
  for (const [service, definition] of Object.entries(project.services ?? {})) {
    for (const mapping of definition.ports ?? []) {
      const port = Number(mapping.published)
      if (!port || !(await listening(port))) continue
      const owner = containerOnPort(port)
      if (owner && ours.has(owner)) continue
      problems.push({ service, port, owner })
    }
  }
  if (problems.length === 0) return

  const lines = problems.map(
    ({ service, port, owner }) =>
      `  - ${service}: port ${port} is already in use by ${owner ? `the container "${owner}"` : 'another program'}`,
  )
  const mongo = problems.find((problem) => problem.service === 'mongo')
  const advice = mongo
    ? [
        'MongoDB can move: pick a free port, then in .env set',
        '    MONGO_PORT=<port>',
        '    MONGODB_URI=mongodb://localhost:<port>/?replicaSet=rs0',
        '    MONGODB_AUDIT_URI=mongodb://localhost:<port>/?replicaSet=rs0',
        'and run `pnpm infra:up` again.',
      ]
    : []
  const others = problems.filter((problem) => problem.service !== 'mongo')
  if (others.length > 0) {
    advice.push(
      'The other ports are fixed in docker-compose.yml. Free them, or stop this project from',
      'using them, before running `pnpm infra:up` again. Nothing has been stopped for you.',
    )
  }
  fail(['Some ports this stack needs are taken:', ...lines, '', ...advice].join('\n'))
}

function checkUris(env) {
  const port = env.MONGO_PORT || '27018'
  for (const key of ['MONGODB_URI', 'MONGODB_AUDIT_URI']) {
    const uri = process.env[key] ?? env[key]
    if (!uri) continue
    const match = /localhost:(\d+)/.exec(uri)
    if (match && match[1] !== port) {
      console.warn(
        `! ${key} points at port ${match[1]}, but MongoDB is published on ${port}. ` +
          `Change one of them, or the app will not find the database.`,
      )
    }
  }
}

async function main() {
  const env = { ...dotenv(), ...process.env }
  // Compose reads .env for interpolation itself; MONGO_PORT from the shell wins, as it does there.
  await preflight(env)
  checkUris(env)

  console.log('Starting the stack…')
  const up = docker(['compose', 'up', '-d'], { inherit: true })
  if (up.status !== 0) fail('docker compose up failed (see above).')

  console.log('Waiting for the one-shot initialisers…')
  docker(['compose', 'wait', ...INITIALISERS], { timeout: INIT_TIMEOUT_MS })
  for (const service of INITIALISERS) {
    const id = docker(['compose', 'ps', '-a', '-q', service]).stdout.trim()
    const state = docker([
      'inspect',
      '-f',
      '{{.State.Status}} {{.State.ExitCode}}',
      id,
    ]).stdout.trim()
    const [status, code] = state.split(' ')
    if (status !== 'exited') {
      fail(
        `${service} did not finish within ${INIT_TIMEOUT_MS / 1000}s. Its log: docker compose logs ${service}`,
      )
    }
    if (code !== '0') {
      const log = docker(['compose', 'logs', '--no-log-prefix', '--tail', '30', service])
      fail(`${service} failed (exit code ${code}):\n${log.stdout}${log.stderr}`)
    }
    console.log(`  ✓ ${service}`)
  }

  console.log('Waiting for the services to be healthy…')
  const healthy = docker(
    ['compose', 'up', '-d', '--wait', '--wait-timeout', String(HEALTH_TIMEOUT_S), ...SERVICES],
    { inherit: true },
  )
  if (healthy.status !== 0) {
    fail(
      'A service did not become healthy. `docker compose ps` and `docker compose logs <service>` say which.',
    )
  }

  const port = env.MONGO_PORT || '27018'
  console.log(
    `\n✓ Stack ready. MongoDB replica set rs0 on mongodb://localhost:${port}/?replicaSet=rs0`,
  )
}

await main()
