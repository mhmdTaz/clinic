import { describe, expect, it } from 'vitest'
import { env } from '@clinic/config'
import { OutboxEventModel, PatientModel, newId } from '@clinic/db'
import {
  createUser,
  meta,
  outcome,
  signedInActor,
  TEST_PASSWORD,
  everyPage,
} from '../../../../test/fixtures'
import type { Actor } from '../../access'
import { registerPatient } from '../../patients'
import { authenticateAccessToken, login } from '../../session'
import { getTicket, listTickets, openTicket, replyToTicket, updateTicket } from '../index'

const clinicId = () => env().CLINIC_ID

async function staffActor(): Promise<Actor> {
  return (await signedInActor({ role: 'staff' })).actor
}

/** A patient with a portal account, which is what lets them open a ticket at all. */
async function patientActor(staff: Actor): Promise<{ actor: Actor; userId: string }> {
  const account = await createUser({ role: 'patient', firstName: 'Zeina', lastName: 'Murr' })
  const registered = await registerPatient(staff, {
    firstName: 'Zeina',
    lastName: `Murr${newId().slice(0, 8)}`,
    dateOfBirth: null,
    gender: null,
    nationalId: null,
    bloodType: 'UNKNOWN',
    contact: { phone: null, email: null },
    address: { line1: null, city: null, country: null },
    emergencyContacts: [],
    adminNotes: null,
    duplicateOverride: null,
    inviteToPortal: false,
  })
  await PatientModel()
    .updateOne(
      { _id: registered.patient.id, clinicId: clinicId() },
      { $set: { userId: account.id } },
    )
    .setOptions({ skipAudit: true })

  const session = await login({ email: account.email, password: TEST_PASSWORD, meta: meta() })
  const { actor } = await authenticateAccessToken(session.accessToken)
  return { actor, userId: account.id }
}

const TICKET = {
  subject: 'My invoice looks wrong',
  category: 'BILLING' as const,
  priority: 'NORMAL' as const,
  body: 'I was charged twice for the same visit.',
  fileIds: [],
  requesterId: null,
}

describe('opening a ticket', () => {
  it('is numbered, opened, and emits an event inside the transaction', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)

    const ticket = await openTicket(patient.actor, TICKET)

    expect(ticket.number).toMatch(/^TKT-\d{6}$/)
    expect(ticket.status).toBe('OPEN')
    expect(ticket.requester.id).toBe(patient.userId)
    expect(ticket.messages).toHaveLength(1)
    expect(ticket.awaitingFirstReply).toBe(true)

    // The event is in the outbox, written with the ticket rather than after it (13.4).
    const events = await OutboxEventModel()
      .find({ clinicId: clinicId(), eventName: 'ticket.created' })
      .lean()
    expect(
      events.some((row) => (row.payload as { ticketId?: string })?.ticketId === ticket.id),
    ).toBe(true)
  })

  it('ignores the priority a patient asks for', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)

    // How urgent something is, is the clinic's judgement rather than the asker's.
    const ticket = await openTicket(patient.actor, { ...TICKET, priority: 'URGENT' })
    expect(ticket.priority).toBe('NORMAL')

    // Staff saying urgent means urgent.
    const theirs = await openTicket(staff, { ...TICKET, priority: 'URGENT' })
    expect(theirs.priority).toBe('URGENT')
  })

  it('lets staff write down a phone call, and refuses everybody else', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const other = await patientActor(staff)

    const onBehalf = await openTicket(staff, { ...TICKET, requesterId: patient.userId })
    expect(onBehalf.requester.id).toBe(patient.userId)

    expect(await outcome(openTicket(patient.actor, { ...TICKET, requesterId: other.userId }))).toBe(
      'FORBIDDEN',
    )
  })
})

