import { NextResponse } from 'next/server'
import { openApiDocument } from '@/lib/api/openapi/document'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The OpenAPI document (§9.1), for an integrator with no access to the contracts package.
 *
 * Served bare rather than in the response envelope, because tools read it as a document. Public:
 * it describes the shape of the API, and every operation in it still checks who is asking.
 */
export function GET() {
  return NextResponse.json(openApiDocument(), {
    headers: { 'cache-control': 'public, max-age=300' },
  })
}
