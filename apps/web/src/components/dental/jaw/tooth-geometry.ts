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
  /** How strongly (0–1) a point of a back tooth's chewing surface lies in a fissure. */
  groove: (x: number, z: number) => number
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

/**
 * A crown's cross-section at a height: a superellipse (a rounded rectangle for an incisor, nearly
 * an ellipse for a molar), `a` wide mesiodistally and `b` deep buccolingually, centred `zc` toward
 * the lips. Returned as an approximate signed distance in millimetres.
 */
function section(x: number, z: number, a: number, b: number, zc: number, p: number): number {
  const u = Math.abs(x) / a
  const v = Math.abs(z - zc) / b
  const n = Math.pow(Math.pow(u, p) + Math.pow(v, p), 1 / p)
  return (n - 1) * Math.min(a, b)
}

/**
 * A cusp: a rounded cone rising to `h` at (cx, cz) and falling away at `slope`. The tip is a
 * hyperbola rather than a point — a blunt cusp a millimetre or so across, as real ones are.
 */
type Cusp = readonly [cx: number, cz: number, h: number, slope: number]
const TIP = 1.3
const cuspCone = (x: number, z: number, [cx, cz, h, slope]: Cusp) =>
  h - slope * (Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz) + TIP * TIP) - TIP)
const cuspHeight = (x: number, z: number, cusps: readonly Cusp[], k: number): number => {
  // A smooth maximum of cones: where two meet is the groove between them, kept sharp by a small k.
  let top = -1e9
  for (const cusp of cusps) {
    const height = cuspCone(x, z, cusp)
    top = top === -1e9 ? height : smax(top, height, k)
  }
  return top
}

/**
 * Where cones meet is a fissure. The smooth maximum rises above the hard one only near such a
 * crease, so the difference, scaled by the blend width, says how deep in a groove a point is.
 */
const grooveOf = (x: number, z: number, cusps: readonly Cusp[], k: number): number => {
  let hard = -1e9
  for (const cusp of cusps) hard = Math.max(hard, cuspCone(x, z, cusp))
  return Math.min(1, (cuspHeight(x, z, cusps, k) - hard) / (k * 0.25))
}

