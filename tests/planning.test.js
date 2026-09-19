import { describe, it, expect } from 'vitest'
import { planDoneHours, planTodayHours, todayPlanSummary, subjectTodayHours } from '../src/features/planning.js'

const now = new Date('2026-07-15T10:00:00')
const sess = (subjectId, hours, status = '完成') => ({
  type: '专注', durationSec: hours * 3600, status,
  startedAt: '2026-07-14T10:00:00', subjectId, taskName: 'x',
})

describe('planning: planDoneHours', () => {
  it('算该计划归属科目的专注时长之和', () => {
    const s = [sess('s1', 5), sess('s1', 3), sess('s2', 2)]
    const plan = { subjectId: 's1', totalHours: 50 }
    expect(planDoneHours(s, plan)).toBe(8)  // 5+3
  })
  it('跳过不计,提前结束计', () => {
    const s = [
      { type: '专注', durationSec: 3600, status: '跳过', startedAt: '', subjectId: 's1' },
      { type: '专注', durationSec: 7200, status: '提前结束', startedAt: '', subjectId: 's1' },
    ]
    expect(planDoneHours(s, { subjectId: 's1' })).toBe(2)
  })
  it('v0.4.0:同科目多计划共享,各自 planDoneHours 相同(科目级语义,非bug)', () => {
    // s1 科目被 p1/p2 两个计划共享,学了 10h → 两个计划各自拿到 10h(科目总投入)
    const s = [sess('s1', 10)]
    const p1 = { subjectId: 's1', totalHours: 20 }
    const p2 = { subjectId: 's1', totalHours: 30 }
    expect(planDoneHours(s, p1)).toBe(10)   // 科目总投入,非"该计划独占"
    expect(planDoneHours(s, p2)).toBe(10)   // 两者相同——设计边界(session 粒度=科目)
  })
})

describe('planning: planTodayHours', () => {
  const plan = { subjectId: 's1', totalHours: 50, deadline: '2026-07-25', manualDaily: {} }
  it('自动分配:(总-已完成)/剩余天数', () => {
    // done=10h, deadline 2026-07-25, now 2026-07-15 → 剩余11天(15..25)
    expect(planTodayHours([sess('s1', 10)], plan, now)).toBeCloseTo((50 - 10) / 11, 1)
  })
  it('手动覆盖优先', () => {
    const p = { ...plan, manualDaily: { '2026-07-15': 3 } }
    expect(planTodayHours([], p, now)).toBe(3)
  })
  it('超期返回0', () => {
    const p = { ...plan, deadline: '2026-07-10' }  // 早于now
    expect(planTodayHours([], p, now)).toBe(0)
  })
  it('已完成>=总返回0', () => {
    expect(planTodayHours([sess('s1', 50)], plan, now)).toBe(0)
  })
  it('截止日当天仍算(剩余1天)', () => {
    const p = { ...plan, deadline: '2026-07-15' }  // 就是今天
    expect(planTodayHours([], p, now)).toBeCloseTo(50 / 1, 1)
  })
  it('无截止日返回0', () => {
    const p = { ...plan, deadline: null }
    expect(planTodayHours([], p, now)).toBe(0)
  })
  it('v0.4.0:已完成计划+手动覆盖→仍返回0(终态优先于手动)', () => {
    // done=50h >= total=50h,即使当天有手动覆盖值,也应返回0(计划已结束)
    const p = { ...plan, manualDaily: { '2026-07-15': 3 } }
    expect(planTodayHours([sess('s1', 50)], p, now)).toBe(0)
  })
  it('v0.4.0:超期计划+手动覆盖→仍返回0(终态优先于手动)', () => {
    // deadline 2026-07-10 早于 now 7/15,即使有手动覆盖,也应返回0(计划已超期)
    const p = { ...plan, deadline: '2026-07-10', manualDaily: { '2026-07-15': 3 } }
    expect(planTodayHours([], p, now)).toBe(0)
  })
  it('v0.4.0:无截止日+手动覆盖→返回手动值(无截止日非终态,手动覆盖生效)', () => {
    // 无截止日计划仍在进行,用户设了手动覆盖应生效(非终态,不拦截)
    const p = { ...plan, deadline: null, manualDaily: { '2026-07-15': 2.5 } }
    expect(planTodayHours([], p, now)).toBe(2.5)
  })
  it('v0.4.0:截止日当天+手动覆盖→返回手动值(未超期,手动覆盖生效)', () => {
    // deadline 就是今天 7/15,未超期(还在截止日内),手动覆盖应生效
    const p = { ...plan, deadline: '2026-07-15', manualDaily: { '2026-07-15': 4 } }
    expect(planTodayHours([], p, now)).toBe(4)
  })
})

