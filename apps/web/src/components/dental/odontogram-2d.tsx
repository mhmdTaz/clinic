'use client'

import { useMemo, type KeyboardEvent } from 'react'
import type { Dentition, ToothState } from '@clinic/contracts'
import { dimsOf, kindOf, type ToothKind } from './jaw/tooth-dims'
import { toothVisual, type Tone, type ToothVisual } from './tooth-visual'

/**
 * The classic chart (Phase 11): the one a dentist trained on paper reads without thinking. Teeth
 * in FDI order, the patient's right on the viewer's left, upper roots up and lower roots down, and
 * under each tooth the five-surface diagram. Plain SVG, no WebGL: it is the fallback when 3D is
 * unavailable, the view a keyboard or a screen reader uses, and what prints.
 */

const BLUE = '#185FA5'
const RED = '#E24B4A'
const TOOTH = '#fbf7ef'
const ROOT = '#efe4cc'
const ROOT_BEHIND = '#e6d8bb'
const OUTLINE = '#a7a197'
const MM = 3.4
const SLOT = 42

const toneColour = (tone: Tone) => (tone === 'done' ? BLUE : RED)
const f = (value: number) => Math.round(value * 10) / 10

function crownPath(kind: ToothKind, w: number, c: number): string {
  switch (kind) {
    case 'inc':
      return `M${f(-0.36 * w)},0 L${f(-0.47 * w)},${f(0.72 * c)} Q${f(-0.47 * w)},${f(c)} ${f(-0.3 * w)},${f(c)} L${f(0.3 * w)},${f(c)} Q${f(0.47 * w)},${f(c)} ${f(0.47 * w)},${f(0.72 * c)} L${f(0.36 * w)},0 Z`
    case 'can':
      return `M${f(-0.36 * w)},0 L${f(-0.49 * w)},${f(0.58 * c)} L${f(-0.1 * w)},${f(0.97 * c)} Q0,${f(1.04 * c)} ${f(0.1 * w)},${f(0.97 * c)} L${f(0.49 * w)},${f(0.58 * c)} L${f(0.36 * w)},0 Z`
    case 'pre':
      return `M${f(-0.37 * w)},0 Q${f(-0.53 * w)},${f(0.45 * c)} ${f(-0.44 * w)},${f(0.8 * c)} Q${f(-0.34 * w)},${f(1.02 * c)} ${f(-0.16 * w)},${f(0.9 * c)} Q0,${f(0.8 * c)} ${f(0.16 * w)},${f(0.9 * c)} Q${f(0.34 * w)},${f(1.02 * c)} ${f(0.44 * w)},${f(0.8 * c)} Q${f(0.53 * w)},${f(0.45 * c)} ${f(0.37 * w)},0 Z`
    case 'mol':
      return `M${f(-0.4 * w)},0 Q${f(-0.54 * w)},${f(0.45 * c)} ${f(-0.46 * w)},${f(0.8 * c)} Q${f(-0.36 * w)},${f(c)} ${f(-0.2 * w)},${f(0.92 * c)} Q${f(-0.05 * w)},${f(0.84 * c)} 0,${f(0.9 * c)} Q${f(0.05 * w)},${f(0.84 * c)} ${f(0.2 * w)},${f(0.92 * c)} Q${f(0.36 * w)},${f(c)} ${f(0.46 * w)},${f(0.8 * c)} Q${f(0.54 * w)},${f(0.45 * c)} ${f(0.4 * w)},0 Z`
  }
}

/** [x offset, half width, length, tilt, drawn behind] for each root. */
type Root = [number, number, number, number, boolean?]

function rootsOf(
  kind: ToothKind,
  upper: boolean,
  primary: boolean,
  position: number,
  w: number,
  r: number,
): Root[] {
  if (kind === 'mol') {
    return upper
      ? [
          [0, 0.2 * w, 1.05 * r, 0, true],
          [-0.22 * w, 0.16 * w, r, -0.08 * w],
          [0.22 * w, 0.16 * w, 0.95 * r, 0.08 * w],
        ]
      : [
          [-0.22 * w, 0.17 * w, r, -0.08 * w],
          [0.22 * w, 0.17 * w, 0.95 * r, 0.08 * w],
        ]
  }
  if (upper && !primary && position === 4) {
    return [
      [-0.14 * w, 0.17 * w, r, -0.05 * w],
      [0.14 * w, 0.17 * w, 0.95 * r, 0.05 * w],
    ]
  }
  return [[0, 0.3 * w, r, 0]]
}

