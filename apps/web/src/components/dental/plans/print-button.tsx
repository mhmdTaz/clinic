'use client'

import { Printer } from 'lucide-react'
import { Button } from '@clinic/ui'

/** Opens the browser's print dialog, where "Save as PDF" is one of the printers. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-4" />
      {label}
    </Button>
  )
}
