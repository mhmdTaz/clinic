import { describe, expect, it } from 'vitest'
import type { ToothRecordStatus } from '@clinic/config'
import { deriveChart, type ChartableRecord } from '../domain/derive-chart'
import {
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  belongsTo,
  isContinuousSpan,
  predecessorOf,
  successorOf,
  teethOf,
} from '../domain/fdi'
import { chartingProblems, statusProblem } from '../domain/rules'

describe('FDI numbering', () => {
  it('has 32 permanent and 20 primary teeth, read from the patient’s upper right', () => {
    expect(PERMANENT_TEETH).toHaveLength(32)
    expect(PRIMARY_TEETH).toHaveLength(20)
    expect(PERMANENT_TEETH.slice(0, 9)).toEqual([
      '18',
      '17',
      '16',
      '15',
      '14',
      '13',
      '12',
      '11',
      '21',
    ])
    // The lower jaw is read from the patient's right too: 48 first, 38 last.
    expect(PERMANENT_TEETH[16]).toBe('48')
    expect(PERMANENT_TEETH.at(-1)).toBe('38')
  })

  it('draws both sets for a mixed dentition', () => {
    expect(teethOf('MIXED')).toHaveLength(52)
    expect(belongsTo('55', 'PERMANENT')).toBe(false)
    expect(belongsTo('15', 'PRIMARY')).toBe(false)
    expect(belongsTo('55', 'MIXED')).toBe(true)
  })

  it('knows which permanent tooth replaces a primary one, and that molars replace nothing', () => {
    expect(successorOf('55')).toBe('15')
    expect(successorOf('83')).toBe('43')
    expect(predecessorOf('43')).toBe('83')
    expect(predecessorOf('16')).toBeNull()
    expect(successorOf('16')).toBeNull()
  })

  it('treats a bridge span as continuous only along one arch, across the midline included', () => {
    expect(isContinuousSpan(['14', '15', '16'])).toBe(true)
    expect(isContinuousSpan(['11', '21'])).toBe(true)
    expect(isContinuousSpan(['12', '11', '21'])).toBe(true)
    expect(isContinuousSpan(['14', '16'])).toBe(false)
    expect(isContinuousSpan(['16', '46'])).toBe(false)
    expect(isContinuousSpan(['55', '15'])).toBe(false)
    expect(isContinuousSpan(['16'])).toBe(false)
  })
})

describe('what can be charted', () => {
  const one = (fdi: string) => [{ fdi, role: null }]

  it('puts a filling on surfaces the tooth has', () => {
    expect(
      chartingProblems({
        teeth: one('16'),
        surfaces: ['M', 'O'],
        scope: 'SURFACE',
        dentition: 'PERMANENT',
      }),
    ).toEqual([])
    expect(
      chartingProblems({
        teeth: one('11'),
        surfaces: ['O'],
        scope: 'SURFACE',
        dentition: 'PERMANENT',
      }),
    ).toEqual([{ field: 'surfaces', issue: 'NO_OCCLUSAL_ON_FRONT_TOOTH' }])
    expect(
      chartingProblems({
        teeth: one('36'),
        surfaces: [],
        scope: 'SURFACE',
        dentition: 'PERMANENT',
      }),
    ).toEqual([{ field: 'surfaces', issue: 'REQUIRED' }])
  })

  it('refuses a tooth the patient’s dentition does not have', () => {
    expect(
      chartingProblems({ teeth: one('55'), surfaces: [], scope: 'TOOTH', dentition: 'PERMANENT' }),
    ).toEqual([{ field: 'teeth', issue: 'NOT_IN_DENTITION' }])
  })

  it('needs a bridge to stand on an abutment and carry a pontic, across adjacent teeth', () => {
    const bridge = [
      { fdi: '45', role: 'ABUTMENT' as const },
      { fdi: '46', role: 'PONTIC' as const },
      { fdi: '47', role: 'ABUTMENT' as const },
    ]
    expect(
      chartingProblems({ teeth: bridge, surfaces: [], scope: 'SPAN', dentition: 'PERMANENT' }),
    ).toEqual([])
    const floating = bridge.map((tooth) => ({ ...tooth, role: 'PONTIC' as const }))
    expect(
      chartingProblems({ teeth: floating, surfaces: [], scope: 'SPAN', dentition: 'PERMANENT' }),
    ).toEqual([{ field: 'teeth', issue: 'NEEDS_ABUTMENT' }])
    const gapped = [bridge[0]!, { fdi: '47', role: 'PONTIC' as const }]
    expect(
      chartingProblems({ teeth: gapped, surfaces: [], scope: 'SPAN', dentition: 'PERMANENT' }),
    ).toContainEqual({ field: 'teeth', issue: 'NOT_A_SPAN' })
  })

  it('keeps a finding a finding, and work work', () => {
    expect(statusProblem('CARIES', 'CONDITION')).toBeNull()
    expect(statusProblem('CARIES', 'PLANNED')).toEqual({
      field: 'status',
      issue: 'FINDING_IS_A_CONDITION',
    })
    expect(statusProblem('CROWN', 'CONDITION')).toEqual({
      field: 'status',
      issue: 'WORK_IS_NOT_A_CONDITION',
    })
    expect(statusProblem('MISSING', 'EXISTING')).toBeNull()
    expect(statusProblem('MISSING', 'COMPLETED')).toEqual({
      field: 'status',
      issue: 'MISSING_IS_FOUND',
    })
  })
})

