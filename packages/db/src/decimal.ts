import { Types } from 'mongoose'

/**
 * A decimal string as the BSON type the server can do arithmetic on.
 *
 * Mongoose casts strings to Decimal128 on a normal write, but an aggregation-pipeline update
 * is sent to the server as raw BSON with no schema applied — a string literal there would be
 * added to a Decimal128 and the server would refuse, or worse, coerce. Every literal inside a
 * pipeline update has to be built here (section 9.2).
 */
export const decimal128 = (value: string): Types.Decimal128 => Types.Decimal128.fromString(value)
