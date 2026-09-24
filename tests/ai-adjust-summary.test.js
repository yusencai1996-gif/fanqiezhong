import { describe, it, expect } from 'vitest'
import { buildStudySummary, buildChatMessages, classifyPlanHealth } from '../src/features/ai.js'
import { planForecast, goalProgress } from '../src/features/forecast.js'
import { fmtHours } from '../src/features/format.js'
import { todayPlanSummary } from '../src/features/planning.js'
import { dateKey } from '../src/features/date.js'

const NOW = new Date(2026, 8, 24, 12)
const goals = [{ id: 'g', name: '考试', archived: false }]
const subjects = [{ id: 's', goalId: 'g', name: '数学', archived: false }]
const plans = [{ id: 'p', subjectId: 's', name: '强化', totalHours: 10, deadline: '2026-09-30', status: '进行中', archived: false, createdAt: '2026-09-01T09:00:00', manualDaily: { '2026-09-24': 4 } }]
const focus = (day, hours = 1) => ({ id: `f${day}`, type: '专注', status: '完成', startedAt: new Date(2026, 8, day, 9).toISOString(), subjectId: 's', durationSec: hours * 3600 })
const data = (sessions = [], overrides = {}) => ({ sessions, goals, subjects, plans, ...overrides })
const row = (sessions = [], overrides = {}) => buildStudySummary(data(sessions, overrides), NOW).plans[0]

describe('plan adjustment summary', () => {
  it('uses forecast values directly, with seven calendar days including zero days', () => {
    const sessions = [focus(18, 1), focus(24, 2)]
    const result = row(sessions)
    const forecast = planForecast(sessions, plans[0], NOW)
    expect(result).toMatchObject({ doneHours: forecast.doneHours, remainingHours: forecast.remainingHours,
      rateRecent: forecast.rateRecent, rateOverall: forecast.rateOverall, forecastStatus: forecast.status })
    expect(result.recent7DaysHours).toBeCloseTo(3)
    expect(result.rateRecent).toBeCloseTo(3 / 7)
    expect(result.predictRecent).toBe(dateKey(forecast.predictRecent))
    expect(result.predictOverall).toBe(dateKey(forecast.predictOverall))
  })
  it('uses todayPlanSummary days for active plans and a separate required rate', () => {
    const sessions = [focus(24, 1)]
    const result = row(sessions)
    const today = todayPlanSummary(sessions, plans, subjects, NOW)[0]
    expect(result.remainDays).toBe(today.remainDays)
    expect(result.todayHours).toBe(4)
    expect(result.requiredRate).toBeCloseTo(9 / 7)
    expect(result.requiredRate).not.toBe(result.todayHours)
  })
  it('keeps shared subject investment per plan but does not sum it for goal progress', () => {
    const second = { ...plans[0], id: 'p2', name: '冲刺', totalHours: 20 }
    const snapshot = buildStudySummary(data([focus(24, 2)], { plans: [...plans, second] }), NOW)
    expect(snapshot.plans.map(p => p.doneHours)).toEqual([2, 2])
    expect(snapshot.goalProgress[0]).toMatchObject({ doneHours: 2, totalHours: 30 })
    expect(snapshot.goalProgress[0].pct).toBe(goalProgress([focus(24, 2)], subjects, [...plans, second], 'g', NOW).pct)
  })
  it('uses forecast overall rate when recent activity is zero and reports the basis', () => {
    const result = row([focus(1, 2)])
    expect(result.rateRecent).toBe(0)
    expect(result.rateOverall).toBeGreaterThan(0)
    expect(result.health.rateBasis).toBe('overall')
    expect(result.predictRecent).toBeNull()
    expect(result.predictOverall).not.toBeNull()
  })
  it('keeps no-rate predictions null and classifies late urgency', () => {
    const result = row([], { plans: [{ ...plans[0], deadline: '2026-09-26' }] })
    expect(result.predictRecent).toBeNull()
    expect(result.predictOverall).toBeNull()
    expect(result.health).toMatchObject({ level: 'danger', reasonCode: 'NO_RATE_URGENT', rateBasis: 'none' })
  })
  it('reports no deadline without inventing days or required rate', () => {
    const result = row([focus(24)], { plans: [{ ...plans[0], deadline: null }] })
    expect(result).toMatchObject({ remainDays: null, requiredRate: null })
    expect(result.health.level).toBe('unassessed')
  })
  it('treats an invalid stored deadline as unavailable', () => {
    const result = row([focus(24)], { plans: [{ ...plans[0], deadline: '2026-02-30' }] })
    expect(result).toMatchObject({ deadline: null, remainDays: null, requiredRate: null })
    expect(result.health.reasonCode).toBe('NO_DEADLINE')
  })
  it('reports done before checking the deadline, and zero required rate', () => {
    const result = row([focus(24, 10)], { plans: [{ ...plans[0], deadline: '2026-09-23' }] })
    expect(result).toMatchObject({ remainingHours: 0, requiredRate: 0, completionPct: 100 })
    expect(result.health.reasonCode).toBe('DONE')
  })
  it('reports overdue and today deadline with inclusive calendar days', () => {
    expect(row([], { plans: [{ ...plans[0], deadline: '2026-09-23' }] }).health.reasonCode).toBe('OVERDUE')
    expect(row([], { plans: [{ ...plans[0], deadline: '2026-09-24' }] }).remainDays).toBe(1)
  })
  it('includes visible completed plans and excludes two archive representations', () => {
    const snapshot = buildStudySummary(data([], { plans: [
      { ...plans[0], id: 'done', status: '已完成' },
      { ...plans[0], id: 'flag', archived: true },
      { ...plans[0], id: 'status', status: '已归档' },
    ] }), NOW)
    expect(snapshot.plans.map(p => p.planId)).toEqual(['done'])
    expect(snapshot.plans[0].remainDays).toBe(7)
  })
  it('filters orphaned and archived parents from plans and goal progress', () => {
    expect(buildStudySummary(data([], { subjects: [] }), NOW).plans).toEqual([])
    expect(buildStudySummary(data([], { goals: [{ ...goals[0], archived: true }] }), NOW).goalProgress).toEqual([])
  })
  it('uses fmtHours and precise rates while keeping raw numbers for classification', () => {
    const result = row([focus(24, 0.5410477761194029)])
    expect(result.display.doneHours).toBe(fmtHours(result.doneHours))
    expect(result.display.remainingHours).toBe(fmtHours(result.remainingHours))
    expect(result.display.rateRecent).toBe(result.rateRecent.toFixed(2))
    expect(result.rateRecent).not.toBe(Number(result.display.rateRecent))
  })
})

