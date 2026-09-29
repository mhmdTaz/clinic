import { describe, expect, it } from 'vitest'
import type { ToothMark, ToothState } from '@clinic/contracts'
import { filterTeeth, toothVisual } from '@/components/dental/tooth-visual'

let sequence = 0
const mark = (patch: Partial<ToothMark> & Pick<ToothMark, 'symbol' | 'status'>): ToothMark => ({
  recordId: `r${(sequence += 1)}`,
  surfaces: [],
  role: null,
  treatmentName: patch.symbol,
  performedOn: '2026-09-26',
  ...patch,
})
const tooth = (fdi: string, marks: ToothMark[], present = true): ToothState => ({
  fdi,
  present,
  marks,
})

/** What both views draw comes from here, so the 3D jaw and the flat chart cannot disagree. */
describe('the picture of one tooth', () => {
  it('draws a crown in the colour of its status', () => {
    expect(toothVisual(tooth('11', [mark({ symbol: 'CROWN', status: 'COMPLETED' })])).crown).toBe(
      'done',
    )
    expect(toothVisual(tooth('16', [mark({ symbol: 'CROWN', status: 'PLANNED' })]))).toMatchObject({
      crown: 'todo',
      planned: true,
    })
  })

  it('puts fillings and decay on the surfaces they were charted on', () => {
    const visual = toothVisual(
      tooth('26', [
        mark({ symbol: 'FILLING', status: 'COMPLETED', surfaces: ['M', 'O'] }),
        mark({ symbol: 'CARIES', status: 'CONDITION', surfaces: ['D'] }),
      ]),
    )
    expect(visual.surfaces).toEqual({ M: 'done', O: 'done', D: 'todo' })
    expect(visual.caries).toBe(true)
  })

  it('shows a bridge’s pontic as a tooth carried by the bridge, not a natural one', () => {
    const pontic = toothVisual(
      tooth('46', [mark({ symbol: 'BRIDGE', status: 'EXISTING', role: 'PONTIC' })]),
    )
    expect(pontic).toMatchObject({ replacedBy: 'PONTIC', bridgeRole: 'PONTIC', absent: false })
    const abutment = toothVisual(
      tooth('45', [mark({ symbol: 'BRIDGE', status: 'EXISTING', role: 'ABUTMENT' })]),
    )
    expect(abutment).toMatchObject({ replacedBy: null, crown: 'done', bridgeRole: 'ABUTMENT' })
  })

  it('takes an extracted tooth out, and brings it back as an implant', () => {
    const out = toothVisual(
      tooth('36', [mark({ symbol: 'EXTRACTION', status: 'COMPLETED' })], false),
    )
    expect(out).toMatchObject({ absent: true, extraction: 'done', replacedBy: null })
    const implant = toothVisual(
      tooth('36', [
        mark({ symbol: 'EXTRACTION', status: 'COMPLETED' }),
        mark({ symbol: 'IMPLANT', status: 'COMPLETED' }),
      ]),
    )
    expect(implant).toMatchObject({ absent: false, replacedBy: 'IMPLANT' })
  })

  it('names the latest mark for the badge', () => {
    const visual = toothVisual(
      tooth('11', [
        mark({ symbol: 'ROOT_CANAL', status: 'COMPLETED', performedOn: '2026-09-12' }),
        mark({ symbol: 'CROWN', status: 'COMPLETED' }),
      ]),
    )
    expect(visual.latest?.symbol).toBe('CROWN')
  })
})

describe('chart filters', () => {
  const teeth = [
    tooth('11', [
      mark({ symbol: 'ROOT_CANAL', status: 'COMPLETED', performedOn: '2026-09-12' }),
      mark({ symbol: 'CROWN', status: 'COMPLETED', performedOn: '2026-09-26' }),
    ]),
    tooth('16', [mark({ symbol: 'CROWN', status: 'PLANNED', performedOn: '2025-08-22' })]),
    tooth(
      '46',
      [mark({ symbol: 'EXTRACTION', status: 'COMPLETED', performedOn: '2025-08-22' })],
      false,
    ),
  ]

  it('keeps only what is still to do, or only what is done', () => {
    const todo = filterTeeth(teeth, 'todo', null)
    expect(todo.map((t) => t.marks.length)).toEqual([0, 1, 0])
    const done = filterTeeth(teeth, 'done', null)
    expect(done.map((t) => t.marks.length)).toEqual([2, 0, 1])
  })

  it('keeps the last charting day’s marks', () => {
    const last = filterTeeth(teeth, 'lastCharted', '2026-09-26')
    expect(last[0]!.marks.map((m) => m.symbol)).toEqual(['CROWN'])
  })

  it('never puts an extracted tooth back in the mouth by filtering its marks away', () => {
    expect(filterTeeth(teeth, 'todo', null)[2]!.present).toBe(false)
  })
})
