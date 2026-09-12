import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor } from 'bullmq'
import { env } from '@clinic/config'

/**
 * The queues from section 13.5, and the connection they share.
 *
 * BullMQ is given connection *options* rather than a client we built: it bundles its own ioredis,
 * and handing it an instance from a different major version is the kind of mismatch that
 * typechecks in some layouts and fails at runtime in others.
 *
 * `maxRetriesPerRequest: null` is the setting that matters — a blocking `BRPOPLPUSH` is a request
 * that is *meant* to hang, and ioredis's default retry cap would tear it down, leaving a worker
 * that looks alive and processes nothing.
 */
function connectionOptions(): ConnectionOptions {
  const url = new URL(env().REDIS_URL)
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    maxRetriesPerRequest: null,
  }
}

const connection = connectionOptions()

export const QUEUE_NAMES = ['notifications', 'documents', 'maintenance'] as const
export type QueueName = (typeof QUEUE_NAMES)[number]

/**
 * Every job retries with exponential backoff and then stops, because at-least-once delivery
 * means a job *will* run twice and a job that retries forever is a job that fails forever.
 * What makes that safe is not the retry policy but the idempotency of the handlers themselves
 * (ADR-0030): a notification's dedupe key and the outbox's conditional `markProcessed` mean a
 * second run changes nothing.
 *
 * Completed jobs are trimmed; failed ones are kept, because a dead letter nobody can read is
 * a dead letter nobody will fix.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1_000 },
}

const queues = new Map<QueueName, Queue>()

export function queue(name: QueueName): Queue {
  const existing = queues.get(name)
  if (existing) return existing
  const created = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS })
  queues.set(name, created)
  return created
}

const workers: Worker[] = []

export function startWorker(name: QueueName, processor: Processor): Worker {
  const worker = new Worker(name, processor, { connection, concurrency: 5 })
  workers.push(worker)
  return worker
}

/** A repeatable job, keyed by name so restarting the worker does not stack duplicates. */
export async function schedule(
  name: QueueName,
  jobName: string,
  everyMs: number,
  data: Record<string, unknown> = {},
): Promise<void> {
  await queue(name).add(jobName, data, {
    ...DEFAULT_JOB_OPTIONS,
    repeat: { every: everyMs, key: jobName },
    jobId: `repeat:${jobName}`,
  })
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((entry) => entry.close()))
  await Promise.all(workers.map((entry) => entry.close()))
}
