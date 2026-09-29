import { describe, expect, it } from 'vitest'
import {
  canBill,
  canCancel,
  canDecide,
  defaultQuantity,
  describeWork,
  isEditable,
  itemState,
  statusAfterProgress,
} from '../domain/plan'

describe('a treatment plan’s life', () => {
  it('is edited and answered only before the patient has answered', () => {
    expect(['DRAFT', 'PRESENTED'].every((s) => isEditable(s as 'DRAFT'))).toBe(true)
    expect(
      ['ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED'].some((s) => isEditable(s as 'DRAFT')),
    ).toBe(false)
    expect(canDecide('DRAFT')).toBe(true)
    expect(canDecide('ACCEPTED')).toBe(false)
  })

  it('is cancelled up to the point it is finished, and billed only once agreed', () => {
    expect(canCancel('ACCEPTED')).toBe(true)
    expect(canCancel('COMPLETED')).toBe(false)
    expect(canCancel('DECLINED')).toBe(false)
    expect(canBill('DRAFT')).toBe(false)
    expect(canBill('PRESENTED')).toBe(false)
    expect(canBill('ACCEPTED')).toBe(true)
    expect(canBill('COMPLETED')).toBe(true)
  })

  it('completes itself when the last open item is done, and reopens when a completion is voided', () => {
    expect(statusAfterProgress('ACCEPTED', { open: 1, done: 1 })).toBe('ACCEPTED')
    expect(statusAfterProgress('ACCEPTED', { open: 0, done: 2 })).toBe('COMPLETED')
    expect(statusAfterProgress('COMPLETED', { open: 1, done: 1 })).toBe('ACCEPTED')
  })

  it('does not call a plan complete when everything in it was voided rather than done', () => {
    expect(statusAfterProgress('ACCEPTED', { open: 0, done: 0 })).toBe('ACCEPTED')
  })

  it('leaves a plan nobody agreed to where it is, whatever its items do', () => {
    expect(statusAfterProgress('DRAFT', { open: 0, done: 3 })).toBe('DRAFT')
    expect(statusAfterProgress('DECLINED', { open: 0, done: 1 })).toBe('DECLINED')
    expect(statusAfterProgress('CANCELLED', { open: 0, done: 1 })).toBe('CANCELLED')
  })
})

describe('a plan item', () => {
  it('is dropped when its planned row is voided, done once carried out, and open otherwise', () => {
    expect(itemState({ voided: true }, { recordId: 'x' })).toBe('DROPPED')
    expect(itemState({ voided: false }, { recordId: 'x' })).toBe('DONE')
    expect(itemState({ voided: false }, null)).toBe('OPEN')
  })

  it('prices a bridge per unit and everything else as one', () => {
    const bridge = [
      { role: 'ABUTMENT' as const },
      { role: 'PONTIC' as const },
      { role: 'ABUTMENT' as const },
    ]
    expect(defaultQuantity({ scope: 'SPAN', teeth: bridge })).toBe('3')
    expect(defaultQuantity({ scope: 'TOOTH', teeth: [{ role: null }] })).toBe('1')
    expect(defaultQuantity({ scope: 'SURFACE', teeth: [{ role: null }] })).toBe('1')
    expect(defaultQuantity({ scope: 'ARCH', teeth: bridge })).toBe('1')
  })

  it('reads as a line a patient understands', () => {
    expect(
      describeWork({ name: 'Composite filling', teeth: [{ fdi: '24' }], surfaces: ['M', 'O'] }),
    ).toBe('Composite filling (MO) — 24')
    expect(
      describeWork({
        name: 'Bridge',
        teeth: [{ fdi: '45' }, { fdi: '46' }, { fdi: '47' }],
        surfaces: [],
      }),
    ).toBe('Bridge — 45–47')
  })
})
