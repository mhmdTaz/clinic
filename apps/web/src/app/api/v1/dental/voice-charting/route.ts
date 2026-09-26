import { SetVoiceChartingRequest } from '@clinic/contracts'
import { setVoiceCharting } from '@clinic/core/dental'
import { withApi } from '@/lib/api/with-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Turn voice charting on or off for the clinic (ADR-0037). On requires `acknowledged: true` — the
 * administrator has read that the browser's speech service may send the audio away.
 */
export const PUT = withApi(
  { permission: 'dental:configure', body: SetVoiceChartingRequest },
  async ({ actor, body }) => ({ data: await setVoiceCharting(actor, body) }),
)
