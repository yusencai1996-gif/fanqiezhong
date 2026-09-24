import { describe, it, expect } from 'vitest'
import { parsePlanAdjustment, pickPlanAdjustmentPatch, validatePlanAdjustment, preparePlanAdjustmentApply, sameAdjustmentIdentity } from '../src/features/ai.js'

const state = () => ({
  goals: [{ id: 'g1', name: '考试', archived: false }],
  subjects: [{ id: 's1', goalId: 'g1', name: '数学', archived: false }],
  plans: [
    { id: 'p1', subjectId: 's1', name: '强化', totalHours: 40, deadline: '2026-10-30', status: '进行中', archived: false, manualDaily: { '2026-09-24': 2 } },
    { id: 'p2', subjectId: 's1', name: '冲刺', totalHours: 20, deadline: null, status: '已完成', archived: false },
  ],
  sessions: [{ id: 'f1', subjectId: 's1', durationSec: 3600 }],
})
const change = (extra = {}) => ({ subjectName: '数学', planName: '强化', totalHours: 50, ...extra })
const adjustment = (changes = [change()]) => ({ changes })
const block = value => `1. 数学 · 强化：延长学习安排。\n\`\`\`plan-adjust\n${typeof value === 'string' ? value : JSON.stringify(value)}\n\`\`\``

describe('plan adjustment parser', () => {
  it('extracts one block, keeps the reasons, and trims identifiers', () => {
    const result = parsePlanAdjustment(block(adjustment([change({ subjectName: ' 数学 ', planName: ' 强化 ' })])))
    expect(result).toMatchObject({ ok: true, adjustment: { changes: [{ subjectName: '数学', planName: '强化', totalHours: 50 }] } })
    expect(result.rest).toContain('数学 · 强化')
    expect(result.rest).not.toContain('plan-adjust')
  })
  it('accepts multi-change adjustments in one block', () => {
    expect(parsePlanAdjustment(block(adjustment([change({ name: '强化二', deadline: '2026-12-07' }), { subjectName: '数学', planName: '冲刺', deadline: '2026-12-08' }]))).adjustment.changes).toHaveLength(2)
  })
  it.each([null, '', '普通体检报告', '```plan-adjust\n{}'])('rejects absent or unfinished blocks', text => {
    expect(parsePlanAdjustment(text)).toEqual({ ok: false })
  })
  it('rejects malformed JSON', () => expect(parsePlanAdjustment(block('{oops'))).toEqual({ ok: false }))
  it('rejects two adjustment blocks', () => expect(parsePlanAdjustment(block(adjustment()) + block(adjustment())).ok).toBe(false))
  it('rejects mixed proposal and adjustment blocks', () => expect(parsePlanAdjustment(block(adjustment()) + '\n```plan-proposal\n{}\n```').ok).toBe(false))
  it.each([{}, { changes: [] }, { changes: 'wrong' }, [], null, { changes: [change()], id: 'fake' }])('rejects malformed top level %j', value => {
    expect(parsePlanAdjustment(block(value)).ok).toBe(false)
  })
  it.each([null, [], 12, { subjectName: '', planName: '强化', name: 'x' }, { subjectName: '数学', planName: ' ', name: 'x' }, { subjectName: '数学', planName: '强化' }])('rejects malformed entry %j', entry => {
    expect(parsePlanAdjustment(block(adjustment([entry]))).ok).toBe(false)
  })
  it.each(['50', null, 0, -1, 2001, true])('rejects invalid totalHours %j without coercion', totalHours => {
    expect(parsePlanAdjustment(block(adjustment([change({ totalHours })]))).ok).toBe(false)
  })
  it.each([1, 2000, 50.125])('accepts numeric boundary or decimal %s', totalHours => {
    expect(parsePlanAdjustment(block(adjustment([change({ totalHours })]))).ok).toBe(true)
  })
  it('rejects nonfinite numbers in direct validation', () => {
    for (const totalHours of [NaN, Infinity, -Infinity]) expect(validatePlanAdjustment(adjustment([change({ totalHours })]), state()).ok).toBe(false)
  })
  it.each(['2026-02-29', '2026-02-30', '2026/12/07', '', null])('rejects invalid date %j', deadline => {
    expect(parsePlanAdjustment(block(adjustment([change({ deadline })]))).ok).toBe(false)
  })
  it('accepts leap day and past real dates', () => {
    for (const deadline of ['2028-02-29', '2025-01-01']) expect(parsePlanAdjustment(block(adjustment([change({ deadline })]))).ok).toBe(true)
  })
  it.each(['id', 'subjectId', 'status', 'archived', 'manualDaily', 'createdAt'])('rejects unknown entry key %s', key => {
    expect(parsePlanAdjustment(block(adjustment([change({ [key]: 'attack' })]))).ok).toBe(false)
  })
  it('rejects own __proto__ key', () => {
    expect(parsePlanAdjustment(block('{"changes":[{"subjectName":"数学","planName":"强化","name":"新名","__proto__":{}}]}')).ok).toBe(false)
  })
  it('rejects null or blank clearing values', () => {
    for (const patch of [{ name: null }, { name: ' ' }, { deadline: null }, { deadline: '' }]) expect(validatePlanAdjustment(adjustment([change(patch)]), state()).ok).toBe(false)
  })
})

