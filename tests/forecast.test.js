import { describe, it, expect } from 'vitest'
import {
  subjectDoneSec, goalProgress, recentRate, overallRate,
  predictFinishDate, planForecast, burndownData,
} from '../src/features/forecast.js'

const NOW = new Date('2026-06-25T12:00:00')

// 造 session:offsetDays 相对 NOW,durationMin 分钟,subjectId
function mk(offsetDays, durationMin, subjectId = 'sub1', status = '完成') {
  const d = new Date(NOW)
  d.setDate(d.getDate() + offsetDays)
  d.setHours(10, 0, 0, 0)
  return { id: 's' + offsetDays + durationMin, type: '专注', status, durationSec: durationMin * 60, startedAt: d.toISOString(), subjectId }
}

describe('forecast: subjectDoneSec 去重聚合', () => {
  it('累加该科目所有有效专注', () => {
    const sessions = [mk(0, 30, 's1'), mk(-1, 60, 's1'), mk(0, 20, 's2')]
    expect(subjectDoneSec(sessions, 's1')).toBe(5400)   // 30+60分钟
  })
  it('跳过/休息不计', () => {
    const sessions = [
      { type: '专注', status: '跳过', durationSec: 9999, startedAt: NOW.toISOString(), subjectId: 's1' },
      { type: '休息', status: '完成', durationSec: 9999, startedAt: NOW.toISOString(), subjectId: 's1' },
    ]
    expect(subjectDoneSec(sessions, 's1')).toBe(0)
  })
  it('异常中断计入', () => {
    expect(subjectDoneSec([mk(0, 25, 's1', '异常中断')], 's1')).toBe(1500)
  })
})

describe('forecast: goalProgress 目标进度', () => {
  const subjects = [
    { id: 's1', goalId: 'g1', name: '数学', archived: false },
    { id: 's2', goalId: 'g1', name: '英语', archived: false },
    { id: 's3', goalId: 'g2', name: '政治', archived: false },
  ]
  const plans = [
    { id: 'p1', subjectId: 's1', totalHours: 10, status: '进行中', archived: false },
    { id: 'p2', subjectId: 's1', totalHours: 5, status: '进行中', archived: false },   // s1下两计划共15h
    { id: 'p3', subjectId: 's2', totalHours: 8, status: '进行中', archived: false },
    { id: 'p4', subjectId: 's3', totalHours: 99, status: '进行中', archived: false },   // 属于g2,不该算
  ]
  it('按subject聚合done,不重复(多计划同科目不爆)', () => {
    // s1 学了 3小时(10800秒), s2 学了 2小时
    const sessions = [
      { type: '专注', status: '完成', durationSec: 10800, startedAt: NOW.toISOString(), subjectId: 's1' },
      { type: '专注', status: '完成', durationSec: 7200, startedAt: NOW.toISOString(), subjectId: 's2' },
    ]
    const r = goalProgress(sessions, subjects, plans, 'g1')
    expect(r.totalHours).toBe(23)   // s1的15 + s2的8
    expect(r.doneHours).toBe(5)     // 3+2,没有重复
    expect(r.subjects).toHaveLength(2)   // s1, s2 (s3属g2)
  })
  it('pct限幅100%', () => {
    const sessions = [
      { type: '专注', status: '完成', durationSec: 999999, startedAt: NOW.toISOString(), subjectId: 's1' },
    ]
    const r = goalProgress(sessions, subjects, plans, 'g1')
    expect(r.pct).toBe(100)
  })
  it('[H2] 无计划的科目不计入(学了也不虚高,不显示X/0h)', () => {
    // s4属g1但无计划,学了5小时→不应进入分母分子(否则pct虚高)
    const subjects2 = [
      ...subjects,
      { id: 's4', goalId: 'g1', name: '无计划科目', archived: false },
    ]
    const sessions = [
      { type: '专注', status: '完成', durationSec: 5 * 3600, startedAt: NOW.toISOString(), subjectId: 's4' },
      { type: '专注', status: '完成', durationSec: 3 * 3600, startedAt: NOW.toISOString(), subjectId: 's1' },
    ]
    const r = goalProgress(sessions, subjects2, plans, 'g1')
    expect(r.totalHours).toBe(23)   // s4无计划不计入
    expect(r.doneHours).toBe(3)     // 只有s1的3小时,s4的5小时不计入
    expect(r.subjects.find(x => x.subject.id === 's4')).toBeUndefined()   // s4不显示
  })
})

