import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import { dimsOf, kindOf, type ToothKind } from './tooth-dims'

/**
 * Sculpted teeth (Phase 11). Each tooth is a signed-distance function in millimetres — a crown
 * blended out of rounded shapes, cusps and fissures cut into it, roots grown from its neck — turned
 * into a mesh by marching cubes. Nothing is downloaded: there is no licence to track, and every
 * tooth knows its FDI number from where it sits, not from a name in a model file.
 *
 * The meshes are built once per page load and shared by every tooth of the same kind; the work
 * is spread over animation frames so the page stays responsive while it happens.
 */

export interface ToothSpec {
  upper: boolean
  primary: boolean
  position: number
  kind: ToothKind
  W: number
  D: number
  CH: number
  RL: number
  roots: Root[]
  f: (x: number, y: number, z: number) => number
}

/** A root: from, to, radius at the neck, radius at the apex, and how flattened it is side to side. */
type Root = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  number,
  number,
  number,
]

const sm = (a: number, b: number, x: number) => {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)
const L3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z)

function ell(x: number, y: number, z: number, a: number, b: number, c: number) {
  const k0 = L3(x / a, y / b, z / c)
  const k1 = L3(x / (a * a), y / (b * b), z / (c * c))
  return k1 < 1e-9 ? -Math.min(a, b, c) : (k0 * (k0 - 1)) / k1
}

function rbox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number) {
  const qx = Math.abs(x) - bx + r
  const qy = Math.abs(y) - by + r
  const qz = Math.abs(z) - bz + r
  return (
    L3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r
  )
}

function cone(
  x: number,
  y: number,
  z: number,
  a: readonly number[],
  b: readonly number[],
  r1: number,
  r2: number,
) {
  const bx = b[0]! - a[0]!
  const by = b[1]! - a[1]!
  const bz = b[2]! - a[2]!
  const l2 = bx * bx + by * by + bz * bz
  let h = ((x - a[0]!) * bx + (y - a[1]!) * by + (z - a[2]!) * bz) / l2
  h = h < 0 ? 0 : h > 1 ? 1 : h
  return L3(x - a[0]! - bx * h, y - a[1]! - by * h, z - a[2]! - bz * h) - (r1 + (r2 - r1) * h)
}

