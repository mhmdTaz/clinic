/**
 * The transactional outbox (section 13.4): the one place a module says what happened, and the
 * one place the relay looks to find out.
 *
 * Modules import `emitEvent`. The worker imports the rest — which is why the repository is
 * exported here and nowhere else in the codebase does that.
 */
export { emitEvent } from './application/emit'
export { outboxRepository, streamCursorRepository } from './infrastructure/outbox.repository'
export { watchOutbox, type OutboxWatcher } from './infrastructure/outbox-stream'
