import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'

/**
 * Finding `mongodump` and `mongorestore`, wherever they happen to live.
 *
 * They are not part of the server package and are frequently absent from a developer's machine
 * while being present in the database container — which is also how production runs them. Rather
 * than making the runbook say "install the tools first", the scripts look in both places and say
 * which one they used.
 *
 * Running inside the container needs the URI rewritten: `localhost` on the host is the published
 * port, and `localhost` inside the container is mongod itself. For this stack they agree, because
 * the container listens on the same port it publishes (see docker-compose.yml) — but the
 * rewriting is done explicitly rather than relied upon, because a stack where they differ would
 * otherwise fail with a connection error nobody could read.
 */

export type Runner = { kind: 'host' } | { kind: 'docker'; container: string }

const DEFAULT_CONTAINER = process.env.MONGO_TOOLS_CONTAINER ?? 'clinic-mongo'

function onPath(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function containerExists(container: string): boolean {
  try {
    const out = execFileSync(
      'docker',
      ['ps', '--filter', `name=^${container}$`, '--format', '{{.Names}}'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    return out.trim() === container
  } catch {
    return false
  }
}

/** Where the tools are, or an error naming both places that were tried. */
export function findRunner(): Runner {
  if (onPath('mongodump')) return { kind: 'host' }
  if (containerExists(DEFAULT_CONTAINER)) return { kind: 'docker', container: DEFAULT_CONTAINER }

  throw new Error(
    'Neither mongodump on PATH nor a running "' +
      DEFAULT_CONTAINER +
      '" container.\n' +
      'Install the MongoDB Database Tools, start the stack with `pnpm infra:up`, or set ' +
      'MONGO_TOOLS_CONTAINER to the container that has them.',
  )
}

export function describeRunner(runner: Runner): string {
  return runner.kind === 'host' ? 'mongodump on PATH' : `docker exec ${runner.container}`
}

/**
 * The URI as the tool will see it.
 *
 * Inside the container the database is on localhost; the host's URI may name a published address
 * that means something else there.
 */
export function uriFor(runner: Runner, uri: string): string {
  if (runner.kind === 'host') return uri
  const url = new URL(uri)
  url.hostname = 'localhost'
  return url.toString()
}

/**
 * Runs a Mongo tool, streaming stdout to (or stdin from) a file descriptor.
 *
 * Streaming rather than buffering matters at production size: a `mongodump` of a real clinic is
 * gigabytes, and `execFileSync` would hold all of it in memory before anything reached disk.
 */
export function runTool(
  runner: Runner,
  tool: 'mongodump' | 'mongorestore',
  args: string[],
  io: { stdin?: number; stdout?: number } = {},
): void {
  const command = runner.kind === 'host' ? tool : 'docker'
  const argv =
    runner.kind === 'host'
      ? args
      : [
          'exec',
          // -i keeps stdin open, which mongorestore needs when the archive is piped in.
          ...(io.stdin !== undefined ? ['-i'] : []),
          runner.container,
          tool,
          ...args,
        ]

  const result: SpawnSyncReturns<Buffer> = spawnSync(command, argv, {
    stdio: [io.stdin ?? 'ignore', io.stdout ?? 'inherit', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim()
    throw new Error(`${tool} exited ${result.status}${stderr ? `:\n${stderr}` : ''}`)
  }
}

/** The tool's own version string, recorded in the manifest so a restore knows what wrote it. */
export function toolVersion(runner: Runner, tool: 'mongodump' | 'mongorestore'): string {
  const command = runner.kind === 'host' ? tool : 'docker'
  const argv =
    runner.kind === 'host' ? ['--version'] : ['exec', runner.container, tool, '--version']
  const out = execFileSync(command, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return out.split('\n')[0]?.trim() ?? 'unknown'
}
