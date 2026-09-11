'use client'

import { SegmentError } from '@/components/portal/segment-error'

export default function StaffPageError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <SegmentError reset={reset} />
}