export function specOf(upper: boolean, primary: boolean, position: number): ToothSpec {
  const [W, D, CH, RL] = dimsOf(upper, primary, position)
  const kind = kindOf(primary, position)
  let roots: Root[]
  let f: ToothSpec['f']

  const rootsD = (x: number, y: number, z: number) => {
    let d = 1e9
    for (const r of roots) {
      const xs = r[4]
      d = smin(
        d,
        cone(
          x * xs,
          y,
          z,
          [r[0][0] * xs, r[0][1], r[0][2]],
          [r[1][0] * xs, r[1][1], r[1][2]],
          r[2],
          r[3],
        ),
        1.0,
      )
    }
    return d
  }

  if (kind === 'inc' || kind === 'can') {
    roots = [[[0, 2, 0], [0, -RL, -0.4], 0.36 * D, 0.55, 1.25]]
    f = (x, y, z) => {
      const tp = 1 - (kind === 'inc' ? 0.72 : 0.5) * sm(0.25 * CH, CH, y)
      const wd = 0.78 + 0.22 * sm(0, 0.55 * CH, y)
      let c = ell(x / wd, y - 0.5 * CH, z / tp, W / 2, 0.62 * CH, D / 2) * Math.min(wd, tp)
      c = smax(c, kind === 'inc' ? y - CH : y - (CH - 0.42 * Math.abs(x)), 0.8)
      if (position === 2) c = smax(c, 0.45 * Math.abs(x) + y - (CH + 0.4), 1.2)
      c = smax(c, -ell(x, y - 0.6 * CH, z + D * 0.5 * tp + 0.8, W * 0.27, CH * 0.26, 1.3), 0.7)
      c = smin(c, ell(x, y - 0.2 * CH, z + D * 0.33, W * 0.24, CH * 0.2, D * 0.2), 1.0)
      return smin(c, rootsD(x, y, z), 2.0)
    }
  } else if (kind === 'pre') {
    const two = upper && position === 4
    roots = two
      ? [
          [[0, 1, 0.18 * D], [0.3, -RL, 0.3 * D], 0.24 * D, 0.45, 1.5],
          [[0, 1, -0.18 * D], [0.3, -RL * 0.95, -0.3 * D], 0.24 * D, 0.45, 1.5],
        ]
      : [[[0, 2, 0], [0.3, -RL, 0], 0.3 * D, 0.5, 1.5]]
    const lh = upper ? 0.95 : 0.8
    f = (x, y, z) => {
      const nw = 0.8 + 0.2 * sm(0, 0.5 * CH, y)
      let c =
        ell(x / nw, y - 0.45 * CH, z / (0.88 + 0.12 * sm(0, 0.5 * CH, y)), W / 2, 0.6 * CH, D / 2) *
        nw
      c = smax(c, y - 0.78 * CH, 1.0)
      c = smin(c, ell(x, y - 0.8 * CH, z - 0.24 * D, W * 0.36, 0.26 * CH, D * 0.24), 1.0)
      c = smin(
        c,
        ell(x, y - (0.8 - (1 - lh) * 0.4) * CH, z + 0.24 * D, W * 0.32, 0.24 * CH * lh, D * 0.22),
        1.0,
      )
      c = smax(c, -smax(Math.hypot(y - 0.99 * CH, z) - 0.5, Math.abs(x) - W * 0.3, 0.4), 0.5)
      return smin(c, rootsD(x, y, z), 1.8)
    }
  } else {
    roots = upper
      ? [
          [[0.22 * W, 1, 0.22 * D], [0.3 * W, -RL, 0.34 * D], 0.17 * D, 0.5, 1.2],
          [[-0.22 * W, 1, 0.22 * D], [-0.28 * W, -RL * 0.9, 0.32 * D], 0.16 * D, 0.5, 1.2],
          [[0, 1, -0.2 * D], [0, -RL * 1.02, -0.42 * D], 0.2 * D, 0.6, 1],
        ]
      : [
          [[0.25 * W, 1, 0], [0.3 * W, -RL, 0], 0.3 * D, 0.5, 2.2],
          [[-0.25 * W, 1, 0], [-0.32 * W, -RL * 0.92, 0], 0.28 * D, 0.5, 2.2],
        ]
    const cusps: ReadonlyArray<readonly [number, number, number]> = upper
      ? [
          [0.24, 0.22, 1],
          [-0.24, 0.22, 0.9],
          [0.22, -0.22, 1.08],
          [-0.26, -0.2, 0.75],
        ]
      : position === 6 && !primary
        ? [
            [0.3, 0.22, 1],
            [0, 0.25, 0.95],
            [-0.32, 0.18, 0.8],
            [0.25, -0.22, 1.05],
            [-0.24, -0.22, 1],
          ]
        : [
            [0.24, 0.22, 1],
            [-0.24, 0.22, 0.95],
            [0.24, -0.22, 1.05],
            [-0.24, -0.22, 1],
          ]
    f = (x, y, z) => {
      const sh = 0.84 + 0.16 * sm(0, 0.45 * CH, y) - 0.1 * sm(0.5 * CH, CH, y)
      let c =
        rbox(x / sh, y - 0.4 * CH, z / sh, W / 2, 0.34 * CH, D / 2, Math.min(W, D) * 0.34) * sh
      c = smax(c, y - 0.7 * CH, 1.0)
      for (const q of cusps) {
        c = smin(
          c,
          ell(
            x - q[0] * W,
            y - (0.7 + 0.08 * q[2]) * CH,
            z - q[1] * D,
            W * 0.22,
            0.3 * CH * q[2],
            D * 0.22,
          ),
          1.3,
        )
      }
      c = smax(c, -smax(Math.hypot(y - 0.98 * CH, z) - 0.55, Math.abs(x) - W * 0.34, 0.4), 0.35)
      c = smax(c, -smax(Math.hypot(y - 0.98 * CH, x) - 0.5, Math.abs(z) - D * 0.34, 0.4), 0.3)
      return smin(c, rootsD(x, y, z), 2.2)
    }
  }
  return { upper, primary, position, kind, W, D, CH, RL, roots, f }
}

const RES = 56
let cubes: MarchingCubes | null = null

