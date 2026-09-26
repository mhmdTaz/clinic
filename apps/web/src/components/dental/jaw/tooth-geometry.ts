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
  roots: RootSpec[]
  f: (x: number, y: number, z: number) => number
  /** How strongly (0–1) a point of a back tooth's chewing surface lies in a fissure. */
  groove: (x: number, z: number) => number
}

/**
 * A root, in the tooth's own frame: +x distal, +z toward the lips or cheek, y = 0 at the neck.
 * It runs along a curved centreline from where it leaves the crown (or the root trunk it shares
 * with its neighbours) to its apex; its cross-section is an ellipse, `rx` mesiodistally by `rz`
 * buccolingually at the top, tapering to the rounded apex. A flattened root carries a shallow
 * developmental groove down each flat side.
 */
export interface RootSpec {
  /** The centreline, top to apex. The first point is where the root joins the crown or trunk. */
  path: ReadonlyArray<readonly [number, number, number]>
  rx: number
  rz: number
  apex: number
  groove: number
  /** A box around the root, so the field skips it far away. */
  box: readonly [number, number, number, number, number, number]
}

/**
 * A root from `top` to `apex`, its apical third bent `bend` millimetres distally — most roots
 * curve toward the back of the mouth at the tip — sampled as a short polyline.
 */
function makeRoot(
  top: readonly [number, number, number],
  apex: readonly [number, number, number],
  options: { rx: number; rz: number; bend?: number; apex?: number; groove?: number },
): RootSpec {
  const bend = options.bend ?? 0
  const path: Array<[number, number, number]> = []
  const steps = 7
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    path.push([
      top[0] + (apex[0] - top[0]) * t + bend * Math.pow(t, 2.2),
      top[1] + (apex[1] - top[1]) * t,
      top[2] + (apex[2] - top[2]) * t,
    ])
  }
  const r = Math.max(options.rx, options.rz) + 1
  const xs = path.map((q) => q[0])
  const ys = path.map((q) => q[1])
  const zs = path.map((q) => q[2])
  return {
    path,
    rx: options.rx,
    rz: options.rz,
    apex: options.apex ?? 0.6,
    groove: options.groove ?? 0,
    box: [
      Math.min(...xs) - r,
      Math.max(...xs) + r,
      Math.min(...ys) - r,
      Math.max(...ys) + r,
      Math.min(...zs) - r,
      Math.max(...zs) + r,
    ],
  }
}

