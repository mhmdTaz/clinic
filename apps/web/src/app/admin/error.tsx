'use client'

import { SegmentError } from '@/components/portal/segment-error'

export default function AdminPageError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <SegmentError reset={reset} />
}
