import { describe, it, expect } from 'vitest'
import { buildStudySummary, buildSystemPrompt, buildChatMessages, reduceAiSession, initialAiSession, createAiSession, parseAiMarkdown } from '../src/features/ai.js'

const NOW = new Date(2026, 8, 24, 12)
const stamp = (day, hour = 9) => new Date(2026, 8, day, hour).toISOString()
const session = (day, subjectId, durationSec, status = '完成', type = '专注', subjectName = null) => ({ startedAt: stamp(day), subjectId, subjectName, durationSec, status, type })
const goals = [{ id: 'g', name: '考试', archived: false }]
const subjects = [{ id: 's', goalId: 'g', name: '数学', archived: false }]
const plans = [{ id: 'p', subjectId: 's', name: '一轮', status: '进行中', archived: false, totalHours: 10, deadline: '2026-09-30', manualDaily: { '2026-09-24': 1 } }]
const data = (sessions = [], overrides = {}) => ({ sessions, plans, subjects, goals, ...overrides })

describe('AI study summary', () => {
  it('matches today statistics and keeps exact seconds plus display text', () => {
    const summary = buildStudySummary(data([session(24, 's', 1500), session(24, 's', 605, '提前结束'), session(24, 's', 65, '异常中断')]), NOW)
    expect(summary.today).toMatchObject({ totalSec: 2170, count: 3, displayDuration: '36分' })
    expect(summary.today.subjects[0]).toMatchObject({ totalSec: 2170, count: 3 })
  })

  it('excludes breaks and skipped work', () => {
    const summary = buildStudySummary(data([session(24, 's', 600), session(24, 's', 600, '跳过'), session(24, 's', 600, '完成', '休息')]), NOW)
    expect(summary.today).toMatchObject({ totalSec: 600, count: 1 })
  })

  it('uses seven days including today and retains empty days', () => {
    const summary = buildStudySummary(data([session(18, 's', 60), session(24, 's', 120)]), NOW)
    expect(summary.last7Days.days).toHaveLength(7)
    expect(summary.last7Days.from).toBe('2026-09-18')
    expect(summary.last7Days.through).toBe('2026-09-24')
    expect(summary.last7Days.days[1].totalSec).toBe(0)
  })

  it('keeps free focus in a separate distribution row', () => {
    const summary = buildStudySummary(data([session(24, null, 300)]), NOW)
    expect(summary.today.subjects).toEqual([{ subjectId: null, subjectName: '自由专注', totalSec: 300, count: 1, displayDuration: '5分' }])
  })

  it('uses historical subject snapshot after deletion or rename', () => {
    const summary = buildStudySummary(data([session(24, 'gone', 300, '完成', '专注', '旧科目')]), NOW)
    expect(summary.today.subjects[0].subjectName).toBe('旧科目')
  })

  it('supports empty data without invented activity', () => {
    const summary = buildStudySummary(data(), NOW)
    expect(summary.today).toMatchObject({ totalSec: 0, count: 0 })
    expect(summary.plans).toHaveLength(1)
    expect(summary.last7Days.subjects).toEqual([])
  })

  it('does not mutate input', () => {
    const input = data([session(24, 's', 300)])
    const before = structuredClone(input)
    buildStudySummary(input, NOW)
    expect(input).toEqual(before)
  })

  it('filters archived and orphaned plans from current advice', () => {
    const summary = buildStudySummary(data([], { plans: [...plans, { ...plans[0], id: 'hidden', archived: true }, { ...plans[0], id: 'orphan', subjectId: 'missing' }] }), NOW)
    expect(summary.plans.map(p => p.planId)).toEqual(['p'])
  })

  it('filters plans under archived goals and subjects', () => {
    expect(buildStudySummary(data([], { goals: [{ ...goals[0], archived: true }] }), NOW).plans).toEqual([])
    expect(buildStudySummary(data([], { subjects: [{ ...subjects[0], archived: true }] }), NOW).plans).toEqual([])
  })

  it('uses four argument today plan calculation and manual daily override', () => {
    const summary = buildStudySummary(data([session(24, 's', 1800)]), NOW)
    expect(summary.plans[0]).toMatchObject({ todayHours: 1, todayDoneHours: 0.5, doneHours: 0.5 })
  })

  it('shows completed and overdue progress but gives them no today need', () => {
    const summary = buildStudySummary(data([], { plans: [{ ...plans[0], status: '已完成' }, { ...plans[0], id: 'late', deadline: '2026-09-23' }] }), NOW)
    expect(summary.plans[0]).toMatchObject({ status: '已完成', todayHours: 0 })
    expect(summary.plans[1]).toMatchObject({ isOverdue: true, todayHours: 0 })
  })

  it('does not add shared subject investment across multiple plans', () => {
    const summary = buildStudySummary(data([session(24, 's', 3600)], { plans: [...plans, { ...plans[0], id: 'p2' }] }), NOW)
    expect(summary.today.totalSec).toBe(3600)
    expect(summary.plans.map(p => p.doneHours)).toEqual([1, 1])
    expect(summary.plans.every(p => p.sharedSubjectInvestment)).toBe(true)
    expect(summary.todayPlanSubjects).toHaveLength(1)
    expect(summary.todayPlanSubjects[0]).toMatchObject({ subjectId: 's' })
    expect(summary.todayPlanSubjects[0].plans).toHaveLength(2)
  })

  it('computes tomorrow by local calendar date and labels it an estimate', () => {
    const summary = buildStudySummary(data(), NOW)
    expect(summary.tomorrowReference.date).toBe('2026-09-25')
    expect(summary.tomorrowReference.note).toContain('估算')
    expect(summary.tomorrowReference.plans).toHaveLength(1)
  })

  it('does not accept settings or a key into the summary', () => {
    const summary = buildStudySummary({ ...data(), settings: { aiConfig: { apiKey: 'sk-test-12345678' } } }, NOW)
    expect(JSON.stringify(summary)).not.toContain('sk-test-12345678')
  })
})

