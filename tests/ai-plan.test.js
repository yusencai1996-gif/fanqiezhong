import { describe, it, expect } from 'vitest'
import {
  buildChatMessages,
  buildStudySummary,
  parsePlanProposal,
  reduceAiSession,
  createAiSession,
  validatePlanAgainstStore,
} from '../src/features/ai.js'

const NOW = new Date(2026, 8, 24, 12)
const summary = buildStudySummary({ sessions: [], plans: [], subjects: [], goals: [] }, NOW)

const VALID_REPLY = `好的,信息齐了,思路是先把数学的大头铺开:\n\n\`\`\`plan-proposal
{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"},{"name":"英语"}],"plans":[{"subjectName":"数学","name":"一轮复习","totalHours":40,"deadline":"2026-11-30"},{"subjectName":"英语","name":"单词长难句","totalHours":20,"deadline":"2026-12-01"}]}
\`\`\``

const block = (json) => `说明文字\n\`\`\`plan-proposal\n${json}\n\`\`\``
const VALID_JSON = '{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"}],"plans":[{"subjectName":"数学","name":"一轮","totalHours":40,"deadline":"2026-11-30"}]}'

describe('ai-plan: parsePlanProposal(v0.6.0)', () => {
  it('从带说明文字的回复提取方案并归一化字段', () => {
    const res = parsePlanProposal(VALID_REPLY)
    expect(res.ok).toBe(true)
    expect(res.proposal.goal).toEqual({ name: '考研', deadline: '2026-12-20' })
    expect(res.proposal.subjects).toEqual([{ name: '数学' }, { name: '英语' }])
    expect(res.proposal.plans[0]).toEqual({ subjectName: '数学', name: '一轮复习', totalHours: 40, deadline: '2026-11-30' })
    // rest:正文去掉标记块,供气泡渲染(不裸露 JSON)
    expect(res.rest).toContain('思路')
    expect(res.rest).not.toContain('plan-proposal')
    expect(res.rest).not.toContain('"goal"')
  })

  it('无标记块返回 ok:false', () => {
    expect(parsePlanProposal('普通回答,没有方案').ok).toBe(false)
    expect(parsePlanProposal('').ok).toBe(false)
    expect(parsePlanProposal(null).ok).toBe(false)
  })

  it('标记块内 JSON 坏返回 ok:false', () => {
    expect(parsePlanProposal(block('{not json')).ok).toBe(false)
  })

  it('字段缺失拒绝:goal 缺 deadline / plans 缺 name', () => {
    expect(parsePlanProposal(block('{"goal":{"name":"考研"},"subjects":[],"plans":[]}')).ok).toBe(false)
    expect(parsePlanProposal(block('{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"}],"plans":[{"subjectName":"数学","totalHours":40,"deadline":"2026-11-30"}]}')).ok).toBe(false)
  })

  it('类型错拒绝:totalHours 是字符串 / subjects 不是数组', () => {
    expect(parsePlanProposal(block('{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"}],"plans":[{"subjectName":"数学","name":"一轮","totalHours":"40","deadline":"2026-11-30"}]}')).ok).toBe(false)
    expect(parsePlanProposal(block('{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":"数学","plans":[]}')).ok).toBe(false)
  })

  it('totalHours 越界拒绝:0、负数、超过 2000', () => {
    for (const h of [0, -5, 2001]) {
      const json = `{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"}],"plans":[{"subjectName":"数学","name":"一轮","totalHours":${h},"deadline":"2026-11-30"}]}`
      expect(parsePlanProposal(block(json)).ok).toBe(false)
    }
  })

  it('deadline 格式错或非真实日期拒绝', () => {
    for (const d of ['2026/12/20', '2026-12-20 10:00', '2026-02-30', '2026-13-01', '']) {
      const json = `{"goal":{"name":"考研","deadline":"${d}"},"subjects":[],"plans":[]}`
      expect(parsePlanProposal(block(json)).ok).toBe(false)
    }
  })

  it('plans 的 subjectName 对不上 subjects 拒绝;科目重名也拒绝', () => {
    expect(parsePlanProposal(block('{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"}],"plans":[{"subjectName":"英语","name":"一轮","totalHours":40,"deadline":"2026-11-30"}]}')).ok).toBe(false)
    expect(parsePlanProposal(block('{"goal":{"name":"考研","deadline":"2026-12-20"},"subjects":[{"name":"数学"},{"name":"数学"}],"plans":[]}')).ok).toBe(false)
  })

  it('goal.name 空字符串拒绝', () => {
    expect(parsePlanProposal(block('{"goal":{"name":"  ","deadline":"2026-12-20"},"subjects":[],"plans":[]}')).ok).toBe(false)
  })
})

