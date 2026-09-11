import { withTransaction } from '@clinic/db'

type DriverSession = Parameters<Parameters<typeof withTransaction>[0]>[0]

declare const transactionBrand: unique symbol

/**
 * An open database transaction, opaque above the infrastructure layer (section 6). A use case
 * starts one and hands it to the repositories that must write together; only a repository
 * looks inside.
 *
 * Automatically captured audit entries wait for the commit (section 11.3). Explicit entries a
 * use case records should be written after runInTransaction returns, for the same reason.
 */
export type Transaction = { readonly [transactionBrand]: true }

export function runInTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction((session) => work(session as unknown as Transaction))
}

/** Repositories only: the driver session behind a transaction, or undefined outside one. */
export function sessionOf(tx: Transaction | null | undefined): DriverSession | undefined {
  return (tx ?? undefined) as unknown as DriverSession | undefined
}
