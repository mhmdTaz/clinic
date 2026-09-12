import type { DoctorUtilisation } from '@clinic/contracts'
import { hours } from './mini-bar-chart'

/**
 * Utilisation, doctor by doctor (A8).
 *
 * The bar is decoration; the percentage beside it is the information, so the bar is `aria-hidden`
 * and the number is plain text. A doctor with no roster shows "not rostered" rather than 0% —
 * "we never scheduled them" and "we scheduled them and they sat idle" are different findings,
 * and only one of them is a problem.
 */
export function DoctorUtilisationTable({
  rows,
  labels,
}: {
  rows: readonly DoctorUtilisation[]
  labels: {
    caption: string
    doctor: string
    appointments: string
    booked: string
    rostered: string
    utilisation: string
    notRostered: string
    empty: string
  }
}) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{labels.empty}</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{labels.caption}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-xs">
            <th scope="col" className="py-2 pe-4 text-start font-medium">
              {labels.doctor}
            </th>
            <th scope="col" className="py-2 pe-4 text-end font-medium">
              {labels.appointments}
            </th>
            <th scope="col" className="py-2 pe-4 text-end font-medium">
              {labels.booked}
            </th>
            <th scope="col" className="py-2 pe-4 text-end font-medium">
              {labels.rostered}
            </th>
            <th scope="col" className="py-2 text-start font-medium">
              {labels.utilisation}
            </th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr key={row.doctorId}>
              <th scope="row" className="py-3 pe-4 text-start font-medium break-words">
                {row.name}
              </th>
              <td className="py-3 pe-4 text-end tabular-nums">{row.appointments}</td>
              <td className="py-3 pe-4 text-end tabular-nums">{hours(row.bookedMinutes)}</td>
              <td className="py-3 pe-4 text-end tabular-nums">{hours(row.availableMinutes)}</td>
              <td className="py-3">
                {row.utilisationPercent === null ? (
                  <span className="text-muted-foreground">{labels.notRostered}</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="bg-muted h-2 w-24 shrink-0 overflow-hidden rounded-full"
                    >
                      <span
                        className="bg-primary block h-full rounded-full"
                        style={{ width: `${Math.min(row.utilisationPercent, 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{row.utilisationPercent}%</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
