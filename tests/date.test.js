import { describe, it, expect } from 'vitest'
import { daysUntil } from '../src/features/date.js'

const NOW = new Date('2026-06-29T10:00:00')   // 6/29 上午10点

describe('date: daysUntil 倒计时', () => {
  it('未来日期→正数(剩N天,ceil)', () => {
    // 7/1 23:59 - 6/29 10:00 ≈ 2.6天 → ceil = 3
    expect(daysUntil('2026-07-01', NOW)).toBe(3)
  })
  it('远期日期', () => {
    expect(daysUntil('2026-09-01', NOW)).toBe(65)
  })
  it('今天到期(上午)→1(还没到晚上,算剩1天)', () => {
    // 6/29 23:59 - 10:00 ≈ 0.58天 → ceil = 1
    expect(daysUntil('2026-06-29', NOW)).toBe(1)
  })
  it('今天到期(深夜接近23:59)→1(ceil(正值)至少为1)', () => {
    const eve = new Date('2026-06-29T23:50:00')   // 剩10分钟,ceil(0.007)=1
    expect(daysUntil('2026-06-29', eve)).toBe(1)
  })
  it('已过期→负数', () => {
    // 6/25 23:59 → 6/29 10:00 = 约-3.4天 → ceil = -3
    expect(daysUntil('2026-06-25', NOW)).toBe(-3)
  })
  it('无deadline→null', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil('', NOW)).toBeNull()
  })
  it('非法日期→null', () => {
    expect(daysUntil('abc', NOW)).toBeNull()
  })
})
