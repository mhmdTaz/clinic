import { cache } from 'react'
import { processSingleton } from '@clinic/config'
import { provideContextResolver, type RequestContext } from '@clinic/core'

/**
 * Who is acting, for the length of one server render (section 11.2).
 *
 * A route handler wraps its work in `runWithContext` and the ambient actor is scoped exactly. A
 * **server component cannot**: the page resolves its actor in a helper and then renders, and there
 * is no callback around the render to wrap. Everything the page then calls — `getPatient`,
 * `listInvoices`, the audit explorer itself — would run with no ambient context, and every entry
 * the capture plugin wrote would say `actor: null`. For a system whose first question is "who
 * viewed this patient's file", that is the log failing at the one thing it exists for.
 *
 * `cache()` is React's per-request memoisation, so the holder below is one object per request and
 * the same object to every layout, page and nested component in that render. Writing into it is a
 * request-scoped variable — which is exactly what is needed, and what `AsyncLocalStorage` cannot
 * give across an `await` that returns to a caller whose context never had the store.
 *
 * **The `cache()` wrapper is held process-wide, and that is not incidental.** Next bundles
 * `instrumentation.ts` separately from the page bundles, so this module exists more than once in
 * the running server. Each copy calling `cache()` for itself produces a *different* memoisation
 * key: the copy that stored the context and the copy that read it would look at two different
 * objects, the resolver would find nothing, and every page-rendered audit entry would silently go
 * back to having no actor — which is precisely the bug this file exists to fix, wearing a
 * disguise. One holder, shared through the process, removes the question.
 */
const holder = processSingleton('web:request-scope', () =>
  cache((): { context: RequestContext | undefined } => ({ context: undefined })),
)

/** Called once the request's actor is known, before the page renders anything. */
export function setRequestContext(context: RequestContext): void {
  holder().context = context
}

/**
 * Registered on import rather than from a startup hook, for the same reason the holder is shared:
 * whichever copy of this module a request goes through, it must be the one core asks.
 *
 * Calling the holder outside a request throws in React, which is correct but must never propagate
 * out of an audit write: a background write with no request is anonymous, not broken.
 */
provideContextResolver(() => {
  try {
    return holder().context
  } catch {
    return undefined
  }
})

/** Kept so `instrumentation.ts` has something to import, which is what loads this module early. */
export function installRequestContextResolver(): void {
  // The registration above already ran on import. This exists so the startup hook has a named
  // reason to pull the module in before the first request rather than during one.
}