const ENAMEL = new THREE.Color(0xf1e6d0)
const ENAMEL_PRIMARY = new THREE.Color(0xf6f3ec)
const INCISAL = new THREE.Color(0xc4cdd6)
const CERVICAL = new THREE.Color(0xe0c89a)
const ROOT = new THREE.Color(0xd4b987)

/** One tooth, meshed. `crownOnly` cuts it at the neck: what a crown or an implant's crown is. */
function build(spec: ToothSpec, crownOnly: boolean): THREE.BufferGeometry {
  cubes ??= new MarchingCubes(RES, new THREE.MeshBasicMaterial(), false, false, 150000)
  const mc = cubes
  mc.isolation = 0
  const { W, D, CH, RL, f, kind } = spec
  const hx = W / 2 + 1.8
  const hz = D / 2 + 1.8
  const y0 = -RL - 1.5
  const y1 = CH + 2.5
  const cy = (y0 + y1) / 2
  const hy = (y1 - y0) / 2

  mc.reset()
  const hs = RES / 2
  const field = mc.field
  for (let k = 0; k < RES; k++) {
    const z = ((k - hs) / hs) * hz
    for (let j = 0; j < RES; j++) {
      const y = cy + ((j - hs) / hs) * hy
      for (let i = 0; i < RES; i++) {
        const x = ((i - hs) / hs) * hx
        let d = f(x, y, z)
        if (crownOnly) d = smax(d, 0.3 - y, 0.4)
        field[i + j * RES + k * RES * RES] = -d
      }
    }
  }
  mc.update()

  const n = mc.count
  const pa = mc.positionArray
  const na = mc.normalArray
  const positions = new Float32Array(n * 3)
  const normals = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const enamel = spec.primary ? ENAMEL_PRIMARY : ENAMEL
  const tmp = new THREE.Color()
  for (let v = 0; v < n; v++) {
    const x = pa[v * 3]! * hx
    const y = cy + pa[v * 3 + 1]! * hy
    const z = pa[v * 3 + 2]! * hz
    positions[v * 3] = x
    positions[v * 3 + 1] = y
    positions[v * 3 + 2] = z
    // The grid is stretched per axis, so the field's gradient is too: undo it for the normal.
    const a = na[v * 3]! / hx
    const b = na[v * 3 + 1]! / hy
    const c = na[v * 3 + 2]! / hz
    const l = Math.hypot(a, b, c) || 1
    normals[v * 3] = a / l
    normals[v * 3 + 1] = b / l
    normals[v * 3 + 2] = c / l
    if (y < 0.2) tmp.copy(ROOT).lerp(CERVICAL, sm(-1.2, 0.2, y))
    else {
      tmp.copy(CERVICAL).lerp(enamel, sm(0.2, 0.45 * CH, y))
      if (kind === 'inc' || kind === 'can') tmp.lerp(INCISAL, 0.5 * sm(0.8 * CH, CH, y))
    }
    colors[v * 3] = tmp.r
    colors[v * 3 + 1] = tmp.g
    colors[v * 3 + 2] = tmp.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

const cache = new Map<string, THREE.BufferGeometry>()

const keyOf = (upper: boolean, primary: boolean, position: number, crownOnly: boolean) =>
  `${upper ? 'u' : 'l'}${primary ? 'p' : ''}${position}${crownOnly ? 'c' : ''}`

export function toothGeometry(
  upper: boolean,
  primary: boolean,
  position: number,
  crownOnly = false,
): THREE.BufferGeometry {
  const key = keyOf(upper, primary, position, crownOnly)
  let geometry = cache.get(key)
  if (!geometry) {
    geometry = build(specOf(upper, primary, position), crownOnly)
    cache.set(key, geometry)
  }
  return geometry
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Builds every mesh a dentition needs, one per frame, reporting progress. Built meshes are kept
 * for the life of the page, so switching back to the 3D view is instant.
 */
export async function prepareGeometry(
  primary: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const positions = primary ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7, 8]
  const work: Array<[boolean, number, boolean]> = []
  for (const upper of [true, false]) {
    for (const position of positions) {
      work.push([upper, position, false], [upper, position, true])
    }
  }
  let done = 0
  for (const [upper, position, crownOnly] of work) {
    if (!cache.has(keyOf(upper, primary, position, crownOnly))) {
      toothGeometry(upper, primary, position, crownOnly)
      await nextFrame()
    }
    done += 1
    onProgress?.(done, work.length)
  }
}
