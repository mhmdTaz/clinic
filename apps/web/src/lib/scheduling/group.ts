import { localDateIn, type AppointmentSummary } from '@clinic/contracts'

/**
 * Grouping for the calendar's columns. The list arrives from the server in time order, so each
 * group keeps that order without sorting again.
 *
 * A day is the clinic's day (ADR-0010): an appointment at 23:30 Beirut belongs to that evening's
 * column even where the server, the browser and UTC would each call it a different date.
 */
export function groupByDate(
  appointments: readonly AppointmentSummary[],
  dates: readonly string[],
  timeZone: string,
): Array<{ date: string; items: AppointmentSummary[] }> {
  const columns = dates.map((date) => ({ date, items: [] as AppointmentSummary[] }))
  const byDate = new Map(columns.map((column) => [column.date, column.items]))
  for (const appointment of appointments) {
    byDate.get(localDateIn(timeZone, new Date(appointment.startsAt)))?.push(appointment)
  }
  return columns
}

/** One column per doctor who has something that day — never an empty column per doctor on file. */
export function groupByDoctor(
  appointments: readonly AppointmentSummary[],
): Array<{ id: string; name: string; items: AppointmentSummary[] }> {
  const columns = new Map<string, { id: string; name: string; items: AppointmentSummary[] }>()
  for (const appointment of appointments) {
    const column = columns.get(appointment.doctor.id) ?? {
      id: appointment.doctor.id,
      name: appointment.doctor.name,
      items: [],
    }
    column.items.push(appointment)
    columns.set(column.id, column)
  }
  return [...columns.values()].sort((a, b) => a.name.localeCompare(b.name))
}
