import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import type { ToothVisual } from '../tooth-visual'
import { dimsOf } from './tooth-dims'
import { specOf, toothGeometry } from './tooth-geometry'

/**
 * The 3D jaw (Phase 11). A three.js scene the React component drives through a small interface:
 * which teeth look how, which one is selected, which view, X-ray or not. Everything clinical is
 * decided before it gets here (tooth-visual.ts); this file only draws.
 *
 * Units are millimetres. The arch is a spline through a typical arch form, scaled so the teeth
 * sit edge to edge; the gums are swept along it and scallop around every neck, rising into the
 * papillae between teeth and closing over the socket of a tooth that is gone.
 */

export type JawView = 'front' | 'right' | 'upper' | 'lower'

export interface JawEngine {
  setTeeth(visuals: ReadonlyMap<string, ToothVisual>): void
  setSelected(fdi: string | null): void
  setHighlight(fdis: readonly string[]): void
  setXray(on: boolean): void
  setOpen(on: boolean): void
  setView(view: JawView): void
  setActive(active: boolean): void
  setBadges(elements: ReadonlyMap<string, HTMLElement>): void
  dispose(): void
}

export interface JawCallbacks {
  onPick(fdi: string): void
  onHover(fdi: string | null, at: { x: number; y: number } | null): void
}

const HALF_ARCH = {
  u: [
    [0, 0],
    [8, -2],
    [14, -5.5],
    [17, -9],
    [20.5, -15],
    [23, -21],
    [25.5, -30],
    [27.5, -40],
    [28.5, -48],
    [29, -55],
  ],
  l: [
    [0, 0],
    [6, -1.5],
    [11, -4],
    [14, -6.5],
    [18, -13],
    [21, -20],
    [23.5, -29],
    [25.5, -39],
    [26.5, -47],
    [27, -54],
  ],
} as const

/** Crown tipped toward the lips at the front, toward the tongue at the back of the lower jaw. */
const TILT = {
  u: [0, 0.3, 0.26, 0.14, 0.05, 0.05, 0.08, 0.08, 0.08],
  l: [0, 0.2, 0.18, 0.1, -0.04, -0.06, -0.14, -0.14, -0.14],
} as const

/**
 * How far the upper teeth come down over the lower ones, in millimetres: about two at the incisors,
 * as in a normal bite, and less at the back where the cusps sit in each other's fossae instead.
 */
const overbite = (s: number) => 0.7 + 1.3 * (1 - sm(8, 20, Math.abs(s)))
/**
 * How much arch a tooth takes. Teeth touch at their contact points, which on a front tooth tipped
 * toward the lips sit outside the arch line — where the curve spreads them apart — so front teeth
 * are packed a little closer than their width.
 */
const pitchOf = (width: number, position: number) =>
  width * (position === 1 ? 0.84 : position === 2 ? 0.88 : position === 3 ? 0.93 : 0.97)

/** How far behind the upper arch the lower one sits, so the upper incisors close in front. */
const OVERJET = 2.6
const EXTENSION = 7
/**
 * A studio backdrop: a soft pool of light behind the jaw, falling off to near black at the edges,
 * as a dental photograph is lit. Drawn once into a small canvas.
 */