describe('forecast: recentRate 近7天速率', () => {
  it('近7天总学时÷7', () => {
    // 近3天每天学1小时 = 3小时,÷7 ≈ 0.4286
    const sessions = [mk(0, 60), mk(-1, 60), mk(-2, 60)]
    const rate = recentRate(sessions, 'sub1', 7, NOW)
    expect(rate).toBeCloseTo(3 / 7, 4)
  })
  it('8天前的不算(超出窗口)', () => {
    const sessions = [mk(-8, 60), mk(0, 60)]
    const rate = recentRate(sessions, 'sub1', 7, NOW)
    expect(rate).toBeCloseTo(1 / 7, 4)   // 只有今天的1小时
  })
  it('没学→0', () => {
    expect(recentRate([], 'sub1', 7, NOW)).toBe(0)
  })
  it('只统计该subject', () => {
    const sessions = [mk(0, 60, 's1'), mk(0, 60, 's2')]
    expect(recentRate(sessions, 's1', 7, NOW)).toBeCloseTo(1 / 7, 4)
  })
})

describe('forecast: overallRate 计划至今总平均', () => {
  it('since之后的所有学时÷天数', () => {
    // since=10天前,期间学了5小时 → 5/10
    const sessions = [mk(-5, 150), mk(-2, 150)]   // 5小时
    const since = new Date(NOW.getTime() - 10 * 86400000)
    const rate = overallRate(sessions, 'sub1', since, NOW)
    expect(rate).toBeCloseTo(5 / 11, 3)   // 10天差+1含今天=11天
  })
  it('since之前的不算', () => {
    const sessions = [mk(-20, 60), mk(-1, 60)]
    const since = new Date(NOW.getTime() - 10 * 86400000)
    const rate = overallRate(sessions, 'sub1', since, NOW)
    expect(rate).toBeCloseTo(1 / 11, 3)
  })
  it('无sinceDate→0', () => {
    expect(overallRate([mk(0, 60)], 'sub1', null, NOW)).toBe(0)
  })
})

describe('forecast: predictFinishDate', () => {
  it('速率>0→预测未来某天', () => {
    const r = predictFinishDate(10, 1)   // 剩10h,每天1h → 10天后
    expect(r).toBeTruthy()
    expect(r.getTime()).toBeGreaterThan(Date.now())
  })
  it('速率0→null(无法预测)', () => {
    expect(predictFinishDate(10, 0)).toBeNull()
  })
  it('[H4] remaining<=0(已完成)→null', () => {
    expect(predictFinishDate(0, 1)).toBeNull()
    expect(predictFinishDate(-5, 1)).toBeNull()
  })
  it('[H1] now注入可测:剩10h每天1h→10天后', () => {
    const base = new Date('2026-06-25T12:00:00')
    const r = predictFinishDate(10, 1, base)
    expect(r).toBeTruthy()
    const diffDays = Math.round((r.getTime() - base.getTime()) / 86400000)
    expect(diffDays).toBe(10)   // 精确10天(注入now后可断言)
  })
})