describe('plan adjustment validation and preparation', () => {
  it('picks only the three patch fields', () => expect(pickPlanAdjustmentPatch(change({ name: '强化二', deadline: '2026-12-07' }))).toEqual({ ok: true, patch: { name: '强化二', totalHours: 50, deadline: '2026-12-07' } }))
  it('rejects an unknown field directly in picker and validator', () => {
    const input = change({ status: '已完成' })
    expect(pickPlanAdjustmentPatch(input).ok).toBe(false)
    expect(validatePlanAdjustment(adjustment([input]), state()).ops).toEqual([])
  })
  it('builds a real before/after preview and input-order operations', () => {
    const input = adjustment([change({ name: '强化二', deadline: '2026-12-07' }), { subjectName: '数学', planName: '冲刺', deadline: '2026-12-08' }])
    const snapshot = state()
    const copy = structuredClone({ input, snapshot })
    const result = validatePlanAdjustment(input, snapshot)
    expect(result.ok).toBe(true)
    expect(result.ops).toEqual([{ op: 'updatePlan', id: 'p1', patch: { name: '强化二', totalHours: 50, deadline: '2026-12-07' } }, { op: 'updatePlan', id: 'p2', patch: { deadline: '2026-12-08' } }])
    expect(result.previews[0]).toMatchObject({ changeIndex: 0, goalId: 'g1', subjectId: 's1', planId: 'p1', before: { name: '强化', totalHours: 40, deadline: '2026-10-30' }, after: { name: '强化二', totalHours: 50, deadline: '2026-12-07' }, changedFields: ['name', 'totalHours', 'deadline'] })
    expect({ input, snapshot }).toEqual(copy)
  })
  it('removes unchanged fields from patches', () => {
    const result = validatePlanAdjustment(adjustment([change({ name: '强化', deadline: '2026-10-30' })]), state())
    expect(result.ops[0].patch).toEqual({ totalHours: 50 })
  })
  it('warns on one no-op but can apply other changes', () => {
    const result = validatePlanAdjustment(adjustment([{ subjectName: '数学', planName: '强化', totalHours: 40 }, { subjectName: '数学', planName: '冲刺', totalHours: 25 }]), state())
    expect(result.ok).toBe(true)
    expect(result.ops).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
  })
  it('rejects an all-no-op proposal', () => {
    const result = validatePlanAdjustment(adjustment([{ subjectName: '数学', planName: '强化', totalHours: 40 }]), state())
    expect(result).toMatchObject({ ok: false, ops: [] })
    expect(result.errors[0].code).toBe('NO_CHANGES')
  })
  it('rejects missing plans with the original index and no partial ops', () => {
    const result = validatePlanAdjustment(adjustment([change(), { subjectName: '数学', planName: '不存在', name: 'x' }]), state())
    expect(result).toMatchObject({ ok: false, ops: [] })
    expect(result.errors[0]).toMatchObject({ changeIndex: 1, code: 'PLAN_NOT_FOUND' })
  })
  it('rejects duplicate names across goals as ambiguous', () => {
    const snapshot = state()
    snapshot.goals.push({ id: 'g2', name: '另一个', archived: false })
    snapshot.subjects.push({ id: 's2', goalId: 'g2', name: '数学', archived: false })
    snapshot.plans.push({ ...snapshot.plans[0], id: 'p3', subjectId: 's2' })
    const result = validatePlanAdjustment(adjustment(), snapshot)
    expect(result.errors[0].code).toBe('AMBIGUOUS_PLAN')
    expect(result.ops).toEqual([])
  })
  it.each(['goal', 'subject', 'plan', 'status', 'orphan'])('rejects hidden or orphaned %s', target => {
    const snapshot = state()
    if (target === 'goal') snapshot.goals[0].archived = true
    if (target === 'subject') snapshot.subjects[0].archived = true
    if (target === 'plan') snapshot.plans[0].archived = true
    if (target === 'status') snapshot.plans[0].status = '已归档'
    if (target === 'orphan') snapshot.subjects = []
    expect(validatePlanAdjustment(adjustment(), snapshot).errors[0].code).toBe('PLAN_NOT_FOUND')
  })
  it('rejects repeated targets and does not resolve later entries using the new name', () => {
    expect(validatePlanAdjustment(adjustment([change({ name: '新名' }), change({ totalHours: 60 })]), state()).errors[0].code).toBe('DUPLICATE_TARGET')
    expect(validatePlanAdjustment(adjustment([change({ name: '新名' }), { subjectName: '数学', planName: '新名', totalHours: 60 }]), state()).errors[0].code).toBe('PLAN_NOT_FOUND')
  })
  it('rejects a rename that collides inside the subject', () => {
    expect(validatePlanAdjustment(adjustment([change({ name: '冲刺' })]), state()).errors[0].code).toBe('DUPLICATE_PLAN_NAME')
  })
  it('rejects two changes that create the same new name', () => {
    const result = validatePlanAdjustment(adjustment([change({ name: '合并名' }), { subjectName: '数学', planName: '冲刺', name: '合并名' }]), state())
    expect(result).toMatchObject({ ok: false, ops: [] })
    expect(result.errors[0]).toMatchObject({ changeIndex: 1, code: 'DUPLICATE_PLAN_NAME' })
  })
  it('does not let a bad second item write the first', () => {
    const result = validatePlanAdjustment(adjustment([change(), { subjectName: '数学', planName: '冲刺', totalHours: '25' }]), state())
    expect(result.ok).toBe(false)
    expect(result.ops).toEqual([])
    expect(result.errors[0]).toMatchObject({ changeIndex: 1, code: 'INVALID_ADJUSTMENT' })
  })
  it('prepares unchanged previews without side effects, including a new focus record', () => {
    const snapshot = state()
    const input = adjustment()
    const preview = validatePlanAdjustment(input, snapshot).previews
    snapshot.sessions.push({ id: 'f2', subjectId: 's1', durationSec: 1200 })
    expect(preparePlanAdjustmentApply(input, snapshot, preview)).toMatchObject({ ok: true, stale: false })
    expect(snapshot.plans[0].totalHours).toBe(40)
  })
  it.each(['name', 'totalHours', 'deadline', 'status', 'archived', 'subjectId'])('rejects changed %s after preview', key => {
    const snapshot = state()
    const preview = validatePlanAdjustment(adjustment(), snapshot).previews
    snapshot.plans[0][key] = key === 'totalHours' ? 41 : key === 'archived' ? true : key === 'subjectId' ? 's2' : 'changed'
    const result = preparePlanAdjustmentApply(adjustment(), snapshot, preview)
    expect(result).toMatchObject({ ok: false, stale: true, ops: [] })
    expect(result.errors[0].code).toBe('STALE_PREVIEW')
  })
  it('rejects archive, deletion, and same-name replacement after preview', () => {
    for (const mutate of [s => { s.goals[0].archived = true }, s => { s.plans = [] }, s => { s.plans[0].id = 'replacement' }]) {
      const snapshot = state()
      const preview = validatePlanAdjustment(adjustment(), snapshot).previews
      mutate(snapshot)
      expect(preparePlanAdjustmentApply(adjustment(), snapshot, preview).stale).toBe(true)
    }
  })
  it('requires a genuine expected preview', () => {
    expect(preparePlanAdjustmentApply(adjustment(), state(), null)).toMatchObject({ ok: false, stale: true, ops: [] })
  })
  it('only changes listed plan attributes when operations are applied', () => {
    const snapshot = state()
    const original = structuredClone(snapshot)
    const result = validatePlanAdjustment(adjustment(), snapshot)
    for (const op of result.ops) Object.assign(snapshot.plans.find(p => p.id === op.id), op.patch)
    expect(snapshot.plans[0]).toEqual({ ...original.plans[0], totalHours: 50 })
    expect(snapshot.plans[1]).toEqual(original.plans[1])
    expect(snapshot.sessions).toEqual(original.sessions)
    expect(snapshot.goals).toEqual(original.goals)
    expect(snapshot.subjects).toEqual(original.subjects)
  })
})

