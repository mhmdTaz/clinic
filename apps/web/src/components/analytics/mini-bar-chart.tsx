export interface ChartPoint {
  label: string
  value: number
  /** What the tooltip and the accessible table show — money already formatted, not a raw number. */
  display: string
}

/**
 * A small bar chart, built from divs rather than a charting library.
 *
 * **The visible chart is `aria-hidden` and a real table carries the data.** A bar is a picture of
 * a number; a screen reader needs the number. Alt text on a chart ("revenue over time") describes
 * the genre, not the content, so the table is the accessible version rather than a fallback — and
 * it is also what a keyboard user reaches, and what survives printing.
 *
 * Negative bars are drawn below a baseline, because revenue net of refunds genuinely can be
 * negative on a quiet day with a large refund, and a chart that clamps that to zero is lying.
 */
export function MiniBarChart({
  points,
  caption,
  emptyLabel,
}: {
  points: readonly ChartPoint[]
  caption: string
  emptyLabel: string
}) {
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>
  }

  const peak = Math.max(...points.map((point) => Math.abs(point.value)))
  const hasNegative = points.some((point) => point.value < 0)
  // Everything zero: a flat baseline rather than a division by zero or a row of full-height bars.
  const scale = (value: number) => (peak === 0 ? 0 : (Math.abs(value) / peak) * 100)

  return (
    <>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="flex h-40 items-stretch gap-px overflow-x-auto">
          {points.map((point) => (
            <div
              key={point.label}
              title={`${point.label}: ${point.display}`}
              className="flex min-w-1 flex-1 flex-col justify-end"
            >
              {hasNegative ? (
                <div className="flex flex-1 flex-col justify-end">
                  <div
                    className="bg-primary/80 rounded-t-sm"
                    style={{ height: `${point.value > 0 ? scale(point.value) : 0}%` }}
                  />
                </div>
              ) : (
                <div
                  className="bg-primary/80 rounded-t-sm"
                  style={{ height: `${Math.max(scale(point.value), point.value > 0 ? 2 : 0)}%` }}
                />
              )}
              {hasNegative ? (
                <>
                  <div className="bg-border h-px w-full" />
                  <div className="flex flex-1 flex-col justify-start">
                    <div
                      className="bg-danger/70 rounded-b-sm"
                      style={{ height: `${point.value < 0 ? scale(point.value) : 0}%` }}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>{points[0]?.label}</span>
          {points.length > 1 ? <span>{points.at(-1)?.label}</span> : null}
        </div>
      </div>

      {/* The data itself. Collapsed visually, fully available to assistive technology. */}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** Hours, to one decimal place — minutes are how the data is stored, not how a person reads it. */
export function hours(minutes: number): string {
  return (Math.round((minutes / 60) * 10) / 10).toString()
}
