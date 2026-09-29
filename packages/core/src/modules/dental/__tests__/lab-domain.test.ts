import { describe, expect, it } from 'vitest'
import {
  canMoveLabOrder,
  isAtLab,
  isLabOrderOverdue,
  isOpenLabOrder,
  nextLabStatuses,
} from '../domain/lab'

describe('lab work’s round trip', () => {
  it('comes back before it is fitted, and goes back only once it has come back', () => {
    expect(canMoveLabOrder('SENT', 'RECEIVED')).toBe(true)
    expect(canMoveLabOrder('SENT', 'FITTED')).toBe(false)
    expect(canMoveLabOrder('SENT', 'REMAKE')).toBe(false)
    expect(canMoveLabOrder('RECEIVED', 'REMAKE')).toBe(true)
    expect(canMoveLabOrder('REMAKE', 'RECEIVED')).toBe(true)
    expect(canMoveLabOrder('RECEIVED', 'FITTED')).toBe(true)
  })

  it('ends at fitted or cancelled', () => {
    expect(nextLabStatuses('FITTED')).toEqual([])
    expect(nextLabStatuses('CANCELLED')).toEqual([])
    expect(canMoveLabOrder('FITTED', 'REMAKE')).toBe(false)
  })

  it('is late only while it is still at the lab, after the day it was due', () => {
    expect(isLabOrderOverdue('SENT', '2026-09-25', '2026-09-26')).toBe(true)
    expect(isLabOrderOverdue('SENT', '2026-09-26', '2026-09-26')).toBe(false)
    expect(isLabOrderOverdue('REMAKE', '2026-09-01', '2026-09-26')).toBe(true)
    expect(isLabOrderOverdue('RECEIVED', '2026-09-01', '2026-09-26')).toBe(false)
  })

  it('is at the lab when sent or sent back, and open until fitted or cancelled', () => {
    expect(['SENT', 'REMAKE'].every((s) => isAtLab(s as 'SENT'))).toBe(true)
    expect(isAtLab('RECEIVED')).toBe(false)
    expect(isOpenLabOrder('RECEIVED')).toBe(true)
    expect(isOpenLabOrder('FITTED')).toBe(false)
  })
})
