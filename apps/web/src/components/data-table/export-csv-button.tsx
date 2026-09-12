'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button, Spinner } from '@clinic/ui'

/**
 * Downloading the current view as CSV (section 14.3).
 *
 * It fetches rather than navigating, for three reasons that all matter:
 *
 *  - the endpoint returns the API envelope, so the same error shape and the same request id
 *    apply as everywhere else;
 *  - a navigation would leave the page, and an export that fails would replace the table with a
 *    JSON error — the worst possible response to "I clicked download";
 *  - the server writes an `audit.exported` entry on this exact request, so a download that never
 *    reached the browser is still a download that was authorised, and the log says so.
 *
 * The object URL is revoked afterwards: a blob held open is a copy of the audit log sitting in
 * the tab's memory for as long as it stays open.
 */
/**
 * A UTF-8 byte-order mark, written as an escape so it is visible in the source.
 *
 * Without it Excel reads a UTF-8 CSV as the system codepage, turning every accented name and
 * every em dash in the diff column into mojibake — on the one file whose entire purpose is
 * being opened by somebody else.
 */
const BOM = '\uFEFF'

export function ExportCsvButton({
  href,
  label,
  params,
}: {
  href: string
  label: string
  params: string
}) {
  const t = useTranslations('dataTable')
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')

  async function download() {
    setState('working')
    try {
      // `cursor` belongs to the on-screen page; an export is of the whole filtered range.
      const search = new URLSearchParams(params)
      search.delete('cursor')
      const url = search.size > 0 ? `${href}?${search.toString()}` : href

      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const payload = (await response.json()) as {
        data?: { filename: string; csv: string; rows: number }
      }
      if (!response.ok || !payload.data) throw new Error('export failed')

      const blob = new Blob([BOM, payload.data.csv], { type: 'text/csv;charset=utf-8' })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = payload.data.filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={() => void download()}
        disabled={state === 'working'}
      >
        {state === 'working' ? (
          <Spinner className="size-4" />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {label}
      </Button>
      {state === 'failed' ? (
        <p role="alert" className="text-danger text-xs">
          {t('exportFailed')}
        </p>
      ) : null}
    </div>
  )
}
