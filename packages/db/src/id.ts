import { createId, isCuid } from '@paralleldrive/cuid2'

/**
 * Document ids are cuid2 strings, not ObjectIds (section 8.3).
 *
 * An ObjectId embeds a timestamp and a monotonic counter, which makes ids partially
 * guessable and leaks record volume — unacceptable on a patient identifier that
 * appears in a URL. A string id also lets a mobile client generate ids offline.
 *
 * The trade: `_id` no longer sorts by creation time, so cursor pagination uses a
 * compound { createdAt, _id } cursor.
 */
export const newId = (): string => createId()

/**
 * A cheap sanity check, not a security control.
 *
 * cuid2's own isCuid() only asserts "2-32 lowercase alphanumerics", which a 24-char
 * hex ObjectId string also satisfies. We additionally pin the default cuid2 shape:
 * exactly 24 characters, first one a letter. A hex string beginning a-f is still
 * indistinguishable from a cuid and always will be — that is inherent, not a gap to
 * paper over. Authorisation never depends on this; it only catches malformed input
 * early with a clearer message than the driver would give.
 */
const CUID2_SHAPE = /^[a-z][0-9a-z]{23}$/

export const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && CUID2_SHAPE.test(value) && isCuid(value)

/** Mongoose field definition shared by every model. */
export const idField = { type: String, default: newId } as const
