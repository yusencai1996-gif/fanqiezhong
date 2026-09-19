import { describe, it, expect } from 'vitest'
import { fmtClock, fmtDuration, fmtHours } from '../src/features/format.js'

describe('format: fmtClock (MM:SS)', () => {
  it('0秒 → 00:00', () => expect(fmtClock(0)).toBe('00:00'))
  it('65秒 → 01:05', () => expect(fmtClock(65)).toBe('01:05'))
  it('1500秒(25分) → 25:00', () => expect(fmtClock(1500)).toBe('25:00'))
  it('补零正确', () => expect(fmtClock(9)).toBe('00:09'))
})

describe('format: fmtDuration (X分/X时X分)', () => {
  it('0秒 → 0分', () => expect(fmtDuration(0)).toBe('0分'))
  it('不满1小时 → X分', () => {
    expect(fmtDuration(60)).toBe('1分')
    expect(fmtDuration(1500)).toBe('25分')
  })
  it('满1小时 → X时X分', () => {
    expect(fmtDuration(3600)).toBe('1时0分')
    expect(fmtDuration(5400)).toBe('1时30分')
    expect(fmtDuration(9000)).toBe('2时30分')
  })
})

describe('format: fmtHours (紧凑小时数 v0.3.9.2)', () => {
  it('0或负或null → 0h', () => {
    expect(fmtHours(0)).toBe('0h')
    expect(fmtHours(null)).toBe('0h')
    expect(fmtHours(-1)).toBe('0h')
  })
  it('不足1h → X分', () => {
    expect(fmtHours(0.5)).toBe('30分')
    expect(fmtHours(0.25)).toBe('15分')
  })
  it('≥1h 整时 → Xh(去小数)', () => {
    expect(fmtHours(2)).toBe('2h')
    expect(fmtHours(2.0)).toBe('2h')
  })
  it('≥1h 非整 → X.Xh', () => {
    expect(fmtHours(1.5)).toBe('1.5h')
    expect(fmtHours(2.25)).toBe('2.3h')   // 四舍五入1位
  })
})