export function specOf(upper: boolean, primary: boolean, position: number): ToothSpec {
  const [W, D, CH, RL] = dimsOf(upper, primary, position)
  const kind = kindOf(primary, position)
  let roots: Root[]
  let f: ToothSpec['f']
  let groove: ToothSpec['groove'] = () => 0

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

  // The crown is built the same way for every tooth: a stack of cross-sections that narrow to the
  // neck and taper toward the biting surface, capped by a height field — a flat edge for an
  // incisor, one cusp for a canine, cones meeting in grooves for the back teeth. +z faces the lips
  // or cheek, +y rises from the neck (y = 0) to the tip (y = CH), and x runs along the arch.
  const a0 = W / 2
  const b0 = D / 2

  if (kind === 'inc' || kind === 'can') {
    const canine = kind === 'can'
    roots = [[[0, 2, 0], [0, -RL, -0.4], 0.36 * D, 0.55, 1.25]]
    // Where the biting edge is. A central incisor's is nearly straight with sharp corners; a
    // lateral's corners are rounded off; a canine rises to one cusp with a slope either side.
    const edge = (x: number) => {
      const t = Math.abs(x) / a0
      // A canine's cusp is pointed, but worn round at the tip, with gentler slopes than a fang's.
      if (canine) return CH - 0.62 * (Math.sqrt(x * x + 1.1) - Math.sqrt(1.1)) - 0.3 * t * t
      const corner = position === 1 && !primary ? 0.15 : 1.2
      return CH - 0.2 * t * t - corner * sm(0.75, 1.05, t) * (t - 0.75)
    }
    f = (x, y, z) => {
      const u = y / CH
      // Narrow at the neck, widest in the incisal third.
      const a = a0 * (0.68 + 0.32 * sm(-0.05, 0.62, u)) * (canine ? 1 - 0.1 * sm(0.7, 1, u) : 1)
      // A wedge in profile: thick at the neck, a thin edge at the tip.
      const b = b0 * (1 - (canine ? 0.58 : 0.84) * sm(0.12, 1.0, u)) + (canine ? 0.25 : 0.12)
      // The lingual face slopes toward the lips; the labial face stays nearly upright.
      const zc = (b0 - b) * 0.8
      let c = section(x, z, a, b, zc, canine ? 2.3 : 2.8)
      // The three developmental lobes on the lip side: two faint vertical hollows between them,
      // fading toward the neck. They are what breaks up a front tooth's reflection.
      if (z > zc) c -= 0.07 * Math.cos((3 * Math.PI * x) / a0) * sm(0.25, 0.85, u)
      // Capped by the biting edge, its corners slightly rounded.
      c = smax(c, (y - edge(x)) * 0.8, 0.9)
      // The lingual hollow between the marginal ridges, and the cingulum below it.
      c = smax(c, -ell(x, y - 0.58 * CH, z - (zc - b) - 0.3, a0 * 0.52, CH * 0.3, 0.9), 0.6)
      c = smin(c, ell(x, y - 0.18 * CH, z - (zc - b * 0.75), a0 * 0.45, CH * 0.2, b0 * 0.35), 1.0)
      // The canine's labial ridge.
      if (canine)
        c = smin(c, ell(x, y - 0.55 * CH, z - (zc + b * 0.72), a0 * 0.3, CH * 0.42, 0.9), 1.2)
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
    // A tall buccal cusp and a lingual one — nearly as tall on an upper premolar, small on a lower.
    const lingual = upper ? 0.6 : position === 4 ? 2.4 : 1.4
    const cusps: Cusp[] = [
      [0, 0.25 * D, CH, 0.78],
      [0, -0.26 * D, CH - lingual, 0.78],
      // The marginal ridges close the occlusal table at either end.
      [0.72 * a0, 0, CH - 1.5, 1.6],
      [-0.72 * a0, 0, CH - 1.5, 1.6],
    ]
    f = (x, y, z) => {
      const u = y / CH
      const a = a0 * (0.74 + 0.26 * sm(-0.05, 0.5, u) - 0.08 * sm(0.7, 1, u))
      // The height of contour a third of the way up, then the occlusal table narrows.
      const b = b0 * (0.84 + 0.16 * sm(-0.05, 0.35, u) - 0.12 * sm(0.55, 1, u))
      let c = section(x, z, a, b, 0, 2.2)
      c = smax(c, (y - cuspHeight(x, z, cusps, 0.35)) * 0.72, 0.4)
      return smin(c, rootsD(x, y, z), 1.8)
    }
    groove = (x, z) => grooveOf(x, z, cusps, 0.35)
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
    const s = 0.72
    // Cusp tips, as fractions of the crown's half-width and half-depth, and how far below the
    // tallest each sits. Upper: two buccal, the big mesiolingual, a small distolingual. Lower first
    // molar: three buccal and two lingual; the others four.
    const layout: ReadonlyArray<readonly [number, number, number]> = upper
      ? [
          [0.5, 0.52, 0.2],
          [-0.5, 0.5, 0.5],
          [0.42, -0.5, 0],
          [-0.52, -0.5, 1.2],
        ]
      : position === 6 && !primary
        ? [
            [0.58, 0.52, 0.5],
            [-0.05, 0.56, 0.6],
            [-0.66, 0.4, 1.0],
            [0.52, -0.5, 0],
            [-0.48, -0.5, 0.15],
          ]
        : [
            [0.5, 0.5, 0.4],
            [-0.5, 0.5, 0.55],
            [0.5, -0.5, 0],
            [-0.5, -0.5, 0.2],
          ]
    const cusps: Cusp[] = layout.map(([cx, cz, drop]) => [cx * a0, cz * b0, CH - drop, s])
    // The marginal ridges; on an upper molar, the oblique ridge across the table as well.
    cusps.push([0.86 * a0, 0, CH - 1.4, 1.7], [-0.86 * a0, 0, CH - 1.6, 1.7])
    f = (x, y, z) => {
      const u = y / CH
      // A molar is bell-shaped: nipped in at the neck, bulging a third of the way up.
      const a = a0 * (0.8 + 0.2 * sm(-0.1, 0.4, u) - 0.05 * sm(0.6, 1, u))
      const b = b0 * (0.8 + 0.2 * sm(-0.1, 0.32, u) - 0.1 * sm(0.5, 1, u))
      let c = section(x, z, a, b, 0, 2.4)
      let top = cuspHeight(x, z, cusps, 0.45)
      if (upper) {
        // The oblique ridge, from the mesiolingual cusp to the distobuccal.
        const t = Math.max(0, Math.min(1, ((x - 0.42 * a0) * -0.92 + (z + 0.5 * b0)) / 1.2 / b0))
        const rx = 0.42 * a0 + (-0.5 * a0 - 0.42 * a0) * t
        const rz = -0.5 * b0 + (0.5 * b0 + 0.5 * b0) * t
        top = smax(top, CH - 1.1 - 1.4 * Math.hypot(x - rx, z - rz), 0.4)
      }
      c = smax(c, (y - top) * 0.7, 0.45)
      return smin(c, rootsD(x, y, z), 2.2)
    }
    groove = (x, z) => grooveOf(x, z, cusps, 0.45)
  }
  return { upper, primary, position, kind, W, D, CH, RL, roots, f, groove }
}

const RES = 76
let cubes: MarchingCubes | null = null

// A natural shade, around Vita A2: warm in the body, more saturated at the neck where the dentin
// shows through thin enamel, and grey-blue and translucent at the edge of a front tooth. Primary
// teeth are whiter and more opaque. Canines run a shade darker than the incisors beside them.
const ENAMEL = new THREE.Color(0xe7d8bc)
const ENAMEL_CANINE = new THREE.Color(0xdfcaa3)
const ENAMEL_PRIMARY = new THREE.Color(0xf1ebdf)
const INCISAL = new THREE.Color(0xa9b4be)
const HALO = new THREE.Color(0xf7f5ef)
const CERVICAL = new THREE.Color(0xdcc293)
const ROOT = new THREE.Color(0xd8c29a)
const STAIN = new THREE.Color(0xa8875a)

/** A few percent of lightness, varying over the surface, so no two patches of enamel match. */
function mottle(x: number, y: number, z: number): number {
  const n =
    Math.sin(x * 1.7 + y * 0.9) * Math.sin(z * 1.3 - y * 1.1) +
    0.5 * Math.sin(x * 4.1 - z * 3.3 + y * 2.7)
  return 1 + 0.018 * n
}

/** A mesh as plain arrays: what a worker can hand back without copying. */
export interface MeshArrays {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
}

/**
 * One tooth, meshed. `crownOnly` cuts it at the neck: what a crown or an implant's crown is.
 * Plain arrays and no DOM, so it runs in a worker as well as on the page.
 */
export function meshArrays(
  upper: boolean,
  primary: boolean,
  position: number,
  crownOnly: boolean,
): MeshArrays {
  const spec = specOf(upper, primary, position)
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
  const enamel = spec.primary ? ENAMEL_PRIMARY : kind === 'can' ? ENAMEL_CANINE : ENAMEL
  const front = kind === 'inc' || kind === 'can'
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
      tmp.copy(CERVICAL).lerp(enamel, sm(0.15 * CH, 0.5 * CH, y))
      if (front && !spec.primary) {
        // Translucent toward the edge, with a thin bright rim of enamel at the very tip.
        tmp.lerp(INCISAL, 0.62 * sm(0.7 * CH, 0.96 * CH, y))
        tmp.lerp(HALO, 0.5 * sm(0.965 * CH, 1.0 * CH, y))
      } else if (!front && y > 0.72 * CH) {
        // A little stain where the fissures run.
        tmp.lerp(STAIN, 0.42 * spec.groove(x, z) * sm(0.72 * CH, 0.9 * CH, y))
      }
    }
    tmp.multiplyScalar(mottle(x, y, z))
    colors[v * 3] = tmp.r
    colors[v * 3 + 1] = tmp.g
    colors[v * 3 + 2] = tmp.b
  }
  return { positions, normals, colors }
}

