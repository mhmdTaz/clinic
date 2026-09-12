import { SLOT_GRID_MINUTES } from '@clinic/config'
import { addMinutes } from './zoned-time'

/**
 * The reservation grid (ADR-0013). One id per five-minute cell an appointment covers, built
 * from the doctor and the cell start so two bookings for the same cell collide on `_id`.
 */
export function gridCellIds(doctorId: string, startsAt: Date, endsAt: Date): string[] {
  const cells: string[] = []
  const first = floorToGrid(startsAt)
  for (let cursor = first; cursor < endsAt; cursor = addMinutes(cursor, SLOT_GRID_MINUTES)) {
    cells.push(`${doctorId}:${cursor.toISOString()}`)
  }
  return cells
}

export function floorToGrid(instant: Date): Date {
  const step = SLOT_GRID_MINUTES * 60_000
  return new Date(Math.floor(instant.getTime() / step) * step)
}

/** A duration the grid can hold exactly; anything else would reserve time it does not use. */
export function sitsOnGrid(startsAt: Date, durationMinutes: number): boolean {
  return (
    durationMinutes % SLOT_GRID_MINUTES === 0 &&
    startsAt.getTime() % (SLOT_GRID_MINUTES * 60_000) === 0
  )
}
