'use client'

import { Fragment, useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button, Input, Select, cn } from '@clinic/ui'
import { EmptyState } from '@/components/portal/empty-state'
import { ExportCsvButton } from './export-csv-button'
import { useRouter } from '@/lib/navigation/use-router'

export interface DataTableColumn {
  id: string
  header: string
  /**
   * 1 and 2 always show in the table; 3 is hidden from 768 to 1024px (section 14.4). Below 768px
   * rows become cards and every column shows, the first as the card's title.
   */
  priority?: 1 | 2 | 3
  align?: 'start' | 'end'
}

export interface DataTableRow {
  id: string
  href?: string
  /** Pre-rendered on the server, one entry per column id. */
  cells: Readonly<Record<string, ReactNode>>
}

export interface DataTableFilter {
  param: string
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
}

/**
 * A date range, as two search parameters.
 *
 * Two `<input type="date">` rather than a calendar widget: it is keyboard-navigable and
 * screen-reader-correct for free, it accepts typing, and it is the control somebody answering
 * "what happened last Tuesday" already knows how to use.
 */
export interface DataTableDateRange {
  fromParam: string
  toParam: string
  from: string
  to: string
  fromLabel: string
  toLabel: string
  /** Nothing later than today: the audit log has no future. */
  max?: string
}

/**
 * CSV export (section 14.3 — "arrives with the audit log explorer, the first screen that needs it").
 *
 * The endpoint returns the file **inside the API envelope** rather than as a `text/csv` body, so
 * the download goes through the same authenticated fetch as every other call and the server-side
 * audit entry is written on the same path. The browser turns the string into a file here.
 */
export interface DataTableExport {
  /** Path only; the component appends the current search parameters. */
  href: string
  label: string
}

const INTERACTIVE = 'a, button, input, select, textarea, label'

/**
 * The list screen (section 14.3). The rows are fetched on the server from the address's search
 * parameters; this component owns only what the person does with them. The address is the state,
 * so a filtered view survives a refresh and can be shared, and back/forward move through searches.
 */
