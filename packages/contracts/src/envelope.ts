import { z } from 'zod'

/**
 * The response envelope every endpoint uses (section 9.2). `code` is stable and
 * safe to switch on; `message` is for humans and may change.
 */
export const ResponseMeta = z.object({
  requestId: z.string(),
  nextCursor: z.string().nullish(),
  hasMore: z.boolean().optional(),
})
export type ResponseMeta = z.infer<typeof ResponseMeta>

export const ApiErrorBody = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(z.object({ field: z.string(), issue: z.string() })).optional(),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>

export const ErrorResponse = z.object({ error: ApiErrorBody, meta: ResponseMeta })
export type ErrorResponse = z.infer<typeof ErrorResponse>

export function successResponse<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: ResponseMeta })
}

export function collectionResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: ResponseMeta })
}

/** Cursor pagination, capped so no endpoint can be asked for an unbounded page. */
export const PaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})
export type PaginationQuery = z.infer<typeof PaginationQuery>
