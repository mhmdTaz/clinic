import { closeDatabase } from './helpers/database'

export default async function globalTeardown(): Promise<void> {
  await closeDatabase()
}
