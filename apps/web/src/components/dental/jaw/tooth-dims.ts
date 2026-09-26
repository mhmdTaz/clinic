/**
 * How big each tooth is, in millimetres, and what kind it is. Kept apart from the meshes so the 2D
 * chart can draw to the same proportions without pulling three.js into the page.
 */

export type ToothKind = 'inc' | 'can' | 'pre' | 'mol'

/** [width, depth, crown height, root length] in millimetres, by jaw and position. */
export type Dims = readonly [number, number, number, number]

const PERMANENT: Record<'u' | 'l', Record<number, Dims>> = {
  u: {
    1: [8.5, 7, 10.5, 13],
    2: [6.5, 6, 9, 13],
    3: [7.5, 8, 10, 17],
    4: [7, 9, 8.5, 14],
    5: [6.5, 9, 7.5, 14],
    6: [10, 11, 7.5, 13],
    7: [9, 11, 7, 12],
    8: [8.5, 10, 6.5, 11],
  },
  l: {
    1: [5.3, 5.8, 9, 12.5],
    2: [5.9, 6.2, 9.5, 14],
    3: [7, 7.5, 11, 16],
    4: [7, 7.5, 8.5, 14],
    5: [7, 8, 8, 14.5],
    6: [11, 10.5, 7.5, 14],
    7: [10.5, 10, 7, 13],
    8: [10, 9.5, 6.5, 11],
  },
}

/** Primary teeth: smaller, whiter, and the back two are molars rather than premolars. */
const PRIMARY: Record<'u' | 'l', Record<number, Dims>> = {
  u: {
    1: [6.5, 5, 6, 10],
    2: [5.2, 4, 5.6, 11],
    3: [7, 7, 6.5, 13],
    4: [7.3, 9, 5.2, 10],
    5: [8.2, 10, 5.7, 11],
  },
  l: {
    1: [4.2, 4, 5, 9],
    2: [4.7, 4.2, 5.2, 10],
    3: [5, 5.5, 6, 11],
    4: [7.7, 7, 6, 10],
    5: [9.9, 8.7, 5.5, 11],
  },
}

export function dimsOf(upper: boolean, primary: boolean, position: number): Dims {
  return (primary ? PRIMARY : PERMANENT)[upper ? 'u' : 'l'][position]!
}

export function kindOf(primary: boolean, position: number): ToothKind {
  if (position <= 2) return 'inc'
  if (position === 3) return 'can'
  if (primary) return 'mol'
  return position <= 5 ? 'pre' : 'mol'
}