function rootPath([x0, hw, length, tilt]: Root): string {
  return `M${f(x0 - hw)},0 Q${f(x0 - hw * 0.95 + tilt * 0.4)},${f(-0.6 * length)} ${f(x0 - hw * 0.2 + tilt)},${f(-length)} Q${f(x0 + tilt)},${f(-1.04 * length)} ${f(x0 + hw * 0.2 + tilt)},${f(-length)} Q${f(x0 + hw * 0.95 + tilt * 0.4)},${f(-0.6 * length)} ${f(x0 + hw)},0 Z`
}

function sector(
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  outer: number,
  inner: number,
): string {
  const p = (angle: number, radius: number) =>
    `${f(cx + radius * Math.cos(angle))},${f(cy + radius * Math.sin(angle))}`
  return `M${p(a0, outer)} A${outer},${outer} 0 0 1 ${p(a1, outer)} L${p(a1, inner)} A${inner},${inner} 0 0 0 ${p(a0, inner)} Z`
}

interface Placement {
  fdi: string
  x: number
  cervix: number
  upper: boolean
  primary: boolean
  surfaceY: number
  numberY: number
  band: [number, number]
}

const UPPER_PERMANENT = [
  '18',
  '17',
  '16',
  '15',
  '14',
  '13',
  '12',
  '11',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
]
const LOWER_PERMANENT = [
  '48',
  '47',
  '46',
  '45',
  '44',
  '43',
  '42',
  '41',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
]
const UPPER_PRIMARY = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65']
const LOWER_PRIMARY = ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75']

/** Slot centres for a row of teeth, with a gap at the midline. */
function slotsOf(teeth: readonly string[]): Map<string, number> {
  const width = teeth.length * SLOT + 8
  const start = (720 - width) / 2
  return new Map(
    teeth.map((fdi, i) => [fdi, start + i * SLOT + SLOT / 2 + (i >= teeth.length / 2 ? 8 : 0)]),
  )
}

/** Where every tooth goes, and how tall the chart is, for a dentition. */
function layoutOf(dentition: Dentition): {
  placements: Placement[]
  height: number
  separator: number
} {
  const permanent = new Map([...slotsOf(UPPER_PERMANENT), ...slotsOf(LOWER_PERMANENT)])
  const row = (
    teeth: readonly string[],
    x: (fdi: string) => number,
    upper: boolean,
    primary: boolean,
    cervix: number,
    numberY: number,
    surfaceY: number,
    band: [number, number],
  ) => teeth.map((fdi) => ({ fdi, x: x(fdi), cervix, upper, primary, numberY, surfaceY, band }))

  if (dentition === 'MIXED') {
    // A primary tooth sits under the permanent tooth that will replace it: 55 under 15.
    const under = (fdi: string) => permanent.get(`${Number(fdi[0]) - 4}${fdi[1]}`)!
    return {
      placements: [
        ...row(UPPER_PERMANENT, (t) => permanent.get(t)!, true, false, 100, 160, 187, [26, 202]),
        ...row(UPPER_PRIMARY, under, true, true, 250, 290, 314, [206, 330]),
        ...row(LOWER_PRIMARY, under, false, true, 450, 392, 366, [350, 490]),
        ...row(LOWER_PERMANENT, (t) => permanent.get(t)!, false, false, 600, 548, 520, [504, 670]),
      ],
      height: 680,
      separator: 340,
    }
  }
  const upper = dentition === 'PRIMARY' ? UPPER_PRIMARY : UPPER_PERMANENT
  const lower = dentition === 'PRIMARY' ? LOWER_PRIMARY : LOWER_PERMANENT
  const slots = new Map([...slotsOf(upper), ...slotsOf(lower)])
  const primary = dentition === 'PRIMARY'
  return {
    placements: [
      ...row(upper, (t) => slots.get(t)!, true, primary, 100, 160, 187, [26, 214]),
      ...row(lower, (t) => slots.get(t)!, false, primary, 322, 270, 240, [221, 393]),
    ],
    height: 400,
    separator: 217,
  }
}