describe('planning: todayPlanSummary', () => {
  it('汇总所有进行中计划,跳过已完成/归档', () => {
    const plans = [
      { id: 'p1', subjectId: 's1', totalHours: 50, deadline: '2026-07-25', status: '进行中', manualDaily: {}, archived: false },
      { id: 'p2', subjectId: 's2', totalHours: 30, deadline: '2026-07-20', status: '已完成', manualDaily: {}, archived: false },
      { id: 'p3', subjectId: 's3', totalHours: 20, deadline: '2026-07-20', status: '进行中', manualDaily: {}, archived: true },
    ]
    const summary = todayPlanSummary([], plans, now)
    expect(summary).toHaveLength(1)  // 只p1(p2已完成,p3归档)
    expect(summary[0].plan.id).toBe('p1')
    expect(summary[0]).toHaveProperty('todayHours')
    expect(summary[0]).toHaveProperty('doneHours')
    expect(summary[0]).toHaveProperty('isOverdue')
  })
  it('超期计划的isOverdue=true', () => {
    const plans = [{ id: 'p1', subjectId: 's1', totalHours: 50, deadline: '2026-07-10', status: '进行中', manualDaily: {}, archived: false }]
    const summary = todayPlanSummary([], plans, now)
    expect(summary[0].isOverdue).toBe(true)
  })
})

describe('planning: subjectTodayHours 今日已学', () => {
  // now = 2026-07-15。"今天"=7/15,"昨天"=7/14
  const todaySess = (subjectId, hours, status = '完成') => ({
    type: '专注', durationSec: hours * 3600, status, startedAt: '2026-07-15T10:00:00', subjectId,
  })
  it('只算今天的有效专注', () => {
    const s = [todaySess('s1', 2), sess('s1', 3)]   // 今天2h + 昨天3h
    expect(subjectTodayHours(s, 's1', now)).toBe(2)   // 只算今天的2h
  })
  it('只算指定科目', () => {
    const s = [todaySess('s1', 2), todaySess('s2', 5)]
    expect(subjectTodayHours(s, 's1', now)).toBe(2)
  })
  it('跳过/休息不计', () => {
    const s = [
      { type: '专注', status: '跳过', durationSec: 9999, startedAt: '2026-07-15T10:00:00', subjectId: 's1' },
      { type: '休息', status: '完成', durationSec: 9999, startedAt: '2026-07-15T10:00:00', subjectId: 's1' },
    ]
    expect(subjectTodayHours(s, 's1', now)).toBe(0)
  })
  it('异常中断计入', () => {
    expect(subjectTodayHours([todaySess('s1', 1, '异常中断')], 's1', now)).toBe(1)
  })
  it('todayPlanSummary 含 todayDoneHours 字段', () => {
    const plans = [{ id: 'p1', subjectId: 's1', totalHours: 50, deadline: '2026-07-25', status: '进行中', manualDaily: {}, archived: false }]
    const s = [todaySess('s1', 2)]
    const summary = todayPlanSummary(s, plans, now)
    expect(summary[0]).toHaveProperty('todayDoneHours')
    expect(summary[0].todayDoneHours).toBe(2)
  })
  it('同科目多计划:todayDoneHours 相同(科目今日投入),各计划独立显示', () => {
    // s1科目下两个计划,今天学了2h → 两条的todayDoneHours都是2(科目级归集)
    const plans = [
      { id: 'p1', subjectId: 's1', totalHours: 20, deadline: '2026-07-25', status: '进行中', manualDaily: {}, archived: false },
      { id: 'p2', subjectId: 's1', totalHours: 30, deadline: '2026-07-25', status: '进行中', manualDaily: {}, archived: false },
    ]
    const s = [todaySess('s1', 2)]
    const summary = todayPlanSummary(s, plans, now)
    expect(summary).toHaveLength(2)
    expect(summary[0].todayDoneHours).toBe(2)
    expect(summary[1].todayDoneHours).toBe(2)   // 同科目今日已学相同(UI侧todayPct此时不显示百分比)
  })
})