describe('replying', () => {
  /**
   * **Phase 7's first exit criterion**: a patient opens a ticket, and staff reply with both a
   * public and an internal message — with only one of them reaching the patient.
   */
  it('shows the patient the public reply and never the internal note', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)

    const opened = await openTicket(patient.actor, TICKET)

    await replyToTicket(staff, opened.id, {
      body: 'We have looked into it and refunded the duplicate.',
      isInternal: false,
      fileIds: [],
    })
    await replyToTicket(staff, opened.id, {
      body: 'Reception double-keyed this on Tuesday — worth a word at the huddle.',
      isInternal: true,
      fileIds: [],
    })

    // What the clinic sees: everything.
    const clinicView = await getTicket(staff, opened.id)
    expect(clinicView.messages).toHaveLength(3)
    expect(clinicView.messages.filter((message) => message.isInternal)).toHaveLength(1)

    // What the patient sees: their own message and the answer, and nothing else.
    const patientView = await getTicket(patient.actor, opened.id)
    expect(patientView.messages).toHaveLength(2)
    expect(patientView.messages.every((message) => !message.isInternal)).toBe(true)
    expect(patientView.messages.map((message) => message.body).join(' ')).toContain('refunded')
    expect(patientView.messages.map((message) => message.body).join(' ')).not.toContain('huddle')

    // And the count agrees with what they can actually open.
    expect(patientView.messageCount).toBe(2)
    expect(clinicView.messageCount).toBe(3)
  })

  it('refuses an internal note from the person it would be hidden from', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)

    // Refused outright rather than silently made public: a patient whose note was quietly
    // published would have no way of knowing.
    expect(
      await outcome(
        replyToTicket(patient.actor, opened.id, {
          body: 'secret',
          isInternal: true,
          fileIds: [],
        }),
      ),
    ).toBe('FORBIDDEN')
  })

  it('hands the ball back and forth, and an internal note does not', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)
    expect(opened.status).toBe('OPEN')

    // The clinic answers: waiting on the patient.
    const answered = await replyToTicket(staff, opened.id, {
      body: 'Could you confirm the date?',
      isInternal: false,
      fileIds: [],
    })
    expect(answered.status).toBe('PENDING')

    // A note between colleagues changes nothing — nobody has been answered.
    const noted = await replyToTicket(staff, opened.id, {
      body: 'Chasing finance.',
      isInternal: true,
      fileIds: [],
    })
    expect(noted.status).toBe('PENDING')

    // The patient comes back: the clinic's turn again.
    const returned = await replyToTicket(patient.actor, opened.id, {
      body: 'It was the 3rd.',
      isInternal: false,
      fileIds: [],
    })
    expect(returned.status).toBe('OPEN')
  })

  it('stops the response clock on the first public reply, not on a note', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)

    const afterNote = await replyToTicket(staff, opened.id, {
      body: 'Looking into this.',
      isInternal: true,
      fileIds: [],
    })
    // An internal note is not the clinic answering.
    expect(afterNote.awaitingFirstReply).toBe(true)

    const afterReply = await replyToTicket(staff, opened.id, {
      body: 'Sorted — sorry about that.',
      isInternal: false,
      fileIds: [],
    })
    expect(afterReply.awaitingFirstReply).toBe(false)
  })

  it('takes no more replies once it is closed', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)
    await updateTicket(staff, opened.id, { status: 'CLOSED' })

    expect(
      await outcome(
        replyToTicket(patient.actor, opened.id, {
          body: 'one more thing',
          isInternal: false,
          fileIds: [],
        }),
      ),
    ).toBe('TICKET_CLOSED')
  })
})

describe('triage', () => {
  it('assigns, prioritises and resolves — and emits on a new assignee', async () => {
    const staff = await staffActor()
    const colleague = await signedInActor({ role: 'staff' })
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)

    const assigned = await updateTicket(staff, opened.id, {
      assigneeId: colleague.user.id,
      priority: 'HIGH',
      status: 'IN_PROGRESS',
    })
    expect(assigned.assignee?.id).toBe(colleague.user.id)
    expect(assigned.priority).toBe('HIGH')

    const events = await OutboxEventModel()
      .find({ clinicId: clinicId(), eventName: 'ticket.assigned' })
      .lean()
    expect(
      events.some((row) => (row.payload as { ticketId?: string })?.ticketId === opened.id),
    ).toBe(true)

    const resolved = await updateTicket(staff, opened.id, { status: 'RESOLVED' })
    expect(resolved.resolvedAt).not.toBeNull()
  })

  it('is not a patient’s to do', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)

    expect(await outcome(updateTicket(patient.actor, opened.id, { priority: 'URGENT' }))).toBe(
      'FORBIDDEN',
    )
  })
})