function ToothFigure({ placement, visual }: { placement: Placement; visual: ToothVisual }) {
  const { fdi, upper, primary } = placement
  const position = Number(fdi[1])
  const kind = kindOf(primary, position)
  const [W, , CH, RL] = dimsOf(upper, primary, position)
  const w = W * MM
  const c = CH * MM
  const r = RL * MM
  const roots = rootsOf(kind, upper, primary, position, w, r)
  const prosthetic = visual.replacedBy !== null
  const crownTone = visual.crown ?? (visual.veneer === 'done' ? 'done' : null)
  const covered = crownTone === 'done' || prosthetic
  const crownFill = visual.replacedBy === 'DENTURE' ? '#f7d6da' : covered ? '#dbe9f7' : TOOTH
  const crownStroke = covered ? BLUE : OUTLINE

  return (
    <g
      transform={`translate(${placement.x},${placement.cervix}) scale(1,${upper ? 1 : -1})${
        visual.impacted ? ` rotate(${Number(fdi[0]) % 2 === 1 ? -22 : 22})` : ''
      }`}
      opacity={visual.absent ? 0.28 : 1}
    >
      {visual.replacedBy === 'IMPLANT' ? (
        <>
          <rect
            x={f(-0.17 * w)}
            y={f(-0.85 * r)}
            width={f(0.34 * w)}
            height={f(0.85 * r)}
            rx={2}
            fill="#dfe3e8"
            stroke={BLUE}
            strokeWidth={1.2}
          />
          {Array.from({ length: Math.floor((0.85 * r - 6) / 4.5) }, (_, i) => {
            const y = -0.85 * r + 4 + i * 4.5
            return (
              <line
                key={i}
                x1={f(-0.2 * w)}
                y1={f(y)}
                x2={f(0.2 * w)}
                y2={f(y - 1.5)}
                stroke={BLUE}
                strokeWidth={0.8}
              />
            )
          })}
        </>
      ) : visual.replacedBy === 'PONTIC' || visual.replacedBy === 'DENTURE' ? null : (
        roots.map((root, i) => (
          <path
            key={i}
            d={rootPath(root)}
            fill={root[4] ? ROOT_BEHIND : ROOT}
            stroke={OUTLINE}
            strokeWidth={0.8}
            strokeDasharray={visual.absent ? '3 2' : undefined}
          />
        ))
      )}
      <path
        d={crownPath(kind, w, c)}
        fill={crownFill}
        stroke={crownStroke}
        strokeWidth={covered ? 2.2 : 0.9}
        strokeDasharray={visual.absent ? '3 2' : undefined}
      />
      {crownTone === 'todo' || (visual.planned && !covered && visual.implant === 'todo') ? (
        <path
          d={crownPath(kind, w * 1.08, c * 1.05)}
          fill="none"
          stroke={RED}
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      ) : null}
      {visual.rootCanal && !prosthetic
        ? roots
            .filter((root) => !root[4])
            .map((root, i) => (
              <line
                key={i}
                x1={f(root[0])}
                y1={f(0.3 * c)}
                x2={f(root[0] + root[3] * 0.9)}
                y2={f(-0.92 * root[2])}
                stroke={toneColour(visual.rootCanal!)}
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            ))
        : null}
      {visual.caries ? <circle cx={0} cy={f(0.72 * c)} r={3.6} fill={RED} /> : null}
      {visual.fracture ? (
        <polyline
          points={`${f(-0.25 * w)},${f(0.95 * c)} ${f(-0.05 * w)},${f(0.6 * c)} ${f(0.1 * w)},${f(0.75 * c)} ${f(0.25 * w)},${f(0.35 * c)}`}
          fill="none"
          stroke={RED}
          strokeWidth={1.8}
        />
      ) : null}
    </g>
  )
}

function SurfaceDiagram({ placement, visual }: { placement: Placement; visual: ToothVisual }) {
  const { x, surfaceY: y, upper, fdi } = placement
  const quadrant = Number(fdi[0])
  // Mesial faces the midline: the right-hand side of a tooth in the patient's right quadrants.
  const mesialRight = quadrant === 1 || quadrant === 4 || quadrant === 5 || quadrant === 8
  const fill = (surface: 'M' | 'D' | 'B' | 'L' | 'C') => {
    const tone =
      surface === 'C' ? (visual.surfaces.O ?? visual.surfaces.I) : visual.surfaces[surface]
    return tone ? toneColour(tone) : 'var(--color-background, #fff)'
  }
  const q = Math.PI / 4
  const top: 'B' | 'L' = upper ? 'B' : 'L'
  const bottom: 'B' | 'L' = upper ? 'L' : 'B'
  const segments: Array<[string, number, number]> = [
    [fill(top), -3 * q, -q],
    [fill(mesialRight ? 'M' : 'D'), -q, q],
    [fill(bottom), q, 3 * q],
    [fill(mesialRight ? 'D' : 'M'), 3 * q, 5 * q],
  ]
  return (
    <g aria-hidden="true">
      {segments.map(([colour, a0, a1], i) => (
        <path
          key={i}
          d={sector(x, y, a0, a1, 13, 5.5)}
          fill={colour}
          stroke="#b4b2a9"
          strokeWidth={0.8}
        />
      ))}
      <circle cx={x} cy={y} r={5.5} fill={fill('C')} stroke="#b4b2a9" strokeWidth={0.8} />
    </g>
  )
}

