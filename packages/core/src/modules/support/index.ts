/** Support tickets: asking the clinic something, and being answered (P9, S11, D16). */
export {
  openTicket,
  replyToTicket,
  updateTicket,
  listTickets,
  getTicket,
  toTicketSummary,
  toTicketDetail,
  findTicketForNotification,
  ticketResource,
} from './application/tickets'
export { installTicketScopeResolvers } from './application/scope'
export {
  isOpen,
  acceptsReplies,
  statusAfterReply,
  awaitingFirstReply,
  byUrgency,
} from './domain/ticket'
// NOT exported: the repository.
