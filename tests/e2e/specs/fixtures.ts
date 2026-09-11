import { test as base, expect } from '@playwright/test'
import { randomAddress } from '../helpers/session'

/**
 * Every test's browser signs in from its own address (the server trusts X-Real-IP in the
 * e2e environment), so a rate-limit counter one test fills can never fail another.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'x-real-ip': randomAddress() })
    await use(context)
  },
})

export { expect }