export function DataTable({
  label,
  columns,
  rows,
  search,
  filters = [],
  dateRange,
  exportCsv,
  isFiltered = false,
  nextCursor = null,
  empty,
}: {
  label: string
  columns: readonly DataTableColumn[]
  rows: readonly DataTableRow[]
  search?: { placeholder: string; value: string }
  filters?: readonly DataTableFilter[]
  dateRange?: DataTableDateRange
  exportCsv?: DataTableExport
  /**
   * For a page that narrows by search parameters this component knows nothing about — the audit
   * explorer's entity and action, for instance. Without it an empty result says "nothing recorded
   * yet", which reads as "the audit log is empty" when it is merely filtered to nothing.
   */
  isFiltered?: boolean
  nextCursor?: string | null
  empty: { title: string; body?: string; action?: ReactNode }
}) {
  const t = useTranslations('dataTable')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const searchId = useId()

  const urlQuery = search?.value ?? ''
  const [query, setQuery] = useState(urlQuery)
  const pushed = useRef(urlQuery)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When the address changes from outside — back, forward, a link — the search box follows.
  useEffect(() => {
    if (urlQuery !== pushed.current) {
      pushed.current = urlQuery
      setQuery(urlQuery)
    }
  }, [urlQuery])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    // A different search or filter starts again from the first page.
    if (!('cursor' in changes)) next.delete('cursor')
    const target = next.size > 0 ? `${pathname}?${next.toString()}` : pathname
    startTransition(() => router.replace(target, { scroll: false }))
  }

  function onSearch(value: string) {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const trimmed = value.trim()
      if (trimmed === pushed.current) return
      pushed.current = trimmed
      navigate({ q: trimmed || null })
    }, 300)
  }

  const onFirstPage = !params.has('cursor')
  const filtered =
    isFiltered ||
    urlQuery !== '' ||
    filters.some((filter) => params.has(filter.param)) ||
    (dateRange !== undefined && (params.has(dateRange.fromParam) || params.has(dateRange.toParam)))
  const [firstColumn, ...otherColumns] = columns
  const alignment = (column: DataTableColumn) =>
    column.align === 'end' ? 'text-end' : 'text-start'

  return (
    <div className="flex flex-col gap-4">
      {search || filters.length > 0 || dateRange || exportCsv ? (
        <div role="search" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {search ? (
            <div className="relative min-w-0 flex-1 sm:min-w-64">
              <label htmlFor={searchId} className="sr-only">
                {search.placeholder}
              </label>
              <Search
                className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                id={searchId}
                type="search"
                value={query}
                placeholder={search.placeholder}
                onChange={(event) => onSearch(event.target.value)}
                className="ps-9"
              />
            </div>
          ) : null}
          {filters.map((filter) => (
            <div key={filter.param} className="flex flex-col gap-1 sm:w-52">
              <label
                htmlFor={`${searchId}-${filter.param}`}
                className="text-muted-foreground text-xs font-medium"
              >
                {filter.label}
              </label>
              <Select
                id={`${searchId}-${filter.param}`}
                value={filter.value}
                onChange={(event) => navigate({ [filter.param]: event.target.value })}
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {dateRange ? (
            <>
              <div className="flex flex-col gap-1 sm:w-44">
                <label
                  htmlFor={`${searchId}-${dateRange.fromParam}`}
                  className="text-muted-foreground text-xs font-medium"
                >
                  {dateRange.fromLabel}
                </label>
                <Input
                  id={`${searchId}-${dateRange.fromParam}`}
                  type="date"
                  value={dateRange.from}
                  max={dateRange.to || dateRange.max}
                  onChange={(event) =>
                    navigate({ [dateRange.fromParam]: event.target.value || null })
                  }
                />
              </div>
              <div className="flex flex-col gap-1 sm:w-44">
                <label
                  htmlFor={`${searchId}-${dateRange.toParam}`}
                  className="text-muted-foreground text-xs font-medium"
                >
                  {dateRange.toLabel}
                </label>
                <Input
                  id={`${searchId}-${dateRange.toParam}`}
                  type="date"
                  value={dateRange.to}
                  min={dateRange.from || undefined}
                  max={dateRange.max}
                  onChange={(event) =>
                    navigate({ [dateRange.toParam]: event.target.value || null })
                  }
                />
              </div>
            </>
          ) : null}
          {exportCsv ? (
            <ExportCsvButton
              href={exportCsv.href}
              label={exportCsv.label}
              params={params.toString()}
            />
          ) : null}
        </div>
      ) : null}

      <div aria-busy={pending} className={cn('transition-opacity', pending && 'opacity-60')}>
        {pending ? (
          <p role="status" className="sr-only">
            {t('updating')}
          </p>
        ) : null}

        {rows.length === 0 || !firstColumn ? (
          <EmptyState
            title={filtered ? t('emptyFilteredTitle') : empty.title}
            body={filtered ? t('emptyFilteredBody') : empty.body}
            action={filtered ? undefined : empty.action}
          />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <caption className="sr-only">{label}</caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-xs">
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      className={cn(
                        'py-2 pe-4 font-medium last:pe-0',
                        alignment(column),
                        column.priority === 3 && 'hidden lg:table-cell',
                      )}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(row.href && 'hover:bg-muted/60 cursor-pointer')}
                    onClick={(event) => {
                      // The name is a real link for keyboards and screen readers; the rest of
                      // the row is a larger target for a mouse.
                      if (!row.href || (event.target as HTMLElement).closest(INTERACTIVE)) return
                      router.push(row.href)
                    }}
                  >
                    {columns.map((column, index) => (
                      <td
                        key={column.id}
                        className={cn(
                          'py-3 pe-4 align-top last:pe-0',
                          alignment(column),
                          column.priority === 3 && 'hidden lg:table-cell',
                        )}
                      >
                        {index === 0 && row.href ? (
                          <Link href={row.href} className="font-medium hover:underline">
                            {row.cells[column.id]}
                          </Link>
                        ) : (
                          row.cells[column.id]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <ul aria-label={label} className="flex flex-col gap-3 md:hidden">
              {rows.map((row) => {
                const content = (
                  <>
                    <div className="font-medium">{row.cells[firstColumn.id]}</div>
                    {otherColumns.length > 0 ? (
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        {otherColumns.map((column) => (
                          <Fragment key={column.id}>
                            <dt className="text-muted-foreground">{column.header}</dt>
                            <dd className="min-w-0 break-words">{row.cells[column.id]}</dd>
                          </Fragment>
                        ))}
                      </dl>
                    ) : null}
                  </>
                )
                return (
                  <li key={row.id}>
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="border-border bg-card hover:bg-muted/40 block rounded-[var(--radius-card)] border p-4"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="border-border bg-card rounded-[var(--radius-card)] border p-4">
                        {content}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      {!onFirstPage || nextCursor ? (
        <nav aria-label={t('pagination')} className="flex items-center justify-between gap-3">
          {onFirstPage ? (
            <span />
          ) : (
            <Button variant="outline" size="sm" onClick={() => navigate({ cursor: null })}>
              {t('firstPage')}
            </Button>
          )}
          {nextCursor ? (
            <Button variant="outline" size="sm" onClick={() => navigate({ cursor: nextCursor })}>
              {t('nextPage')}
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
