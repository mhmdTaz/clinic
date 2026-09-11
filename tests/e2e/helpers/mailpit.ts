import { E2E } from '../e2e.env'

interface MessageSummary {
  ID: string
  Subject: string
  Created: string
}

const LINK = /https?:\/\/\S+#token=[A-Za-z0-9_-]+/

/**
 * The link from the newest email to `address` whose subject contains `subject`. Polls,
 * because password-reset emails are sent after the response on purpose.
 */
export async function linkFromLatestEmail(
  address: string,
  subject: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:"${address}" subject:"${subject}"`)
    const search = await fetch(`${E2E.mailpitApi}/search?query=${query}`)
    const { messages = [] } = (await search.json()) as { messages?: MessageSummary[] }
    const newest = [...messages].sort((a, b) => b.Created.localeCompare(a.Created))[0]

    if (newest) {
      const message = (await (await fetch(`${E2E.mailpitApi}/message/${newest.ID}`)).json()) as {
        Text?: string
      }
      const link = message.Text?.match(LINK)?.[0]
      if (link) return link
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  throw new Error(`No email to ${address} with a subject containing "${subject}" arrived in time`)
}