describe('forecast: planForecast 综合预测', () => {
  const basePlan = { id: 'p1', subjectId: 's1', name: '第1轮', totalHours: 20, deadline: '2026-07-15', status: '进行中', archived: false, createdAt: new Date(NOW.getTime() - 20 * 86400000).toISOString() }
  it('已完成→status=done', () => {
    const sessions = [{ type: '专注', status: '完成', durationSec: 20 * 3600, startedAt: NOW.toISOString(), subjectId: 's1' }]
    const f = planForecast(sessions, basePlan, NOW)
    expect(f.status).toBe('done')
    expect(f.remainingHours).toBe(0)
  })
  it('无截止日→no-deadline', () => {
    const f = planForecast([], { ...basePlan, deadline: null }, NOW)
    expect(f.status).toBe('no-deadline')
  })
  it('没学过→no-data(速率0)', () => {
    const f = planForecast([], basePlan, NOW)
    expect(f.status).toBe('no-data')
    expect(f.rateRecent).toBe(0)
  })
  it('预测早于截止→on-track', () => {
    // 剩10h,近7天每天学2h → 5天后(6/30)完成,早于7/15
    const sessions = [0, -1, -2, -3, -4, -5, -6].map(o => mk(o, 120, 's1'))
    const f = planForecast(sessions, basePlan, NOW)
    expect(f.rateRecent).toBeCloseTo(2, 1)
    expect(f.status).toBe('on-track')
  })
  it('预测晚于截止→behind', () => {
    // 剩19h,近7天只学了1小时(每天1/7h) → 要133天,远晚于7/15
    const sessions = [mk(0, 60, 's1')]
    const f = planForecast(sessions, basePlan, NOW)
    expect(f.status).toBe('behind')
  })
  it('v0.4.0:同科目多计划共享,各计划 doneHours 相同(科目级语义,非bug)', () => {
    // s1 科目被两个计划共享,学了 10h → 两个计划的 planForecast.doneHours 都是 10
    const sessions = [mk(0, 600, 's1')]   // 今天学 10h
    const p1 = { ...basePlan, id: 'p1', totalHours: 20 }
    const p2 = { ...basePlan, id: 'p2', totalHours: 30 }
    const f1 = planForecast(sessions, p1, NOW)
    const f2 = planForecast(sessions, p2, NOW)
    expect(f1.doneHours).toBe(10)   // 科目总投入,非"该计划独占"
    expect(f2.doneHours).toBe(10)   // 两者相同——设计边界(session 粒度=科目)
  })
})

describe('forecast: burndownData 燃尽图', () => {
  const plan = { subjectId: 's1', totalHours: 20, deadline: '2026-07-05', createdAt: new Date('2026-06-15').toISOString(), status: '进行中', archived: false }
  it('返回理想线和实际线', () => {
    const sessions = [mk(-5, 120, 's1')]   // 5天前学了2小时
    const bd = burndownData(sessions, plan, NOW)
    expect(bd.ideal.length).toBeGreaterThan(0)
    expect(bd.actual.length).toBeGreaterThan(0)
    expect(bd.totalHours).toBe(20)
    expect(bd.startDate).toBe('2026-06-15')
    expect(bd.endDate).toBe('2026-07-05')
  })
  it('理想线起点=totalHours,终点=0', () => {
    const bd = burndownData([], plan, NOW)
    expect(bd.ideal[0].remaining).toBe(20)
    expect(bd.ideal[bd.ideal.length - 1].remaining).toBe(0)
  })
  it('实际线只画到今天(不含未来)', () => {
    const bd = burndownData([], plan, NOW)
    const lastActual = bd.actual[bd.actual.length - 1]
    expect(lastActual.date).toBe(dateKeySimple(NOW))
  })
  it('学了之后实际线下降', () => {
    // 学了10小时 → 实际线最后一点剩余应为 20-10=10
    const sessions = [{ type: '专注', status: '完成', durationSec: 10 * 3600, startedAt: NOW.toISOString(), subjectId: 's1' }]
    const bd = burndownData(sessions, plan, NOW)
    const lastActual = bd.actual[bd.actual.length - 1]
    expect(lastActual.remaining).toBeCloseTo(10, 1)
  })
  it('[H3] 跨度>60天按周采样,实际线终点必须是今天(不能停在未来某天)', () => {
    // 创建跨度>60天的计划:开始80天前,截止40天后
    const longPlan = {
      subjectId: 's1', totalHours: 100,
      deadline: dateKeySimple(new Date(NOW.getTime() + 40 * 86400000)),
      createdAt: new Date(NOW.getTime() - 80 * 86400000).toISOString(),
      status: '进行中', archived: false,
    }
    const sessions = [{ type: '专注', status: '完成', durationSec: 20 * 3600, startedAt: NOW.toISOString(), subjectId: 's1' }]
    const bd = burndownData(sessions, longPlan, NOW)
    expect(bd.stepDays).toBe(7)   // 确认走了周采样
    const lastActual = bd.actual[bd.actual.length - 1]
    expect(lastActual.date).toBe(dateKeySimple(NOW))   // 终点必须是今天,不能是几天前
  })
})

function dateKeySimple(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