export function Odontogram2D({
  dentition,
  teeth,
  selected,
  highlight,
  onSelect,
  toothLabel,
  labels,
}: {
  dentition: Dentition
  teeth: readonly ToothState[]
  selected: string | null
  highlight: readonly string[]
  onSelect: (fdi: string) => void
  toothLabel: (fdi: string) => string
  labels: { right: string; left: string; upper: string; lower: string; chart: string }
}) {
  const { placements, height, separator } = useMemo(() => layoutOf(dentition), [dentition])
  const visuals = useMemo(
    () => new Map(teeth.map((tooth) => [tooth.fdi, toothVisual(tooth)])),
    [teeth],
  )
  const highlighted = new Set(highlight)
  const empty = (fdi: string): ToothVisual => toothVisual({ fdi, present: true, marks: [] })

  // Adjacent bridge teeth are joined by a bar across their crowns.
  const connectors = placements.filter((placement, i) => {
    const next = placements[i + 1]
    if (!next || next.upper !== placement.upper || next.primary !== placement.primary) return false
    return Boolean(visuals.get(placement.fdi)?.bridgeRole && visuals.get(next.fdi)?.bridgeRole)
  })

  const onKey = (event: KeyboardEvent, fdi: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(fdi)
    }
  }

  return (
    <svg
      viewBox={`0 0 720 ${height}`}
      width="100%"
      role="group"
      aria-label={labels.chart}
      className="block"
    >
      <line
        x1={364}
        y1={30}
        x2={364}
        y2={height - 8}
        className="stroke-border"
        strokeWidth={0.5}
        strokeDasharray="4 4"
      />
      <line
        x1={16}
        y1={separator}
        x2={712}
        y2={separator}
        className="stroke-border"
        strokeWidth={0.5}
      />
      <text x={20} y={18} fontSize={11} className="fill-muted-foreground">
        {labels.right}
      </text>
      <text x={712} y={18} fontSize={11} textAnchor="end" className="fill-muted-foreground">
        {labels.left}
      </text>
      <text x={364} y={18} fontSize={11} textAnchor="middle" className="fill-muted-foreground">
        {labels.upper}
      </text>
      <text
        x={364}
        y={height - 2}
        fontSize={11}
        textAnchor="middle"
        className="fill-muted-foreground"
      >
        {labels.lower}
      </text>

      {placements.map((placement) => {
        const visual = visuals.get(placement.fdi) ?? empty(placement.fdi)
        const isSelected = placement.fdi === selected
        return (
          <g
            key={placement.fdi}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={toothLabel(placement.fdi)}
            className="group cursor-pointer outline-none"
            onClick={() => onSelect(placement.fdi)}
            onKeyDown={(event) => onKey(event, placement.fdi)}
          >
            <title>{toothLabel(placement.fdi)}</title>
            <rect
              x={placement.x - 20}
              y={placement.band[0]}
              width={40}
              height={placement.band[1] - placement.band[0]}
              rx={6}
              className={
                isSelected
                  ? 'fill-primary/15 stroke-primary'
                  : 'group-hover:fill-muted group-focus-visible:stroke-primary fill-transparent stroke-transparent'
              }
              strokeWidth={1.5}
            />
            {highlighted.has(placement.fdi) ? (
              <rect
                x={placement.x - 20}
                y={placement.band[0]}
                width={40}
                height={placement.band[1] - placement.band[0]}
                rx={6}
                fill="none"
                stroke="#1D9E75"
                strokeWidth={2}
                className="animate-pulse"
              />
            ) : null}
            <ToothFigure placement={placement} visual={visual} />
            {visual.extraction ? (
              <g stroke={toneColour(visual.extraction)} strokeWidth={2.4} strokeLinecap="round">
                <line
                  x1={placement.x - 14}
                  y1={placement.cervix + (placement.upper ? -40 : 40)}
                  x2={placement.x + 14}
                  y2={placement.cervix + (placement.upper ? 32 : -32)}
                />
                <line
                  x1={placement.x + 14}
                  y1={placement.cervix + (placement.upper ? -40 : 40)}
                  x2={placement.x - 14}
                  y2={placement.cervix + (placement.upper ? 32 : -32)}
                />
              </g>
            ) : null}
            <text
              x={placement.x}
              y={placement.numberY}
              fontSize={11}
              textAnchor="middle"
              className={isSelected ? 'fill-primary font-medium' : 'fill-muted-foreground'}
            >
              {placement.fdi}
            </text>
            <SurfaceDiagram placement={placement} visual={visual} />
          </g>
        )
      })}

      {connectors.map((placement) => {
        const next = placements[placements.indexOf(placement) + 1]!
        const y = placement.cervix + (placement.upper ? 18 : -18)
        return (
          <line
            key={`bridge-${placement.fdi}`}
            x1={placement.x + 12}
            y1={y}
            x2={next.x - 12}
            y2={y}
            stroke={BLUE}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}
