/**
 * Phase 0 exit criterion: "a transaction and a change stream both succeed against
 * the local container (proving the replica set)".
 *
 * A standalone mongod accepts ordinary reads and writes perfectly well and fails
 * only these two paths — late, and confusingly. This script fails loudly instead.
 *
 *   pnpm db:verify
 */
import './bootstrap-env'
import {
  connect,
  disconnect,
  getConnection,
  inspectTopology,
  newId,
  withTransaction,
} from '../src/index'

type ProbeDoc = { _id: string; kind: string }

const CHECK = '✓'
const CROSS = '✗'

async function verifyTopology() {
  const topology = await inspectTopology()
  if (!topology.isReplicaSet) {
    throw new Error(
      `mongod reports topology "${topology.topology}", not a replica set.\n` +
        'Transactions and change streams do not exist without one. Run `pnpm infra:up`, ' +
        'and make sure MONGODB_URI includes ?replicaSet=rs0.',
    )
  }
  console.warn(`${CHECK} topology: replica set "${topology.setName}"`)
}

async function verifyTransaction() {
  const conn = getConnection()
  const probe = conn.collection<ProbeDoc>('_phase0_probe')
  const idA = newId()
  const idB = newId()

  // Commit path: both documents land, or neither does.
  await withTransaction(async (session) => {
    await probe.insertOne({ _id: idA, kind: 'commit' }, { session })
    await probe.insertOne({ _id: idB, kind: 'commit' }, { session })
  })
  const committed = await probe.countDocuments({ _id: { $in: [idA, idB] } })
  if (committed !== 2) throw new Error(`transaction commit lost documents (${committed}/2)`)

  // Rollback path: an error inside the transaction must undo the first insert too.
  const idC = newId()
  await withTransaction(async (session) => {
    await probe.insertOne({ _id: idC, kind: 'rollback' }, { session })
    throw new Error('deliberate rollback')
  }).catch((e) => {
    if (!/deliberate rollback/.test(e.message)) throw e
  })
  const rolledBack = await probe.countDocuments({ _id: idC })
  if (rolledBack !== 0) throw new Error('transaction did NOT roll back — this is not a replica set')

  await probe.deleteMany({ _id: { $in: [idA, idB] } })
  console.warn(`${CHECK} transactions: commit and rollback both behave correctly`)
}

async function verifyChangeStream() {
  const conn = getConnection()
  const probe = conn.collection<ProbeDoc>('_phase0_probe')
  const stream = probe.watch([{ $match: { operationType: 'insert' } }])

  const id = newId()
  const observed = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000)
    stream.on('change', (change) => {
      if ((change as { documentKey?: { _id?: string } }).documentKey?._id === id) {
        clearTimeout(timer)
        resolve(true)
      }
    })
  })

  // Give the stream a moment to establish before writing.
  await new Promise((r) => setTimeout(r, 500))
  await probe.insertOne({ _id: id, kind: 'change-stream' })

  const sawIt = await observed
  await stream.close()
  await probe.deleteOne({ _id: id })

  if (!sawIt) throw new Error('change stream produced no event within 8s')
  console.warn(`${CHECK} change streams: insert observed (the outbox relay depends on this)`)
}

async function main() {
  await connect()
  await verifyTopology()
  await verifyTransaction()
  await verifyChangeStream()
  await getConnection()
    .collection('_phase0_probe')
    .drop()
    .catch(() => {})
  console.warn('\nReplica set verified — transactions and change streams are both available.')
  await disconnect()
}

main().catch(async (error) => {
  console.error(`\n${CROSS} ${error instanceof Error ? error.message : error}\n`)
  await disconnect().catch(() => {})
  process.exit(1)
})