/** The signed distance to a root: its elliptical, tapering section, grooved, capped at the apex. */
function rootDistance(x: number, y: number, z: number, root: RootSpec): number {
  const [x0, x1, y0, y1, z0, z1] = root.box
  if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return 4
  const path = root.path
  const n = path.length - 1
  let best = 1e9
  for (let i = 0; i < n; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const bx = b[0] - a[0]
    const by = b[1] - a[1]
    const bz = b[2] - a[2]
    const l2 = bx * bx + by * by + bz * bz
    let h = ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / l2
    h = h < 0 ? 0 : h > 1 ? 1 : h
    const t = (i + h) / n
    // Nearly parallel-sided through the cervical third, then narrowing to a rounded apex.
    const taper = 1 - Math.pow(t, 2.1)
    const rx = root.apex + (root.rx - root.apex) * taper
    const rz = root.apex + (root.rz - root.apex) * taper
    const dx = x - a[0] - bx * h
    const dy = y - a[1] - by * h
    const dz = z - a[2] - bz * h
    const small = Math.min(rx, rz)
    let d = (Math.sqrt((dx / rx) ** 2 + (dz / rz) ** 2 + (dy / small) ** 2) - 1) * small
    if (root.groove > 0) {
      // Down the flat sides, away from the neck and short of the apex.
      d +=
        root.groove *
        Math.exp(-((dz / (0.38 * rz)) ** 2)) *
        sm(0.35, 0.85, Math.abs(dx) / rx) *
        sm(0.05, 0.25, t) *
        (1 - sm(0.75, 0.95, t))
    }
    if (d < best) best = d
  }
  return best
}

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
  let roots: RootSpec[] = []
  let f: ToothSpec['f']
  let groove: ToothSpec['groove'] = () => 0

  // A multi-rooted tooth's roots leave a shared root trunk; `trunk` is how deep it runs before
  // they divide, and its section at the neck. Zero for a single root, which leaves the crown itself.
  let trunk = { depth: 0, a: 0, b: 0 }
  const rootsD = (x: number, y: number, z: number) => {
    let d = 1e9
    if (trunk.depth > 0) {
      const t = sm(0, trunk.depth, -y)
      let c = section(x, z, trunk.a * (1 - 0.12 * t), trunk.b * (1 - 0.1 * t), 0, 2.2)
      c = smax(c, y - 0.8, 0.6)
      // The furcation: the trunk's floor arches up between the roots.
      c = smax(c, -(y + trunk.depth), 1.2)
      d = c
    }
    for (const root of roots) d = smin(d, rootDistance(x, y, z, root), 1.4)
    return d
  }

  // The crown is built the same way for every tooth: a stack of cross-sections that narrow to the
  // neck and taper toward the biting surface, capped by a height field — a flat edge for an
  // incisor, one cusp for a canine, cones meeting in grooves for the back teeth. +z faces the lips
  // or cheek, +y rises from the neck (y = 0) to the tip (y = CH), and x runs along the arch.
  const a0 = W / 2
  const b0 = D / 2
  // Which way is distal in this frame: +x, by convention. The engine mirrors the teeth of one
  // side, so every root curves toward the back of the mouth on both.

  if (kind === 'inc' || kind === 'can') {
    const canine = kind === 'can'
    // One root, conical, a little distal at the apex. A lower incisor's is flattened side to side
    // and grooved; a canine's is the longest in the mouth, broad buccolingually and grooved too.
    const lowerIncisor = !upper && !canine && !primary
    roots = [
      makeRoot([0, 0.8, 0], [primary ? 0.2 : 0.3, -RL, -0.2 * b0], {
        rx: a0 * (lowerIncisor ? 0.55 : primary ? 0.55 : 0.62),
        rz: b0 * (canine ? 0.92 : lowerIncisor ? 0.95 : 0.85),
        bend: primary ? 0.5 : canine ? 0.9 : position === 2 ? 1.3 : 0.7,
        apex: primary ? 0.4 : 0.8,
        groove: primary ? 0 : canine ? 0.45 : lowerIncisor ? 0.4 : 0.15,
      }),
    ]
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
      c = smax(c, -y - 0.3, 0.8)
      return smin(c, rootsD(x, y, z), 1.6)
    }
  } else if (kind === 'pre') {
    // An upper first premolar's root divides halfway down into a buccal and a palatal root. An
    // upper second's is one root, flattened and grooved; a lower premolar's, one conical root.
    if (upper && position === 4) {
      const split = RL * 0.45
      trunk = { depth: split, a: a0 * 0.72, b: b0 * 0.82 }
      roots = [
        makeRoot([0, -split + 1.2, 0.3 * b0], [0.2, -RL, 0.45 * b0], {
          rx: a0 * 0.5,
          rz: b0 * 0.38,
          bend: 0.6,
        }),
        makeRoot([0, -split + 1.2, -0.3 * b0], [0.1, -RL * 0.95, -0.52 * b0], {
          rx: a0 * 0.48,
          rz: b0 * 0.36,
          bend: 0.3,
        }),
      ]
    } else {
      roots = [
        makeRoot([0, 0.8, 0], [0.3, -RL, 0], {
          rx: a0 * (upper ? 0.55 : 0.68),
          rz: b0 * (upper ? 0.82 : 0.75),
          bend: upper ? 0.8 : 0.6,
          apex: 0.5,
          groove: upper ? 0.45 : 0.15,
        }),
      ]
    }
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
      c = smax(c, -y - 0.3, 0.8)
      return smin(c, rootsD(x, y, z), 1.6)
    }
    groove = (x, z) => grooveOf(x, z, cusps, 0.35)
  } else {
    // A molar's roots leave a short trunk and then divide. Upper: the broad mesiobuccal root
    // curving distally, a smaller distobuccal, and the longest, the palatal, flaring toward the
    // palate. Lower: a mesial and a distal root, both wide buccolingually and grooved, the mesial
    // one curved. The further back the tooth, the closer its roots; a wisdom tooth's are fused.
    // A primary molar's roots are thin and widely flared, holding room for the premolar beneath.
    const spread = primary ? 1.45 : position === 6 ? 1 : position === 7 ? 0.75 : 0.45
    const depth = primary ? 1.4 : position === 8 ? RL * 0.55 : upper ? 4 : 3
    trunk = { depth, a: a0 * 0.8, b: b0 * 0.8 }
    const top = -depth + 1.2
    const thin = primary ? 0.72 : 1
    roots = upper
      ? [
          makeRoot([-0.42 * a0, top, 0.42 * b0], [-0.3 * a0 * spread, -RL, 0.6 * b0 * spread], {
            rx: a0 * 0.24 * thin,
            rz: b0 * 0.32 * thin,
            bend: 1.3,
            groove: primary ? 0 : 0.25,
          }),
          makeRoot(
            [0.42 * a0, top, 0.42 * b0],
            [0.55 * a0 * spread, -RL * 0.88, 0.55 * b0 * spread],
            {
              rx: a0 * 0.2 * thin,
              rz: b0 * 0.24 * thin,
              bend: 0.3,
            },
          ),
          makeRoot([0, top, -0.42 * b0], [0.05 * a0, -RL * 1.04, -0.95 * b0 * spread], {
            rx: a0 * 0.27 * thin,
            rz: b0 * 0.26 * thin,
          }),
        ]
      : [
          makeRoot([-0.45 * a0, top, 0], [-0.4 * a0 * spread, -RL, 0], {
            rx: a0 * 0.22 * thin,
            rz: b0 * 0.74 * thin,
            bend: 1.4,
            groove: primary ? 0 : 0.35,
          }),
          makeRoot([0.45 * a0, top, 0], [0.62 * a0 * spread, -RL * 0.92, 0], {
            rx: a0 * 0.2 * thin,
            rz: b0 * 0.66 * thin,
            bend: 0.4,
            groove: primary ? 0 : 0.25,
          }),
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
    // The layout is written with mesial at +x; the frame has distal there, so it is mirrored.
    const cusps: Cusp[] = layout.map(([cx, cz, drop]) => [-cx * a0, cz * b0, CH - drop, s])
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
        const mx = -x
        const t = Math.max(0, Math.min(1, ((mx - 0.42 * a0) * -0.92 + (z + 0.5 * b0)) / 1.2 / b0))
        const rx = -(0.42 * a0 + (-0.5 * a0 - 0.42 * a0) * t)
        const rz = -0.5 * b0 + (0.5 * b0 + 0.5 * b0) * t
        top = smax(top, CH - 1.1 - 1.4 * Math.hypot(x - rx, z - rz), 0.4)
      }
      c = smax(c, (y - top) * 0.7, 0.45)
      c = smax(c, -y - 0.3, 0.8)
      return smin(c, rootsD(x, y, z), 1.6)
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
  /** How radiopaque each point is, for the X-ray view: enamel most, root dentin less. */
  density: Float32Array
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
  const at = (i: number, j: number, k: number) => {
    const x = ((i - hs) / hs) * hx
    const y = cy + ((j - hs) / hs) * hy
    const z = ((k - hs) / hs) * hz
    // A crown alone is cut at the neck: below it there is nothing to evaluate.
    if (crownOnly && y < -0.6) return 0.3 - y
    const d = f(x, y, z)
    return crownOnly ? smax(d, 0.3 - y, 0.4) : d
  }
  // Only the thin shell around the surface decides the mesh. The field is sampled first on a grid
  // a quarter as fine; a voxel whose nearest coarse sample is clearly inside or outside takes that
  // value, and only those near the surface are evaluated exactly — most of a tooth's volume is
  // skipped, which is most of the sculpting time.
  const STEP = 4
  const cn = Math.ceil((RES - 1) / STEP) + 1
  const coarse = new Float32Array(cn * cn * cn)
  for (let ck = 0; ck < cn; ck++) {
    for (let cj = 0; cj < cn; cj++) {
      for (let ci = 0; ci < cn; ci++) {
        coarse[ci + cj * cn + ck * cn * cn] = at(
          Math.min(ci * STEP, RES - 1),
          Math.min(cj * STEP, RES - 1),
          Math.min(ck * STEP, RES - 1),
        )
      }
    }
  }
  // Safely more than a coarse cell's diagonal, in millimetres, over the field's worst stretch.
  const margin = 2.2 * STEP * (Math.max(hx, hy, hz) / hs)
  for (let k = 0; k < RES; k++) {
    const ck = Math.round(k / STEP)
    for (let j = 0; j < RES; j++) {
      const cj = Math.round(j / STEP)
      for (let i = 0; i < RES; i++) {
        const near = coarse[Math.round(i / STEP) + cj * cn + ck * cn * cn]!
        const d = Math.abs(near) > margin ? near : at(i, j, k)
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
  const density = new Float32Array(n)
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
    density[v] = 0.6 + 0.4 * sm(-0.4, 0.9, y)
    colors[v * 3] = tmp.r
    colors[v * 3 + 1] = tmp.g
    colors[v * 3 + 2] = tmp.b
  }
  return { positions, normals, colors, density }
}

function toGeometry({ positions, normals, colors, density }: MeshArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('density', new THREE.BufferAttribute(density, 1))
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