describe('AI prompt and session', () => {
  const summary = buildStudySummary(data(), NOW)
  it('separates data from instructions and states read-only scope', () => {
    const prompt = buildSystemPrompt(summary)
    expect(prompt).toContain('只读中文陪学助理')
    expect(prompt).toContain('不要声称已经修改')
    expect(prompt).toContain('同科目多个计划共享')
  })
  it.each(['chat', 'review', 'order'])('builds %s messages with a fresh system snapshot', mode => {
    const messages = buildChatMessages({ summary, history: [], text: '问题', mode })
    expect(messages.map(m => m.role)).toEqual(['system', 'user'])
    expect(messages[0].content).toContain(summary.localDate)
  })
  it('only sends recent complete exchanges and keeps the latest question', () => {
    const history = Array.from({ length: 25 }, (_, i) => [{ role: 'user', content: `Q${i}` }, { role: 'assistant', content: `A${i}` }]).flat()
    const messages = buildChatMessages({ summary, history, text: '现在呢' })
    expect(messages).toHaveLength(42)
    expect(messages[1].content).toBe('Q5')
    expect(messages.at(-1).content).toBe('现在呢')
    expect(messages[0].content).toContain('较早的对话未纳入')
  })
  it('drops an unanswered history question when retrying', () => {
    const messages = buildChatMessages({ summary, history: [{ role: 'user', content: '失败的问题' }], text: '失败的问题' })
    expect(messages.filter(m => m.role === 'user')).toHaveLength(1)
  })
  it('keeps failure out of successful history and does not duplicate user on retry', () => {
    const started = reduceAiSession(initialAiSession, { type: 'start', requestId: 'one', text: '问题', mode: 'chat' })
    const failed = reduceAiSession(started, { type: 'failure', requestId: 'one', code: 'NETWORK_ERROR' })
    const retry = reduceAiSession(failed, { type: 'start', requestId: 'two', text: '问题', mode: 'chat' })
    expect(retry.history).toEqual([{ role: 'user', content: '问题' }])
    expect(retry.error).toBeNull()
  })
  it('ignores late responses and duplicate starts', () => {
    const started = reduceAiSession(initialAiSession, { type: 'start', requestId: 'one', text: '问题' })
    expect(reduceAiSession(started, { type: 'start', requestId: 'two', text: '重复' })).toBe(started)
    expect(reduceAiSession(started, { type: 'success', requestId: 'old', content: '旧答案' })).toBe(started)
  })
  it('supports panel send, reject, retry and resolve events without duplicate bubbles', () => {
    const sent = reduceAiSession(createAiSession(), { type: 'send', requestId: 'one', content: '问题', mode: 'chat' })
    const failed = reduceAiSession(sent, { type: 'reject', requestId: 'one', error: { code: 'NETWORK_ERROR', retryable: true } })
    expect(failed.messages).toHaveLength(1)
    expect(failed.messages[0].error.code).toBe('NETWORK_ERROR')
    const retry = reduceAiSession(failed, { type: 'retry', requestId: 'one' })
    expect(retry.messages).toHaveLength(1)
    expect(retry.messages[0].error).toBeNull()
    const done = reduceAiSession(retry, { type: 'resolve', requestId: 'one', content: '答案' })
    expect(done.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(done.pending).toBeNull()
  })
})

describe('ai: reduceAiSession cancel/reset(v0.5.0 初审阻断修复配套)', () => {
  it('cancel 清 pending 且带归属守卫;用户消息保留、不产生错误', () => {
    let s = reduceAiSession(createAiSession(), { type: 'send', requestId: 'r1', content: '问', mode: 'chat' })
    expect(s.pending?.requestId).toBe('r1')
    s = reduceAiSession(s, { type: 'cancel', requestId: 'other' })   // 归属不匹配:不生效
    expect(s.pending?.requestId).toBe('r1')
    s = reduceAiSession(s, { type: 'cancel', requestId: 'r1' })
    expect(s.pending).toBeNull()
    expect(s.messages.map(m => m.role)).toEqual(['user'])
    expect(s.messages[0].error).toBeUndefined()
  })
  it('cancel 后可再次发送(面板不锁死——阻断项核心断言)', () => {
    let s = reduceAiSession(createAiSession(), { type: 'send', requestId: 'r1', content: '问', mode: 'chat' })
    s = reduceAiSession(s, { type: 'cancel', requestId: 'r1' })
    s = reduceAiSession(s, { type: 'send', requestId: 'r2', content: '再问', mode: 'chat' })
    expect(s.pending?.requestId).toBe('r2')
    expect(s.messages.map(m => m.role)).toEqual(['user', 'user'])
  })
  it('reset 清空整个会话', () => {
    let s = reduceAiSession(createAiSession(), { type: 'send', requestId: 'r1', content: '问', mode: 'chat' })
    s = reduceAiSession(s, { type: 'resolve', requestId: 'r1', content: '答' })
    s = reduceAiSession(s, { type: 'reset' })
    expect(s.messages).toHaveLength(0)
    expect(s.history).toHaveLength(0)
    expect(s.pending).toBeNull()
  })
})

describe('ai: parseAiMarkdown 轻量解析(v0.5.2)', () => {
  it('标题/加粗/行内代码', () => {
    const blocks = parseAiMarkdown('## 一、今日完成情况\n共 **3 条**，约 `95` 分钟')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 })
    expect(blocks[0].spans.some(s => s.text === '一、今日完成情况')).toBe(true)
    expect(blocks[1].type).toBe('paragraph')
    expect(blocks[1].spans).toEqual(expect.arrayContaining([
      { text: '共 ' }, { text: '3 条', bold: true }, { text: '，约 ' }, { text: '95', code: true }, { text: ' 分钟' },
    ]))
  })
  it('无序/有序列表与引用、空行', () => {
    const blocks = parseAiMarkdown('- 数学 25 分\n1. 先学数学\n> 提示：数据为快照\n\n结尾段')
    expect(blocks[0].type).toBe('bullet')
    expect(blocks[1]).toMatchObject({ type: 'ordered', index: '1' })
    expect(blocks[2].type).toBe('quote')
    expect(blocks[3].type).toBe('blank')
    expect(blocks[4].type).toBe('paragraph')
  })
  it('无 Markdown 符号的纯文本原样为段落;空输入返回单空行', () => {
    expect(parseAiMarkdown('你好')[0].type).toBe('paragraph')
    expect(parseAiMarkdown('')[0].type).toBe('blank')
    expect(parseAiMarkdown(null)[0].type).toBe('blank')
  })
  it('星号不吞文本:乘号原样保留,单星不触发斜体', () => {
    const spans = parseAiMarkdown('2*3*4 与 5*6')[0].spans
    const joined = spans.map(s => s.text).join('')
    expect(joined).toBe('2*3*4 与 5*6')   // 内容不丢
    expect(spans.some(s => s.italic)).toBe(false)   // v0.5.2:单星不当斜体(防乘号歧义)
  })
})
