import { meshArrays } from './tooth-geometry'

/**
 * Sculpts one tooth per message, off the page's thread, and hands the arrays back without copying
 * them. Started and stopped by prepareGeometry in tooth-geometry.ts.
 */
self.onmessage = (
  event: MessageEvent<{ upper: boolean; primary: boolean; position: number; crownOnly: boolean }>,
) => {
  const { upper, primary, position, crownOnly } = event.data
  const arrays = meshArrays(upper, primary, position, crownOnly)
  const transfer = [
    arrays.positions.buffer,
    arrays.normals.buffer,
    arrays.colors.buffer,
    arrays.density.buffer,
  ]
  ;(
    self as unknown as { postMessage(message: unknown, transfer: ArrayBuffer[]): void }
  ).postMessage(arrays, transfer as ArrayBuffer[])
}