describe('ai-plan: validatePlanAgainstStore(v0.6.0)', () => {
  const proposal = parsePlanProposal(VALID_REPLY).proposal

  it('正常生成按依赖序的操作序列', () => {
    const res = validatePlanAgainstStore(proposal, { goals: [], subjects: [], plans: [] })
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([])
    expect(res.ops.map(o => o.op)).toEqual(['addGoal', 'addSubject', 'addSubject', 'addPlan', 'addPlan'])
    expect(res.ops[0]).toMatchObject({ name: '考研', deadline: '2026-12-20' })
    expect(res.ops[1]).toMatchObject({ goalName: '考研', name: '数学' })
    expect(res.ops[3]).toMatchObject({ subjectName: '数学', name: '一轮复习', totalHours: 40 })
  })

  it('与现有未归档目标重名给 warning 但不阻止;已归档同名不警告', () => {
    const dup = validatePlanAgainstStore(proposal, { goals: [{ id: 'g1', name: '考研', archived: false }] })
    expect(dup.ok).toBe(true)
    expect(dup.warnings.some(w => w.includes('考研'))).toBe(true)
    const archived = validatePlanAgainstStore(proposal, { goals: [{ id: 'g1', name: '考研', archived: true }] })
    expect(archived.warnings).toEqual([])
  })

  it('plans 空给 warning,操作序列只含目标和科目', () => {
    const res = validatePlanAgainstStore({ goal: { name: '考研', deadline: '2026-12-20' }, subjects: [{ name: '数学' }], plans: [] }, { goals: [] })
    expect(res.ok).toBe(true)
    expect(res.warnings.some(w => w.includes('不包含任何计划'))).toBe(true)
    expect(res.ops.map(o => o.op)).toEqual(['addGoal', 'addSubject'])
  })

  it('结构不合法返回 ok:false', () => {
    expect(validatePlanAgainstStore(null, {}).ok).toBe(false)
    expect(validatePlanAgainstStore({ goal: { name: 'x' } }, {}).ok).toBe(false)
  })
})

describe('ai-plan: plan 模式消息编排与系统提示(v0.6.0)', () => {
  it('plan 模式 system 带方案格式约定,最后一条是用户文本', () => {
    const messages = buildChatMessages({ summary, history: [], text: '开始规划', mode: 'plan' })
    expect(messages.map(m => m.role)).toEqual(['system', 'user'])
    expect(messages[0].content).toContain('plan-proposal')
    expect(messages[0].content).toContain('一次只问 1-2 个问题')
    expect(messages[1].content).toBe('开始规划')
  })

  it('note 事件追加 system 气泡但不进 AI 请求上下文', () => {
    let s = reduceAiSession(createAiSession(), { type: 'send', requestId: 'r1', content: '开始规划', mode: 'plan' })
    s = reduceAiSession(s, { type: 'resolve', requestId: 'r1', content: VALID_REPLY })
    s = reduceAiSession(s, { type: 'note', content: '方案已创建:目标「考研」、2 个科目、2 个计划' })
    expect(s.history.at(-1)).toEqual({ role: 'system', content: '方案已创建:目标「考研」、2 个科目、2 个计划' })
    const messages = buildChatMessages({ summary, history: s.history, text: '再改改', mode: 'plan' })
    expect(JSON.stringify(messages)).not.toContain('方案已创建')
    expect(messages.at(-1).content).toBe('再改改')
  })
})