function toGeometry({ positions, normals, colors }: MeshArrays): THREE.BufferGeometry {
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
    geometry = toGeometry(meshArrays(upper, primary, position, crownOnly))
    cache.set(key, geometry)
  }
  return geometry
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

type Job = [upper: boolean, position: number, crownOnly: boolean]

/**
 * Sculpts on a worker thread. A tooth takes tens of milliseconds on a fast machine and several
 * hundred on a slow one; on the page's own thread that is a page that stops answering clicks
 * while the 3D view gets ready. Null when a worker cannot be started, and the caller falls back.
 */
async function sculptOnWorker(
  primary: boolean,
  jobs: readonly Job[],
  onEach: () => void,
): Promise<boolean> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./tooth-geometry.worker.ts', import.meta.url))
  } catch {
    return false
  }
  try {
    for (const [upper, position, crownOnly] of jobs) {
      const arrays = await new Promise<MeshArrays>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<MeshArrays>) => resolve(event.data)
        worker.onerror = (event) => reject(new Error(event.message))
        worker.postMessage({ upper, primary, position, crownOnly })
      })
      cache.set(keyOf(upper, primary, position, crownOnly), toGeometry(arrays))
      onEach()
    }
    return true
  } catch {
    return false
  } finally {
    worker.terminate()
  }
}

/**
 * Builds every mesh a dentition needs, reporting progress — on a worker when the browser allows
 * one, otherwise one tooth per frame on the page. Built meshes are kept for the life of the page,
 * so switching back to the 3D view is instant.
 */
export async function prepareGeometry(
  primary: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const positions = primary ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7, 8]
  const work: Job[] = []
  for (const upper of [true, false]) {
    for (const position of positions) {
      work.push([upper, position, false], [upper, position, true])
    }
  }
  let done = work.filter(([upper, position, crownOnly]) =>
    cache.has(keyOf(upper, primary, position, crownOnly)),
  ).length
  onProgress?.(done, work.length)
  const missing = work.filter(
    ([upper, position, crownOnly]) => !cache.has(keyOf(upper, primary, position, crownOnly)),
  )
  const onWorker = await sculptOnWorker(primary, missing, () => {
    done += 1
    onProgress?.(done, work.length)
  })
  if (onWorker) return

  done = 0
  for (const [upper, position, crownOnly] of work) {
    if (!cache.has(keyOf(upper, primary, position, crownOnly))) {
      toothGeometry(upper, primary, position, crownOnly)
      await nextFrame()
    }
    done += 1
    onProgress?.(done, work.length)
  }
}