describe('plan adjustment validator 攻击面补充(v0.7.0 专审整改)', () => {
  it('绕过 parse 直击 validator 的 __proto__ 自有键被拒(JSON.parse 构造)', () => {
    const malicious = JSON.parse('{"changes":[{"subjectName":"数学","planName":"强化","totalHours":50,"__proto__":{"polluted":true}}]}')
    const r = validatePlanAdjustment(malicious, state())
    expect(r.ok).toBe(false)
    expect(r.ops).toEqual([])
    expect(({}).polluted).toBeUndefined()   // 原型未被污染
  })
  it('expectedPreview 支持对象形态 {previews:[...]}(与数组同效)', () => {
    const s = state()
    const v = validatePlanAdjustment(adjustment(), s)
    const r = preparePlanAdjustmentApply(adjustment(), s, { previews: v.previews })
    expect(r.ok).toBe(true)
    expect(r.stale).toBeFalsy()
  })
})

describe('adjustment refresh identity anchor(v0.7.0 复审 B1 整改)', () => {
  it('身份一致(仅属性快照变化)允许刷新', () => {
    const s = state()
    const before = validatePlanAdjustment(adjustment(), s).previews
    s.plans = s.plans.map(p => p.id === 'p1' ? { ...p, totalHours: 42 } : p)   // 属性变了,id 没变
    const after = validatePlanAdjustment(adjustment(), s).previews
    expect(sameAdjustmentIdentity(before, after)).toBe(true)
  })
  it('同名新计划(id 变)拒绝刷新——旧方案不得换绑', () => {
    const s = state()
    const before = validatePlanAdjustment(adjustment(), s).previews
    const s2 = { ...s, plans: [ ...s.plans.filter(p => p.id !== 'p1'), { ...s.plans[0], id: 'p9' } ] }
    const after = validatePlanAdjustment(adjustment(), s2).previews
    expect(after).toHaveLength(1)
    expect(sameAdjustmentIdentity(before, after)).toBe(false)
  })
  it('长度不同/非数组一律拒绝', () => {
    expect(sameAdjustmentIdentity([], [])).toBe(true)
    expect(sameAdjustmentIdentity([{ planId: 'a' }], [])).toBe(false)
    expect(sameAdjustmentIdentity(null, [])).toBe(false)
  })
})
