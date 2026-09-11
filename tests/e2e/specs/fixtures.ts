import { test as base, expect } from '@playwright/test'

/**
 * Every test's browser signs in from its own address (the server trusts X-Real-IP in the
 * e2e environment), so a rate-limit counter one test fills can never fail another.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    const octet = () => Math.floor(Math.random() * 254) + 1
    await context.setExtraHTTPHeaders({ 'x-real-ip': `198.51.${octet()}.${octet()}` })
    await use(context)
  },
})

export { expect }