describe('who sees which tickets', () => {
  it('shows a patient their own and nobody else’s', async () => {
    const staff = await staffActor()
    const mine = await patientActor(staff)
    const theirs = await patientActor(staff)

    const opened = await openTicket(mine.actor, TICKET)
    await openTicket(theirs.actor, { ...TICKET, subject: 'Something else entirely' })

    const visible = await everyPage((page) => listTickets(mine.actor, { view: 'all', ...page }))
    expect(visible.map((ticket) => ticket.id)).toEqual([opened.id])

    // And asking for somebody else's by id is a 404, not a 403 — a detail URL cannot be used
    // to learn what exists (13.2).
    expect(await outcome(getTicket(mine.actor, 'nonexistent'))).toBe('NOT_FOUND')
  })

  it('gives the clinic an inbox, their own queue, and the unassigned pile', async () => {
    const staff = await staffActor()
    const patient = await patientActor(staff)
    const opened = await openTicket(patient.actor, TICKET)

    const unassigned = await everyPage((page) =>
      listTickets(staff, { view: 'unassigned', ...page }),
    )
    expect(unassigned.map((ticket) => ticket.id)).toContain(opened.id)

    await updateTicket(staff, opened.id, { assigneeId: staff.userId })

    const mine = await everyPage((page) => listTickets(staff, { view: 'mine', ...page }))
    expect(mine.map((ticket) => ticket.id)).toContain(opened.id)

    const stillUnassigned = await everyPage((page) =>
      listTickets(staff, { view: 'unassigned', ...page }),
    )
    expect(stillUnassigned.map((ticket) => ticket.id)).not.toContain(opened.id)

    // The default inbox is everything the clinic still owes something on.
    await updateTicket(staff, opened.id, { status: 'CLOSED' })
    const inbox = await everyPage((page) => listTickets(staff, { view: 'open', ...page }))
    expect(inbox.map((ticket) => ticket.id)).not.toContain(opened.id)
  })
})

async function walk<T extends { id: string }>(
  fetchPage: (page: {
    cursor?: string
    limit: number
  }) => Promise<{ items: T[]; nextCursor: string | null }>,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = []
  let cursor: string | undefined
  let pages = 0
  for (;;) {
    const page = await fetchPage({ cursor, limit })
    pages += 1
    expect(page.items.length).toBeLessThanOrEqual(limit)
    ids.push(...page.items.map((item) => item.id))
    if (!page.nextCursor) return { ids, pages }
    // A page that offers a way on is full; a short page with a cursor sends a client to nothing.
    expect(page.items).toHaveLength(limit)
    cursor = page.nextCursor
  }
}

describe('paging through tickets', () => {
  it('reaches every ticket exactly once', async () => {
    const requester = await signedInActor({ role: 'patient' })
    const opened: string[] = []
    for (let index = 0; index < 5; index += 1) {
      opened.push(
        (await openTicket(requester.actor, { ...TICKET, subject: `Question ${index}` })).id,
      )
    }
    const { ids, pages } = await walk(
      (page) => listTickets(requester.actor, { view: 'all', ...page }),
      2,
    )
    expect(pages).toBe(3)
    expect([...ids].sort()).toEqual([...opened].sort())
  })

  it('refuses a cursor it did not make, rather than returning the first page again', async () => {
    const requester = await signedInActor({ role: 'patient' })
    await expect(
      listTickets(requester.actor, { view: 'all', cursor: 'not-a-cursor', limit: 2 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