function backdrop(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')!
  const glow = context.createRadialGradient(128, 118, 8, 128, 128, 190)
  glow.addColorStop(0, '#3a4148')
  glow.addColorStop(0.55, '#1d2226')
  glow.addColorStop(1, '#0c0e10')
  context.fillStyle = glow
  context.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
const XRAY_BACKGROUND = new THREE.Color(0x040506)

const sm = (a: number, b: number, x: number) => {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

interface Slot {
  fdi: string
  upper: boolean
  quadrant: number
  position: number
  s: number
  halfWidth: number
  depth: number
  crownHeight: number
  group: THREE.Group
  base: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  enamel: THREE.MeshPhysicalMaterial
  ceramic: THREE.MeshPhysicalMaterial
  natural: THREE.Mesh
  ghost: THREE.Mesh
  prosthetic: THREE.Mesh
  shell: THREE.Mesh
  planned: THREE.Mesh
  implant: THREE.Mesh
  canals: THREE.Mesh[]
  pulp: THREE.Mesh[]
  decay: THREE.Mesh[]
  anchor: THREE.Object3D
  visual: ToothVisual | null
}

/**
 * The orange-peel stippling of healthy attached gingiva, as a tiling normal map: many small pits,
 * made once. Height from dimples on a jittered grid; normals from its slope.
 */
function stippleTexture(): THREE.DataTexture {
  const size = 128
  const height = new Float32Array(size * size)
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const cells = 22
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const px = ((cx + 0.2 + 0.6 * random()) / cells) * size
      const py = ((cy + 0.2 + 0.6 * random()) / cells) * size
      const radius = 1.4 + 1.6 * random()
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.hypot(dx, dy) / radius
          if (d >= 1) continue
          const x = (Math.round(px) + dx + size) % size
          const y = (Math.round(py) + dy + size) % size
          height[y * size + x] = height[y * size + x]! - (1 - d * d) * (1 - d * d)
        }
      }
    }
  }
  const data = new Uint8Array(size * size * 4)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 1.2
      const ny = (at(x, y - 1) - at(x, y + 1)) * 1.2
      const l = Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      data[i] = Math.round(((nx / l) * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

/**
 * Light that goes into enamel or gum comes back out somewhere else, tinted by what it passed
 * through — which is why a tooth's shadow side is never grey, and gum glows red where it is thin.
 * Proper subsurface scattering is out of reach for a chart that must run on any laptop, so this
 * adds its most visible part: a little light of the tissue's own colour into every surface, most
 * where it faces away from the camera's light and at grazing angles, where the tissue is thinnest.
 */
function translucent(
  material: THREE.MeshPhysicalMaterial,
  tint: THREE.ColorRepresentation,
  strength: number,
): THREE.MeshPhysicalMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.scatterTint = { value: new THREE.Color(tint) }
    shader.uniforms.scatterStrength = { value: strength }
    shader.fragmentShader =
      'uniform vec3 scatterTint;\nuniform float scatterStrength;\n' +
      shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        [
          '#include <lights_fragment_end>',
          'float scatterEdge = 1.0 - abs(dot(normal, normalize(vViewPosition)));',
          'reflectedLight.indirectDiffuse += diffuseColor.rgb * scatterTint * scatterStrength *',
          '  (0.55 + 0.9 * scatterEdge * scatterEdge);',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => `translucent-${strength}`
  return material
}

function implantGeometry(): THREE.LatheGeometry {
  const profile = [new THREE.Vector2(0.001, -11.5), new THREE.Vector2(1.3, -11.2)]
  for (let i = 0; i < 12; i++) {
    const y = -10.6 + i * 0.85
    profile.push(new THREE.Vector2(2.0, y), new THREE.Vector2(2.35, y + 0.3))
  }
  profile.push(
    new THREE.Vector2(2.2, -0.4),
    new THREE.Vector2(2.2, 0.4),
    new THREE.Vector2(1.6, 0.8),
    new THREE.Vector2(0.001, 0.8),
  )
  return new THREE.LatheGeometry(profile, 40)
}

export function createJawEngine(
  container: HTMLElement,
  dentition: 'PERMANENT' | 'PRIMARY',
  callbacks: JawCallbacks,
): JawEngine {
  const primary = dentition === 'PRIMARY'
  const positions = primary ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7, 8]

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.localClippingEnabled = true
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.touchAction = 'none'
  container.prepend(renderer.domElement)

  const scene = new THREE.Scene()
  const BACKGROUND = backdrop()
  scene.background = BACKGROUND
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 1000)
  camera.position.set(55, 22, 105)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = 45
  controls.maxDistance = 260

  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(50, 70, 110)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, {
    left: -50,
    right: 50,
    top: 50,
    bottom: -50,
    near: 10,
    far: 400,
  })
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.25
  key.shadow.radius = 4
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xfff0e8, 0.5)
  fill.position.set(-90, -25, 50)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 0.7)
  rim.position.set(0, 50, -120)
  scene.add(rim)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b4a4a, 0.25))
  // A light that goes where the camera goes, so the view from below the upper arch is not dark.
  const head = new THREE.DirectionalLight(0xffffff, 0.9)
  head.position.set(0, 0.3, 1)
  camera.add(head)
  scene.add(camera)

  const palateTissue = translucent(
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.55,
      clearcoat: 0.45,
      clearcoatRoughness: 0.4,
      side: THREE.DoubleSide,
    }),
    0xff4a40,
    0.12,
  )
  const titanium = new THREE.MeshPhysicalMaterial({
    color: 0xbdbdb8,
    metalness: 1,
    roughness: 0.32,
  })
  const gutta = new THREE.MeshStandardMaterial({ color: 0xf08a3c, roughness: 0.5 })
  const decay = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85 })
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xe24b4a,
    transparent: true,
    opacity: 0.38,
    roughness: 0.1,
    depthWrite: false,
  })
  const ghost = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  })
  const stipple = stippleTexture()
  // The palate is smoother and less glossy than the gum: no stippling, a softer sheen.
  // Wet tissue: a clear coat of saliva over a stippled, matt surface.
  const gum = translucent(
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.62,
      normalMap: stipple,
      normalScale: new THREE.Vector2(0.22, 0.22),
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      sheen: 0.15,
      sheenColor: new THREE.Color(0xffb3b3),
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
    }),
    0xff4a40,
    0.13,
  )
  // On a radiograph enamel is the brightest thing in the mouth and root dentin a step darker; the
  // tooth geometry carries a density per vertex that scales the X-ray tone.
  const xrTooth = new THREE.MeshBasicMaterial({
    color: 0x8e99a4,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  xrTooth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float density;\nvarying float vDensity;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDensity = density;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vDensity;\nvoid main() {')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse * vDensity, opacity );',
      )
  }
  xrTooth.customProgramCacheKey = () => 'xray-density'
  // The pulp is soft tissue inside the tooth, so it shows dark: drawn after the teeth, it
  // multiplies down what is behind it rather than adding to it.
  const xrPulp = new THREE.MeshBasicMaterial({
    color: 0x6a6a6a,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
  })
  const xrDense = new THREE.MeshBasicMaterial({ color: 0xf4f7fa })
  const xrSoft = new THREE.MeshBasicMaterial({
    color: 0x1c2228,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const implantShape = implantGeometry()
  const decayShape = new THREE.SphereGeometry(1, 16, 10)
  const pulpChamber = new THREE.SphereGeometry(1, 20, 14)

  // Roots are for the X-ray view. Outside it, a plane per jaw cuts them off just inside the gum,
  // which is a closed shape, so the cut is never seen: a model shows gum, not bone and root tips.
  const clip = {
    u: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    l: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  }
  const clipAt = { u: 0, l: 0 }
  const titaniumOf = {
    u: null as unknown as THREE.MeshPhysicalMaterial,
    l: null as unknown as THREE.MeshPhysicalMaterial,
  }

  const upperJaw = new THREE.Group()
  const lowerJaw = new THREE.Group()
  upperJaw.position.z = 22
  lowerJaw.position.z = 22
  scene.add(upperJaw, lowerJaw)

  const slots = new Map<string, Slot>()
  const picks: THREE.Object3D[] = []
  const arches: Record<
    'u' | 'l',
    { curve: THREE.CatmullRomCurve3; half: number; sum: number; zOff: number }
  > = {
    u: null!,
    l: null!,
  }

  function makeCurve(upper: boolean, sum: number) {
    const points = HALF_ARCH[upper ? 'u' : 'l']
    const make = (k: number) => {
      const pts: THREE.Vector3[] = []
      for (let i = points.length - 1; i > 0; i--)
        pts.push(new THREE.Vector3(-points[i]![0] * k, 0, points[i]![1] * k))
      for (const q of points) pts.push(new THREE.Vector3(q[0] * k, 0, q[1] * k))
      return new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    }
    // Primary teeth sit on a smaller arch, scaled to them just as the permanent arch is.
    const k = (sum + EXTENSION) / (make(1).getLength() / 2)
    const curve = make(k)
    return { curve, half: curve.getLength() / 2 }
  }

  function at(arch: 'u' | 'l', s: number) {
    const { curve, half, zOff } = arches[arch]
    const u = Math.min(1, Math.max(0, 0.5 + s / (2 * half)))
    const point = curve.getPointAt(u)
    const tangent = curve.getTangentAt(u)
    point.z += zOff
    return { point, normal: new THREE.Vector3(-tangent.z, 0, tangent.x).normalize() }
  }

  const spee = (s: number) => 1.8 * sm(12, 48, Math.abs(s))

  for (const upper of [true, false]) {
    const arch = upper ? 'u' : 'l'
    const jaw = upper ? upperJaw : lowerJaw
    let sum = 0
    for (const position of positions) sum += pitchOf(dimsOf(upper, primary, position)[0], position)
    arches[arch] = { ...makeCurve(upper, sum), sum, zOff: upper ? 0 : -OVERJET }

    for (const side of [-1, 1]) {
      const quadrant = primary
        ? upper
          ? side < 0
            ? 5
            : 6
          : side < 0
            ? 8
            : 7
        : upper
          ? side < 0
            ? 1
            : 2
          : side < 0
            ? 4
            : 3
      let along = 0
      for (const position of positions) {
        const [W, D, CH] = dimsOf(upper, primary, position)
        const pitch = pitchOf(W, position)
        const centre = along + pitch / 2
        along += pitch
        const s = side * centre
        const { point, normal } = at(arch, s)
        const yOcclusal = (upper ? -overbite(s) : overbite(s)) / 2 + spee(s)

        const group = new THREE.Group()
        const yAxis = new THREE.Vector3(0, upper ? -1 : 1, 0)
        const xAxis = new THREE.Vector3().crossVectors(yAxis, normal)
        group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, normal))
        group.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            TILT[arch][position] ?? 0,
          ),
        )
        group.position.set(point.x, yOcclusal + (upper ? CH : -CH), point.z)
        // A tooth's own frame has distal at +x. One side of each jaw sees that mirrored, so its
        // teeth are flipped — roots curve toward the back of the mouth on both sides.
        if (upper ? s > 0 : s < 0) group.scale.x = -1
        jaw.add(group)

        const fdi = `${quadrant}${position}`
        // Enamel: a hard, faintly translucent surface under a film of saliva — broad soft
        // highlights from the enamel itself, small sharp ones from the wet coat over it.
        const enamel = translucent(
          new THREE.MeshPhysicalMaterial({
            clippingPlanes: [clip[arch]],
            vertexColors: true,
            roughness: 0.34,
            clearcoat: 0.55,
            clearcoatRoughness: 0.1,
            ior: 1.62,
            specularIntensity: 0.8,
            sheen: 0.12,
            sheenColor: new THREE.Color(0xfff4e0),
            sheenRoughness: 0.5,
          }),
          0xffd9a8,
          0.16,
        )
        const ceramic = new THREE.MeshPhysicalMaterial({
          color: 0xf6f2ea,
          roughness: 0.08,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          ior: 1.9,
        })
        const full = toothGeometry(upper, primary, position, false)
        const crownOnly = toothGeometry(upper, primary, position, true)

        const natural = new THREE.Mesh(full, enamel)
        const ghostMesh = new THREE.Mesh(full, ghost)
        const prosthetic = new THREE.Mesh(crownOnly, ceramic)
        const shell = new THREE.Mesh(crownOnly, ceramic)
        shell.scale.setScalar(1.025)
        const planned = new THREE.Mesh(crownOnly, glass)
        planned.scale.setScalar(1.06)
        titaniumOf[arch] ??= titanium.clone()
        titaniumOf[arch].clippingPlanes = [clip[arch]]
        const implant = new THREE.Mesh(implantShape, titaniumOf[arch])
        for (const mesh of [natural, ghostMesh, prosthetic, shell, planned, implant]) {
          mesh.userData.fdi = fdi
          mesh.castShadow = mesh !== ghostMesh && mesh !== planned
          mesh.receiveShadow = true
          group.add(mesh)
        }
        picks.push(natural, ghostMesh, prosthetic, shell)

        const spec = specOf(upper, primary, position)
        // Each canal runs from the pulp chamber down its root's centreline, stopping short of the
        // apex. Filled, it is gutta-percha; untreated, it is pulp, dark on the X-ray.
        const chamberY = CH * (spec.kind === 'mol' ? 0.18 : spec.kind === 'pre' ? 0.25 : 0.3)
        const canalPaths = spec.roots.map(
          (root) =>
            new THREE.CatmullRomCurve3([
              new THREE.Vector3(0, chamberY, 0),
              ...root.path
                .slice(0, -1)
                .map(
                  (q, i, all) =>
                    new THREE.Vector3(q[0], i === all.length - 1 ? q[1] + 0.8 : q[1], q[2]),
                ),
            ]),
        )
        const canals = canalPaths.map((path) => {
          const canal = new THREE.Mesh(new THREE.TubeGeometry(path, 48, 0.42, 10), gutta)
          group.add(canal)
          return canal
        })
        const pulp = [
          ...canalPaths.map(
            (path) => new THREE.Mesh(new THREE.TubeGeometry(path, 48, 0.32, 8), xrPulp),
          ),
          (() => {
            const chamber = new THREE.Mesh(pulpChamber, xrPulp)
            const front = spec.kind === 'inc' || spec.kind === 'can'
            chamber.scale.set(
              spec.W * (front ? 0.14 : spec.kind === 'pre' ? 0.17 : 0.25),
              CH * (front ? 0.34 : 0.2),
              spec.D * (front ? 0.13 : 0.2),
            )
            chamber.position.y = chamberY
            return chamber
          })(),
        ]
        for (const mesh of pulp) {
          mesh.renderOrder = 2
          mesh.visible = false
          group.add(mesh)
        }
        const spots = [
          [0.5, 0.93, 0.1, 0.9, 0.35, 0.7],
          [-1.0, 0.92, -0.3, 0.7, 0.3, 0.55],
        ].map((q) => {
          const spot = new THREE.Mesh(decayShape, decay)
          spot.scale.set(q[3]!, q[4]!, q[5]!)
          spot.position.set(q[0]!, q[1]! * CH, q[2]!)
          group.add(spot)
          return spot
        })
        const anchor = new THREE.Object3D()
        anchor.position.set(0, 0.55 * CH, D / 2 + 2.5)
        group.add(anchor)

        slots.set(fdi, {
          fdi,
          upper,
          quadrant,
          position,
          s,
          halfWidth: W / 2,
          depth: D,
          crownHeight: CH,
          group,
          base: { position: group.position.clone(), quaternion: group.quaternion.clone() },
          enamel,
          ceramic,
          natural,
          ghost: ghostMesh,
          prosthetic,
          shell,
          planned,
          implant,
          canals,
          pulp,
          decay: spots,
          anchor,
          visual: null,
        })
      }
    }
  }

  // ── Gums ──────────────────────────────────────────────────────────────────────────────────

  const gumMeshes: Record<'u' | 'l', THREE.Mesh[]> = { u: [], l: [] }

  function buildGums(upper: boolean) {
    const arch = upper ? 'u' : 'l'
    const jaw = upper ? upperJaw : lowerJaw
    for (const mesh of gumMeshes[arch]) {
      jaw.remove(mesh)
      mesh.geometry.dispose()
    }
    gumMeshes[arch] = []

    const { sum } = arches[arch]
    const teeth = [...slots.values()]
      .filter((slot) => slot.upper === upper)
      .map((slot) => ({
        s: slot.s,
        halfWidth: slot.halfWidth,
        neck: slot.base.position.y,
        halfDepth: slot.depth * 0.42,
        missing: slot.visual?.absent ?? false,
        // How far the root shows through the bone as a ridge: most for a canine's long root.
        eminence:
          slot.position === 3 ? 1.1 : slot.position <= 2 ? 0.6 : slot.position <= 5 ? 0.5 : 0.35,
      }))
      .sort((a, b) => a.s - b.s)

    const info = (s: number) => {
      let i = teeth.findIndex((tooth) => s <= tooth.s)
      if (i === -1) i = teeth.length
      const a = teeth[Math.max(0, i - 1)]!
      const b = teeth[Math.min(teeth.length - 1, i)]!
      const t = a === b ? 0 : (s - a.s) / (b.s - a.s)
      let papilla = 0
      let closed = 0
      let eminence = 0
      for (const tooth of teeth) {
        const r = Math.abs(s - tooth.s) / tooth.halfWidth
        if (r <= 1) {
          papilla = Math.pow(sm(0.3, 1, r), 1.4)
          if (tooth.missing) closed = 1 - sm(0.7, 1, r)
        }
        if (!tooth.missing) {
          eminence +=
            tooth.eminence * Math.exp(-Math.pow((s - tooth.s) / (tooth.halfWidth * 0.62), 2))
        }
      }
      const reach = Math.abs(s)
      // How far the gum runs above the necks before the model ends: the attached gingiva and a
      // band of lining mucosa, as a dental model shows it, not a whole jaw.
      const root =
        (upper ? 10.5 : 9.5) * (primary ? 0.8 : 1) - 1.2 * sm(sum - 4, sum + EXTENSION, reach)
      return {
        neck: a.neck + (b.neck - a.neck) * t,
        halfDepth: a.halfDepth + (b.halfDepth - a.halfDepth) * t,
        root,
        papilla,
        closed,
        eminence,
      }
    }

    // Where the roots are cut: a little inside the shallowest part of the gum.
    let shallowest = Infinity
    for (let i = 0; i <= 60; i++) {
      const s = -sum + (2 * sum * i) / 60
      const g = info(s)
      shallowest = Math.min(shallowest, g.neck * (upper ? 1 : -1) + g.root)
    }
    clipAt[arch] = shallowest - 1.5

    const steps = 420
    const profileSteps = 40
    const positions: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const index: number[] = []
    // The free margin is a touch paler than the attached gingiva below it; beyond the
    // mucogingival line, about five millimetres from the margin, the lining mucosa is redder.
    const margin = new THREE.Color(0xe1918f)
    const attached = new THREE.Color(0xdc8987)
    const mucosa = new THREE.Color(0xbb4a5a)
    const colour = new THREE.Color()
    const end = sum + EXTENSION - 0.5
    for (let i = 0; i <= steps; i++) {
      const s = -end + (2 * end * i) / steps
      const { point, normal } = at(arch, s)
      const g = info(s)
      const reach = Math.abs(s)
      const top = 0.8 + g.papilla * (3.2 - 1.2 * sm(15, 35, reach))
      const d = g.halfDepth
      const r = g.root
      let profile: Array<[number, number]> = [
        [-(d + 0.25), top],
        [-(d + 1.3), top - 1.6],
        [-(d + 2.3), -4],
        [-(d + 2.6), -r * 0.62],
        [-(d + 1.9), -r - 0.6],
        [0, -r - 2.6],
        [d + 1.9, -r - 0.6],
        [d + 2.8, -r * 0.62],
        [d + 2.7, -4],
        [d + 1.4, top - 1.6],
        [d + 0.25, top],
      ]
      if (g.closed > 0) {
        // The socket of a tooth that is gone has healed over: the two margins meet in a ridge.
        const m = g.closed
        profile[0] = [profile[0]![0] * (1 - m) - 0.01 * m, profile[0]![1] * (1 - m) + 2.2 * m]
        profile[10] = [profile[10]![0] * (1 - m) + 0.01 * m, profile[10]![1] * (1 - m) + 2.2 * m]
        profile[1] = [profile[1]![0] * (1 - m) - d * 0.7 * m, profile[1]![1] * (1 - m) + 1.2 * m]
        profile[9] = [profile[9]![0] * (1 - m) + d * 0.7 * m, profile[9]![1] * (1 - m) + 1.2 * m]
      }
      const taper = sm(sum - 0.5, end, reach)
      if (taper > 0) {
        const f = Math.sqrt(Math.max(0, 1 - taper * taper))
        profile = profile.map(([n, h]) => [n * f, -6 + (h + 6) * f])
      }
      const samples = new THREE.SplineCurve(
        profile.map(([n, h]) => new THREE.Vector2(n, h)),
      ).getPoints(profileSteps)
      let travelled = 0
      samples.forEach((q, k) => {
        if (k > 0) travelled += q.distanceTo(samples[k - 1]!)
        const below = top - q.y
        // The root's ridge under the cheek, strongest a few millimetres above the margin.
        const ridge =
          q.x > 0
            ? g.eminence * (1 - g.closed) * sm(0.8, 3.5, below) * (1 - sm(r * 0.55, r, below))
            : 0
        positions.push(
          point.x + normal.x * (q.x + ridge),
          g.neck + (upper ? -q.y : q.y),
          point.z + normal.z * (q.x + ridge),
        )
        colour
          .copy(margin)
          .lerp(attached, sm(0.4, 1.6, below))
          .lerp(mucosa, sm(4.2, 6.5, below))
          // A shade darker in the hollows between the root ridges.
          .multiplyScalar(1 - 0.05 * sm(0.2, 0.6, 0.7 - g.eminence) * sm(1.5, 4, below))
        colors.push(colour.r, colour.g, colour.b)
        uvs.push(s / 5, travelled / 5)
      })
    }
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < profileSteps; j++) {
        const a = i * (profileSteps + 1) + j
        const b = a + profileSteps + 1
        index.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(index)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, gum)
    mesh.receiveShadow = true
    mesh.castShadow = true
    jaw.add(mesh)
    gumMeshes[arch].push(mesh)

    if (upper) {
      // The palate: a vault rising steeply from the gum behind the teeth and flattening toward
      // the midline, with the rugae — the wavy ridges across its front — the raphe down its middle,
      // and the incisive papilla just behind the central incisors. Each row of the mesh runs from
      // the gum to the midline at one depth, so a ruga is a function of how far back the row is.
      const rows = 220
      const columns = 30
      const palate: number[] = []
      const palateColors: number[] = []
      const palateIndex: number[] = []
      const front = new THREE.Color(0xe5959d)
      const vault = new THREE.Color(0xcf7883)
      const reachEnd = sum + 1
      for (let i = 0; i <= rows; i++) {
        const s = -reachEnd + (2 * reachEnd * i) / rows
        const { point, normal } = at(arch, s)
        const g = info(s)
        const qx = point.x - normal.x * (g.halfDepth + 2.3)
        const qz = point.z - normal.z * (g.halfDepth + 2.3)
        const qy = g.neck + 3.5
        const vy = g.neck + (primary ? 9 : 13)
        // How far behind the front of the arch this row is.
        const back = -qz
        for (let j = 0; j <= columns; j++) {
          const u = j / columns
          const rise = 1 - Math.pow(1 - u, 2.4)
          const rugae =
            0.55 *
            Math.max(0, Math.sin(back * 1.15 + 0.9 * Math.sin(u * 7 + back * 0.3))) *
            sm(6, 9, back) *
            (1 - sm(18, 24, back)) *
            sm(0.15, 0.45, u) *
            (1 - sm(0.8, 0.97, u))
          const raphe = 0.3 * Math.exp(-Math.pow((1 - u) * 16, 2)) * sm(8, 12, back)
          const papilla =
            1.1 * Math.exp(-Math.pow((1 - u) * 5, 2)) * Math.exp(-Math.pow((back - 8) / 2.2, 2))
          // The two halves meet at the midline; each runs a hair past it, so no crack shows.
          palate.push(qx * (1 - 1.012 * u), qy + (vy - qy) * rise - rugae - raphe - papilla, qz)
          colour
            .copy(front)
            .lerp(vault, sm(0.2, 1, u))
            .multiplyScalar(1 + 0.06 * rugae)
          palateColors.push(colour.r, colour.g, colour.b)
        }
      }
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
          const a = i * (columns + 1) + j
          const b = a + columns + 1
          palateIndex.push(a, b, a + 1, b, b + 1, a + 1)
        }
      }
      const palateGeometry = new THREE.BufferGeometry()
      palateGeometry.setAttribute('position', new THREE.Float32BufferAttribute(palate, 3))
      palateGeometry.setAttribute('color', new THREE.Float32BufferAttribute(palateColors, 3))
      palateGeometry.setIndex(palateIndex)
      palateGeometry.computeVertexNormals()
      const palateMesh = new THREE.Mesh(palateGeometry, palateTissue)
      palateMesh.receiveShadow = true
      palateMesh.userData.palate = true
      jaw.add(palateMesh)
      gumMeshes.u.push(palateMesh)
    }
    applyMaterials()
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────

  let xray = false
  let selected: string | null = null
  let hovered: string | null = null
  let highlight = new Set<string>()
  let highlightUntil = 0
  let openTarget = 0
  let open = 0
  let active = true
  let badges: ReadonlyMap<string, HTMLElement> = new Map()
  let missingKey = ''
  let dirty = true
  const invalidate = () => {
    dirty = true
  }

  function applyMaterials() {
    for (const slot of slots.values()) {
      const v = slot.visual
      slot.natural.material = xray ? xrTooth : slot.enamel
      slot.prosthetic.material = xray ? xrDense : slot.ceramic
      slot.shell.material = xray ? xrDense : slot.ceramic
      slot.implant.material = xray ? xrDense : titaniumOf[slot.upper ? 'u' : 'l']
      for (const canal of slot.canals) {
        canal.material = xray ? xrDense : gutta
        canal.visible = xray && v?.rootCanal === 'done' && !v.absent && !v.replacedBy
      }
      for (const part of slot.pulp) {
        part.visible = xray && v?.rootCanal !== 'done' && !v?.absent && !v?.replacedBy
      }
      slot.planned.visible = !xray && Boolean(v?.planned) && !v?.absent
      for (const spot of slot.decay) spot.visible = !xray && Boolean(v?.caries) && !v?.absent
      slot.ghost.visible = !xray && Boolean(v?.absent)
    }
    for (const mesh of [...gumMeshes.u, ...gumMeshes.l]) {
      mesh.material = xray ? xrSoft : mesh.userData.palate ? palateTissue : gum
    }
    scene.background = xray ? XRAY_BACKGROUND : BACKGROUND
    gtao.enabled = !xray
  }

  function applyVisual(slot: Slot) {
    const v = slot.visual
    const absent = Boolean(v?.absent)
    const replaced = Boolean(v?.replacedBy)
    slot.natural.visible = !absent && !replaced
    slot.prosthetic.visible = !absent && replaced
    slot.shell.visible =
      !absent &&
      !replaced &&
      (v?.crown === 'done' || v?.veneer === 'done' || v?.bridgeRole === 'ABUTMENT')
    slot.implant.visible = !absent && v?.replacedBy === 'IMPLANT'

    // An impacted tooth sits tilted toward its neighbour and part-way under the gum.
    slot.group.position.copy(slot.base.position)
    slot.group.quaternion.copy(slot.base.quaternion)
    if (v?.impacted && !absent) {
      const mesial = slot.quadrant % 2 === 1 ? 0.55 : -0.55
      slot.group.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), mesial),
      )
      slot.group.translateY(-4)
    }
  }

  function glow(now: number) {
    const pulse = now < highlightUntil ? 0.5 + 0.5 * Math.sin(now / 180) : 0
    for (const slot of slots.values()) {
      const colour =
        slot.fdi === selected
          ? 0x2a6fc4
          : slot.fdi === hovered
            ? 0x3a3a3a
            : highlight.has(slot.fdi) && pulse > 0
              ? 0x1d9e75
              : 0
      const intensity = slot.fdi === selected ? 0.35 : slot.fdi === hovered ? 0.5 : 0.45 * pulse
      for (const material of [slot.enamel, slot.ceramic]) {
        material.emissive.setHex(colour)
        material.emissiveIntensity = intensity
      }
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────────────────

  const target = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const gtao = new GTAOPass(scene, camera, 4, 4)
  gtao.updateGtaoMaterial({ radius: 3, distanceExponent: 1, thickness: 2, scale: 1.3, samples: 16 })
  gtao.blendIntensity = 1
  composer.addPass(gtao)
  composer.addPass(new OutputPass())

  function resize() {
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height)
    composer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    dirty = true
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(container)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pick(event: PointerEvent): string | null {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(picks, false).find((candidate) => {
      if (!candidate.object.visible) return false
      const slot = slots.get(candidate.object.userData.fdi as string)
      return slot ? (slot.upper ? upperJaw.visible : lowerJaw.visible) : false
    })
    return hit ? (hit.object.userData.fdi as string) : null
  }

  let down: { x: number; y: number } | null = null
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY }
  }
  const onUp = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) {
      const fdi = pick(event)
      if (fdi) callbacks.onPick(fdi)
    }
    down = null
  }
  const onMove = (event: PointerEvent) => {
    if (down) return
    const fdi = pick(event)
    if (fdi !== hovered) {
      hovered = fdi
      dirty = true
    }
    const rect = container.getBoundingClientRect()
    callbacks.onHover(
      fdi,
      fdi ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null,
    )
    renderer.domElement.style.cursor = fdi ? 'pointer' : 'grab'
  }
  const onLeave = () => {
    if (hovered) dirty = true
    hovered = null
    callbacks.onHover(null, null)
  }
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)
  renderer.domElement.addEventListener('pointermove', onMove)
  renderer.domElement.addEventListener('pointerleave', onLeave)

  const world = new THREE.Vector3()
  const groupWorld = new THREE.Vector3()
  const outward = new THREE.Vector3()
  const toCamera = new THREE.Vector3()
  let frame = 0
  // A still jaw is not redrawn. Ambient occlusion on a software renderer costs a whole frame, and
  // drawing it sixty times a second for nothing starves the page it sits on — forms stop
  // answering clicks. Something has to change (a drag, the damping settling after one, the mouth
  // opening, the "changed today" pulse, a setter, a resize) before the next frame is drawn.
  function loop(now: number) {
    frame = requestAnimationFrame(loop)
    if (!active) return
    const moving = controls.update()
    const opening = Math.abs(openTarget - open) > 0.01
    const pulsing = now < highlightUntil + 200
    if (!dirty && !moving && !opening && !pulsing) return
    dirty = false
    open = opening ? open + (openTarget - open) * 0.12 : openTarget
    upperJaw.position.y = open / 2
    lowerJaw.position.y = -open / 2
    clip.u.constant = clipAt.u + open / 2
    clip.l.constant = clipAt.l + open / 2
    glow(now)
    composer.render()

    const width = container.clientWidth
    const height = container.clientHeight
    for (const [fdi, element] of badges) {
      const slot = slots.get(fdi)
      const jawShown = slot ? (slot.upper ? upperJaw.visible : lowerJaw.visible) : false
      if (!slot || !jawShown || xray) {
        element.style.display = 'none'
        continue
      }
      slot.anchor.getWorldPosition(world)
      slot.group.getWorldPosition(groupWorld)
      outward.subVectors(world, groupWorld)
      toCamera.subVectors(camera.position, world)
      if (outward.dot(toCamera) < -0.1 * outward.length() * toCamera.length()) {
        element.style.display = 'none'
        continue
      }
      world.project(camera)
      if (world.z > 1) {
        element.style.display = 'none'
        continue
      }
      element.style.display = 'flex'
      element.style.transform = `translate(-50%, -50%) translate(${((world.x + 1) / 2) * width}px, ${((1 - world.y) / 2) * height}px)`
    }
  }
  frame = requestAnimationFrame(loop)

  for (const upper of [true, false]) buildGums(upper)

  return {
    setTeeth(visuals) {
      for (const slot of slots.values()) {
        slot.visual = visuals.get(slot.fdi) ?? null
        applyVisual(slot)
      }
      const nextMissing = [...slots.values()]
        .filter((slot) => slot.visual?.absent)
        .map((slot) => slot.fdi)
        .join(',')
      if (nextMissing !== missingKey) {
        missingKey = nextMissing
        buildGums(true)
        buildGums(false)
      } else applyMaterials()
      invalidate()
    },
    setSelected(fdi) {
      selected = fdi
      invalidate()
    },
    setHighlight(fdis) {
      highlight = new Set(fdis)
      highlightUntil = performance.now() + 6000
      invalidate()
    },
    setXray(on) {
      xray = on
      applyMaterials()
      invalidate()
    },
    setOpen(on) {
      openTarget = on ? 12 : 0
    },
    setView(view) {
      upperJaw.visible = view !== 'lower'
      lowerJaw.visible = view !== 'upper'
      const place = {
        front: [0, 3, 140],
        right: [-130, 5, 0],
        upper: [0, -135, 10],
        lower: [0, 135, 10],
      }[view]
      camera.position.set(place[0]!, place[1]!, place[2]!)
      controls.target.set(0, 0, 0)
      controls.update()
      invalidate()
    },
    setActive(value) {
      active = value
      if (value) resize()
      invalidate()
    },
    setBadges(elements) {
      badges = elements
      invalidate()
    },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      for (const meshes of [gumMeshes.u, gumMeshes.l])
        for (const mesh of meshes) mesh.geometry.dispose()
      for (const slot of slots.values()) {
        slot.enamel.dispose()
        slot.ceramic.dispose()
        for (const canal of slot.canals) canal.geometry.dispose()
        for (const part of slot.pulp) if (part.geometry !== pulpChamber) part.geometry.dispose()
      }
      // Tooth meshes are shared by every chart on the page and kept for the next one.
      for (const material of [
        titanium,
        gutta,
        decay,
        glass,
        ghost,
        gum,
        palateTissue,
        xrTooth,
        xrDense,
        xrSoft,
      ])
        material.dispose()
      titaniumOf.u?.dispose()
      titaniumOf.l?.dispose()
      implantShape.dispose()
      decayShape.dispose()
      pulpChamber.dispose()
      xrPulp.dispose()
      stipple.dispose()
      pmrem.dispose()
      BACKGROUND.dispose()
      target.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
