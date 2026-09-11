import { MongoClient, type Document, type Filter } from 'mongodb'
import { E2E } from '../e2e.env'

let client: MongoClient | null = null

async function database() {
  if (!client) {
    client = new MongoClient(E2E.mongoUri)
    await client.connect()
  }
  return client.db(E2E.database)
}

/**
 * The newest audit entry matching `filter` in the e2e clinic. Polls briefly: automatically
 * captured entries are written asynchronously, just after the response.
 */
export async function findAuditEntry(filter: Filter<Document>): Promise<Document | null> {
  const auditLogs = (await database()).collection('auditLogs')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entry = await auditLogs.findOne(
      { clinicId: E2E.clinicId, ...filter },
      { sort: { occurredAt: -1 } },
    )
    if (entry) return entry
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

export async function closeDatabase(): Promise<void> {
  await client?.close()
  client = null
}
