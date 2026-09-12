export * from './errors'
export {
  runWithContext,
  currentContext,
  systemContext,
  type RequestContext,
  type ActorType,
} from './context/request-context'
/**
 * A transaction, for a caller composing writes of its own.
 *
 * Use cases open their own — nothing in a route handler should reach for this. It is exported
 * because a process building on core (the worker, a migration, a test proving the outbox really
 * does roll back with the change that caused it) sometimes needs to wrap several of them.
 */
export { runInTransaction, type Transaction } from './transaction'