let sequence = 0
const row = (
  fdi: string,
  symbol: ChartableRecord['symbol'],
  status: ToothRecordStatus,
  performedOn: string,
  extra: Partial<ChartableRecord> = {},
): ChartableRecord => {
  sequence += 1
  return {
    id: `r${sequence}`,
    encounterId: null,
    teeth: [{ fdi, role: null }],
    surfaces: [],
    symbol,
    treatmentName: symbol,
    status,
    completesRecordId: null,
    performedOn,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    voided: false,
    ...extra,
  }
}

const toothOf = (chart: ReturnType<typeof deriveChart>, fdi: string) =>
  chart.teeth.find((tooth) => tooth.fdi === fdi)!

describe('the picture drawn from the log', () => {
  it('draws every tooth of the dentition, charted or not', () => {
    const chart = deriveChart({ records: [], dentition: 'PERMANENT', asOf: null })
    expect(chart.teeth).toHaveLength(32)
    expect(chart.teeth.every((tooth) => tooth.present && tooth.marks.length === 0)).toBe(true)
    expect(chart.lastCharted).toBeNull()
    expect(chart.history).toEqual([])
  })

  it('never hides a charted tooth, even outside the dentition', () => {
    const chart = deriveChart({
      records: [row('55', 'FILLING', 'COMPLETED', '2026-01-05')],
      dentition: 'PERMANENT',
      asOf: null,
    })
    expect(toothOf(chart, '55').marks).toHaveLength(1)
  })

  it('leaves voided rows out of the picture and out of the slider', () => {
    const chart = deriveChart({
      records: [row('16', 'CROWN', 'COMPLETED', '2026-02-01', { voided: true })],
      dentition: 'PERMANENT',
      asOf: null,
    })
    expect(toothOf(chart, '16').marks).toEqual([])
    expect(chart.history).toEqual([])
  })

  it('replaces a plan with the row that carried it out', () => {
    const plan = row('16', 'CROWN', 'PLANNED', '2026-02-01')
    const done = row('16', 'CROWN', 'COMPLETED', '2026-03-01', { completesRecordId: plan.id })
    const chart = deriveChart({ records: [plan, done], dentition: 'PERMANENT', asOf: null })
    expect(toothOf(chart, '16').marks.map((mark) => mark.status)).toEqual(['COMPLETED'])

    // Replayed before the crown was fitted, the plan is still showing.
    const before = deriveChart({
      records: [plan, done],
      dentition: 'PERMANENT',
      asOf: '2026-02-15',
    })
    expect(toothOf(before, '16').marks.map((mark) => mark.status)).toEqual(['PLANNED'])
  })

  it('takes a tooth out of the mouth when it is extracted, and puts it back for an implant', () => {
    const extracted = row('36', 'EXTRACTION', 'COMPLETED', '2025-06-03')
    const implant = row('36', 'IMPLANT', 'COMPLETED', '2025-11-14')
    expect(
      toothOf(deriveChart({ records: [extracted], dentition: 'PERMANENT', asOf: null }), '36')
        .present,
    ).toBe(false)
    expect(
      toothOf(
        deriveChart({ records: [extracted, implant], dentition: 'PERMANENT', asOf: null }),
        '36',
      ).present,
    ).toBe(true)
    // A planned extraction has not happened yet.
    const planned = row('48', 'EXTRACTION', 'PLANNED', '2026-09-26')
    expect(
      toothOf(deriveChart({ records: [planned], dentition: 'PERMANENT', asOf: null }), '48')
        .present,
    ).toBe(true)
  })

  it('counts a bridge’s pontic as a tooth in the mouth', () => {
    const missing = row('46', 'MISSING', 'EXISTING', '2024-01-10')
    const bridge = row('45', 'BRIDGE', 'COMPLETED', '2024-03-01', {
      teeth: [
        { fdi: '45', role: 'ABUTMENT' },
        { fdi: '46', role: 'PONTIC' },
        { fdi: '47', role: 'ABUTMENT' },
      ],
    })
    const chart = deriveChart({ records: [missing, bridge], dentition: 'PERMANENT', asOf: null })
    expect(toothOf(chart, '46').present).toBe(true)
    expect(toothOf(chart, '46').marks.at(-1)?.role).toBe('PONTIC')
    expect(toothOf(chart, '45').marks.at(-1)?.role).toBe('ABUTMENT')
  })

  it('names the last day charted, its teeth, and every day there is to replay', () => {
    const records = [
      row('11', 'ROOT_CANAL', 'COMPLETED', '2026-09-12'),
      row('11', 'CROWN', 'COMPLETED', '2026-09-26', { encounterId: 'enc-412' }),
      row('26', 'CARIES', 'CONDITION', '2026-09-26', { encounterId: 'enc-412' }),
    ]
    const chart = deriveChart({ records, dentition: 'PERMANENT', asOf: null })
    expect(chart.lastCharted).toEqual({
      performedOn: '2026-09-26',
      encounterId: 'enc-412',
      teeth: ['11', '26'],
    })
    expect(chart.history).toEqual(['2026-09-12', '2026-09-26'])

    // The slider keeps every stop even while replaying an earlier one.
    const replay = deriveChart({ records, dentition: 'PERMANENT', asOf: '2026-09-12' })
    expect(replay.history).toEqual(['2026-09-12', '2026-09-26'])
    expect(replay.lastCharted?.performedOn).toBe('2026-09-12')
  })

  it('reads rows in the order they were charted, whatever order they arrive in', () => {
    const first = row('21', 'FILLING', 'COMPLETED', '2026-03-02')
    const second = row('21', 'VENEER', 'COMPLETED', '2026-05-10')
    const chart = deriveChart({ records: [second, first], dentition: 'PERMANENT', asOf: null })
    expect(toothOf(chart, '21').marks.map((mark) => mark.symbol)).toEqual(['FILLING', 'VENEER'])
  })
})
