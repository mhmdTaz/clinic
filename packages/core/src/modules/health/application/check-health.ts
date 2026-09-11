import type { DependencyStatus, HealthPayload } from '@clinic/contracts'
import { healthRepository } from '../infrastructure/health.repository'

const startedAt = Date.now()

/**
 * Readiness for the load balancer, and the walking skeleton's proof that the
 * layering works: a route handler calls this, this calls a repository, the
 * repository is the only thing that touches the driver.
 */
export async function checkHealth(version: string): Promise<HealthPayload> {
  const dependencies: DependencyStatus[] = []

  try {
    const db = await healthRepository.pingDatabase()
    dependencies.push({
      name: 'mongodb',
      // A standalone mongod answers a ping perfectly well and then fails every
      // transaction. Reporting it as "up" would be a lie the first booking exposes.
      status: db.isReplicaSet ? 'up' : 'down',
      latencyMs: db.latencyMs,
      detail: db.isReplicaSet
        ? `replica set (${db.topology})`
        : `topology is "${db.topology}" — transactions and change streams are unavailable`,
    })
  } catch (error) {
    dependencies.push({
      name: 'mongodb',
      status: 'down',
      latencyMs: null,
      detail: error instanceof Error ? error.message : 'unknown error',
    })
  }

  return {
    status: dependencies.every((d) => d.status === 'up') ? 'ok' : 'degraded',
    version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checkedAt: new Date().toISOString(),
    dependencies,
  }
}
