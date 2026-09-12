import { EyeOff } from 'lucide-react'
import { Fragment } from 'react'
import type { AuditFieldChange } from '@clinic/contracts'

/**
 * The side-by-side field diff (A5, section 11.6).
 *
 * A real table rather than two floated columns, because the pairing *is* the information: a
 * screen reader announcing "status, before ACTIVE, after SUSPENDED" is the same sentence a
 * sighted reader gets from the two columns. Below `sm` it stacks into labelled rows rather than
 * squeezing three columns onto a phone, so the before and after stay legible.
 *
 * Colour is never the only signal (14.5): the before is struck through and the after is bold, so
 * the direction of a change survives a monochrome print and colour-blindness alike.
 */
export function FieldDiff({
  changes,
  labels,
}: {
  changes: readonly AuditFieldChange[]
  labels: {
    field: string
    before: string
    after: string
    redacted: string
    empty: string
    caption: string
  }
}) {
  if (changes.length === 0) {
    // Plenty of entries record an act rather than a change — a sign-in, a view, a download.
    return <p className="text-muted-foreground text-sm">{labels.empty}</p>
  }

  return (
    <>
      <table className="hidden w-full text-sm sm:table">
        <caption className="sr-only">{labels.caption}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-xs">
            <th scope="col" className="w-1/4 py-2 pe-4 text-start font-medium">
              {labels.field}
            </th>
            <th scope="col" className="py-2 pe-4 text-start font-medium">
              {labels.before}
            </th>
            <th scope="col" className="py-2 text-start font-medium">
              {labels.after}
            </th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {changes.map((change) => (
            <tr key={change.field}>
              {/* A field path is an identifier: `patient.bloodType` must not reorder. */}
              <th
                scope="row"
                dir="ltr"
                className="py-3 pe-4 text-start align-top font-medium break-words"
              >
                {change.field}
              </th>
              <td className="py-3 pe-4 align-top">
                <Value
                  value={change.before}
                  redacted={change.isRedacted}
                  label={labels.redacted}
                  side="before"
                />
              </td>
              <td className="py-3 align-top">
                <Value
                  value={change.after}
                  redacted={change.isRedacted}
                  label={labels.redacted}
                  side="after"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="flex flex-col gap-4 sm:hidden">
        {changes.map((change) => (
          <Fragment key={change.field}>
            <dt dir="ltr" className="text-sm font-medium break-words">
              {change.field}
            </dt>
            <dd className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{labels.before}</span>
              <Value
                value={change.before}
                redacted={change.isRedacted}
                label={labels.redacted}
                side="before"
              />
              <span className="text-muted-foreground mt-1 text-xs">{labels.after}</span>
              <Value
                value={change.after}
                redacted={change.isRedacted}
                label={labels.redacted}
                side="after"
              />
            </dd>
          </Fragment>
        ))}
      </dl>
    </>
  )
}

function Value({
  value,
  redacted,
  label,
  side,
}: {
  value: string | null
  redacted: boolean
  label: string
  side: 'before' | 'after'
}) {
  if (redacted) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <EyeOff className="size-3.5" aria-hidden="true" />
        {label}
      </span>
    )
  }

  // An empty cell would read as "no data here". An em dash with a label says the field was empty.
  if (value === null) return <span className="text-muted-foreground text-sm">—</span>

  return (
    <span
      // A stored value is data in whatever script it was typed. `auto` reads the direction from
      // the value itself, so an Arabic name and an English one both render the right way round
      // on the same page.
      dir="auto"
      className={
        side === 'before'
          ? 'text-muted-foreground text-sm break-words line-through'
          : 'text-sm font-medium break-words'
      }
    >
      {value}
    </span>
  )
}