describe('local health thresholds and prompts', () => {
  const base = { remainingHours: 8, remainDays: 4, requiredRate: 2, rateRecent: 1, rateOverall: 0, forecastStatus: 'behind' }
  it('uses inclusive three-day urgency and leaves four days behind', () => {
    expect(classifyPlanHealth({ ...base, remainDays: 3 }).level).toBe('danger')
    expect(classifyPlanHealth(base).level).toBe('behind')
  })
  it('treats exactly half of required speed as behind, below half as danger', () => {
    expect(classifyPlanHealth({ ...base, rateRecent: 1 }).level).toBe('behind')
    expect(classifyPlanHealth({ ...base, rateRecent: 0.999 }).level).toBe('danger')
  })
  it('does not override forecast on-track status and records recent basis', () => {
    expect(classifyPlanHealth({ ...base, forecastStatus: 'on-track', rateRecent: 0.1 })).toMatchObject({ level: 'healthy', rateBasis: 'recent' })
  })
  it('uses the adjust default question, while chat can propose the same adjustment', () => {
    const summary = buildStudySummary(data(), NOW)
    const adjust = buildChatMessages({ summary, mode: 'adjust' })
    const chat = buildChatMessages({ summary, mode: 'chat', text: '数学计划加 10 小时' })
    expect(adjust.at(-1).content).toContain('计划体检')
    expect(adjust[0].content).toContain('plan-adjust')
    expect(chat.at(-1).content).toBe('数学计划加 10 小时')
    expect(chat[0].content).toContain('plan-adjust')
  })
  it('keeps proposal guidance in plan mode and preserves follow-up context', () => {
    const summary = buildStudySummary(data(), NOW)
    const messages = buildChatMessages({ summary, mode: 'plan', text: '再改改', history: [{ role: 'user', content: '开始规划' }, { role: 'assistant', content: '先问截止日期' }] })
    expect(messages[0].content).toContain('plan-proposal')
    expect(messages[0].content).toContain('plan-adjust')
    expect(messages.at(-1).content).toBe('再改改')
    expect(messages[1].content).toBe('开始规划')
  })
})

describe('ai-adjust: 按钮文案与默认问题映射(v0.7.0 初审整改)', () => {
  it('adjust 按钮短文案"计划体检"映射成完整默认问题', () => {
    const summary = buildStudySummary(data(), NOW)
    const msgs = buildChatMessages({ summary, mode: 'adjust', text: '计划体检' })
    expect(msgs.at(-1).content).toContain('请基于最新学习数据做计划体检，并在需要时提出调整方案。')
  })
  it('续聊自定义文字不被映射覆盖', () => {
    const summary = buildStudySummary(data(), NOW)
    const msgs = buildChatMessages({ summary, mode: 'adjust', text: '数学推迟一周' })
    expect(msgs.at(-1).content).toBe('数学推迟一周')
  })
})
