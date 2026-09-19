import { describe, it, expect } from 'vitest'
import {
  evaluateDay, calendarMonth, checkinStreak, DEFAULT_DAILY_GOAL_MINUTES,
} from '../src/features/checkin.js'

const NOW = new Date('2026-06-15T12:00:00')   // 固定 now 方便测试(6月15日周一)

// 造一条专注 session 的辅助函数。offsetDays=相对 NOW 的天数(负=过去)。
// 关键:日期基于 NOW(不是真实今天),否则测试日期对不上。
function mkSession(offsetDays, durationMin, status = '完成') {
  const d = new Date(NOW)
  d.setDate(d.getDate() + offsetDays)
  d.setHours(10, 0, 0, 0)
  return {
    id: 's' + offsetDays + durationMin,
    type: '专注',
    durationSec: durationMin * 60,
    status,
    startedAt: d.toISOString(),
  }
}

describe('checkin: evaluateDay', () => {
  it('专注达标(≥门槛)→ done', () => {
    const sessions = [mkSession(0, 30)]   // 今天专注30分钟=门槛
    const r = evaluateDay(sessions, new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('done')
    expect(r.totalSec).toBe(1800)
    expect(r.goalSec).toBe(1800)
  })

  it('专注超出门槛→ done', () => {
    const sessions = [mkSession(0, 60)]
    const r = evaluateDay(sessions, new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('done')
  })

  it('专注不足门槛(>0)→ partial', () => {
    const sessions = [mkSession(0, 15)]   // 学了15分钟,门槛30
    const r = evaluateDay(sessions, new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('partial')
  })

  it('当天没学→ missed', () => {
    const r = evaluateDay([], new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('missed')
    expect(r.totalSec).toBe(0)
  })

  it('未来日期→ future(不判定)', () => {
    const sessions = [mkSession(0, 60)]   // 即便有数据也不算(日期在未来)
    const r = evaluateDay(sessions, new Date('2026-06-16'), 30, NOW)   // 明天
    expect(r.status).toBe('future')
  })

  it('多条session累计:分散专注合计达标→ done', () => {
    const sessions = [mkSession(0, 10), mkSession(0, 12), mkSession(0, 10)]   // 10+12+10=32≥30
    const r = evaluateDay(sessions, new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('done')
    expect(r.totalSec).toBe(1920)
  })

  it('跳过/休息不计入(只算有效专注)', () => {
    const sessions = [
      { type: '专注', status: '跳过', durationSec: 9999, startedAt: new Date('2026-06-15').toISOString() },
      { type: '休息', status: '完成', durationSec: 9999, startedAt: new Date('2026-06-15').toISOString() },
    ]
    const r = evaluateDay(sessions, new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('missed')   // 跳过和休息都不算
  })

  it('异常中断(v0.3.7恢复)计入有效专注', () => {
    const sessions = [mkSession(0, 35, '异常中断')]
    const r = evaluateDay(sessions, new Date('2026-06-15'), 30, NOW)
    expect(r.status).toBe('done')   // 异常中断算
  })

  it('门槛为0:只要学了就算done', () => {
    const sessions = [mkSession(0, 1)]   // 学1分钟
    const r = evaluateDay(sessions, new Date('2026-06-15'), 0, NOW)
    expect(r.status).toBe('done')
  })

  it('门槛非法值(非数字)→ 当0处理(学了就算)', () => {
    const sessions = [mkSession(0, 1)]
    const r = evaluateDay(sessions, new Date('2026-06-15'), 'abc', NOW)
    expect(r.goalSec).toBe(0)
    expect(r.status).toBe('done')
  })
})

describe('checkin: calendarMonth', () => {
  it('返回正确的月结构和前置空白(周一起始)', () => {
    // 2026年6月:1号是周一→0个前置空白
    const result = calendarMonth([], 2026, 5, 30, NOW)
    expect(result.monthLabel).toBe('2026年6月')
    // 6月有30天 + 0前置空白
    const realDays = result.days.filter(d => d !== null)
    expect(realDays).toHaveLength(30)
    expect(realDays[0].day).toBe(1)
    expect(realDays[0].key).toBe('2026-06-01')
  })

  it('2026年5月:1号是周五→4个前置空白', () => {
    const result = calendarMonth([], 2026, 4, 30, NOW)
    const leadBlanks = result.days.filter(d => d === null).length
    expect(leadBlanks).toBe(4)   // 周一二三四=4个空
  })

  it('过去日期有数据→ done,未来日期→ future', () => {
    const sessions = [mkSession(-1, 40)]   // 昨天(6/14)达标
    const result = calendarMonth(sessions, 2026, 5, 30, NOW)
    const realDays = result.days.filter(d => d !== null)
    // 6/14应该done,6/16~30应该future
    const d14 = realDays.find(d => d.day === 14)
    const d16 = realDays.find(d => d.day === 16)
    expect(d14.status).toBe('done')
    expect(d16.status).toBe('future')
  })

  it('月统计:doneCount/partialCount/missedCount 只算过去日期', () => {
    // 6/13,6/14达标;6/15(今天)部分;6/12缺勤;6/16+未来
    const sessions = [mkSession(-2, 40), mkSession(-1, 40), mkSession(0, 10)]
    const result = calendarMonth(sessions, 2026, 5, 30, NOW)
    expect(result.stats.doneCount).toBe(2)   // 13,14
    expect(result.stats.partialCount).toBe(1)   // 15
    expect(result.stats.missedCount).toBe(12)   // 1~12号都没学(12号也没)
  })
})

describe('checkin: checkinStreak', () => {
  it('连续3天达标(含今天)→ streak=3', () => {
    const sessions = [mkSession(0, 40), mkSession(-1, 40), mkSession(-2, 40)]
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(3)
  })

  it('今天没达标但前两天达标→ streak=2(今天不算中断)', () => {
    const sessions = [mkSession(-1, 40), mkSession(-2, 40)]   // 今天没学
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(2)
  })

  it('连续中断:今天达标但昨天缺勤→ streak=1', () => {
    const sessions = [mkSession(0, 40), mkSession(-2, 40)]   // 今天和前天,昨天缺
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(1)   // 今天算1,昨天断了
  })

  it('一天都没学→ streak=0', () => {
    const streak = checkinStreak([], 30, NOW)
    expect(streak).toBe(0)
  })

  it('部分(partial)不算打卡成功,会断连续', () => {
    const sessions = [mkSession(0, 40), mkSession(-1, 10), mkSession(-2, 40)]   // 今天达标,昨天部分,前天达标
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(1)   // 今天1,昨天部分=断
  })

  it('连续5天达标→ streak=5', () => {
    const sessions = [0, -1, -2, -3, -4].map(o => mkSession(o, 50))
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(5)
  })

  it('[小码审核H1] 今天缺勤+昨天缺勤+之前达标→ streak=0(昨天已断连续)', () => {
    // 今天没学,昨天没学,前天和大前天达标
    const sessions = [mkSession(-2, 50), mkSession(-3, 50)]
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(0)   // 昨天缺勤=连续已断,不是2
  })

  it('[小码审核H1] 今天达标+昨天缺勤+前天达标→ streak=1(昨天断)', () => {
    const sessions = [mkSession(0, 50), mkSession(-2, 50)]   // 今天+前天,昨天缺
    const streak = checkinStreak(sessions, 30, NOW)
    expect(streak).toBe(1)   // 今天算1,昨天断了
  })
})
