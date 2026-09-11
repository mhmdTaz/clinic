import type { DependencyStatus, HealthPayload } from '@clinic/contracts'
import { pingRateLimitStore } from '../../identity'
import { healthRepository } from '../infrastructure/health.repository'

const startedAt = Date.now()

const message = (error: unknown) => (error instanceof Error ? error.message : 'unknown error')

/**
 * Readiness for the load balancer. A route handler calls this, this calls a repository,
 * and the repository is the only thing that touches the driver.
 */
export async function checkHealth(version: string): Promise<HealthPayload> {
  const [database, rateLimitStore] = await Promise.all([checkDatabase(), checkRateLimitStore()])
  const dependencies = [database, rateLimitStore]

  return {
    status: dependencies.every((dependency) => dependency.status === 'up') ? 'ok' : 'degraded',
    ready: dependencies.every((dependency) => !dependency.critical || dependency.status === 'up'),
    version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checkedAt: new Date().toISOString(),
    dependencies,
  }
}

async function checkDatabase(): Promise<DependencyStatus> {
  try {
    const db = await healthRepository.pingDatabase()
    return {
      name: 'mongodb',
      critical: true,
      // A standalone mongod answers a ping perfectly well and then fails every
      // transaction. Reporting it as "up" would be a lie the first booking exposes.
      status: db.isReplicaSet ? 'up' : 'down',
      latencyMs: db.latencyMs,
      detail: db.isReplicaSet
        ? `replica set (${db.topology})`
        : `topology is "${db.topology}" — transactions and change streams are unavailable`,
    }
  } catch (error) {
    return {
      name: 'mongodb',
      critical: true,
      status: 'down',
      latencyMs: null,
      detail: message(error),
    }
  }
}

/** Not critical: sign-in keeps working without Redis, but per-IP rate limits fail open. */
async function checkRateLimitStore(): Promise<DependencyStatus> {
  try {
    return {
      name: 'redis',
      critical: false,
      status: 'up',
      latencyMs: await pingRateLimitStore(),
      detail: null,
    }
  } catch (error) {
    return {
      name: 'redis',
      critical: false,
      status: 'down',
      latencyMs: null,
      detail: `rate limiting is failing open: ${message(error)}`,
    }
  }
}
