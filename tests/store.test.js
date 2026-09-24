import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryStore, migrateState, CURRENT_SCHEMA_VERSION, evaluateRecovery } from '../src/data/store.js'
import { todayPlanSummary } from '../src/features/planning.js'

describe('memory store', () => {
  let store
  beforeEach(() => { store = createMemoryStore() })

  it('初始状态有默认设置', () => {
    const state = store.getState()
    expect(state.settings.workMinutes).toBe(25)
    expect(state.settings.shortBreakMinutes).toBe(5)
    expect(state.tasks).toEqual([])
    expect(state.sessions).toEqual([])
  })

  it('能添加任务', () => {
    store.addTask({ title: '写报告' })
    const tasks = store.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('写报告')
    expect(tasks[0].id).toBeTruthy()
    expect(tasks[0].completed).toBe(false)
  })

  it('能记录一次专注', () => {
    store.addSession({ taskId: null, type: '专注', durationSec: 1500, status: '完成' })
    expect(store.getState().sessions).toHaveLength(1)
    expect(store.getState().sessions[0].durationSec).toBe(1500)
  })

  it('能更新设置', () => {
    store.updateSettings({ workMinutes: 45 })
    expect(store.getState().settings.workMinutes).toBe(45)
    // 未传的字段保留
    expect(store.getState().settings.shortBreakMinutes).toBe(5)
  })

  it('能切换任务完成状态', () => {
    store.addTask({ title: 'A' })
    const id = store.getState().tasks[0].id
    store.toggleTask(id)
    expect(store.getState().tasks[0].completed).toBe(true)
  })

  // === 任务排序(v0.2.6) ===
  it('新任务追加到末尾(order递增)', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    store.addTask({ title: 'C' })
    const tasks = store.getState().tasks
    expect(tasks[0].order).toBeLessThan(tasks[1].order)
    expect(tasks[1].order).toBeLessThan(tasks[2].order)
  })

  it('moveTask up 把任务和上一个交换 order', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    store.addTask({ title: 'C' })
    const [a, b, c] = store.getState().tasks
    // C 上移 → 和 B 交换
    store.moveTask(c.id, 'up')
    const sorted = [...store.getState().tasks].sort((x, y) => x.order - y.order)
    expect(sorted.map(t => t.title)).toEqual(['A', 'C', 'B'])
  })

  it('moveTask down 把任务和下一个交换 order', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    store.addTask({ title: 'C' })
    const [a] = store.getState().tasks
    // A 下移 → 和 B 交换
    store.moveTask(a.id, 'down')
    const sorted = [...store.getState().tasks].sort((x, y) => x.order - y.order)
    expect(sorted.map(t => t.title)).toEqual(['B', 'A', 'C'])
  })

  it('第一个任务 moveTask up 无效(已到顶)', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    const [a] = store.getState().tasks
    store.moveTask(a.id, 'up')
    const sorted = [...store.getState().tasks].sort((x, y) => x.order - y.order)
    expect(sorted.map(t => t.title)).toEqual(['A', 'B'])  // 不变
  })

  it('最后一个任务 moveTask down 无效(已到底)', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    const [, b] = store.getState().tasks
    store.moveTask(b.id, 'down')
    const sorted = [...store.getState().tasks].sort((x, y) => x.order - y.order)
    expect(sorted.map(t => t.title)).toEqual(['A', 'B'])  // 不变
  })

  // === v0.2.6 审核修复:迁移 + normalize + 相等order ===
  it('replaceState 迁移:无 order 的旧任务按 createdAt 补 0..n-1', () => {
    // 模拟真实场景:空 store + replaceState 加载旧数据(无 order 字段)
    const s = createMemoryStore()
    s.replaceState({
      settings: { workMinutes: 25 },
      tasks: [
        { id: 'old1', title: '旧A', createdAt: '2026-01-01T00:00:00Z', completed: false, completedAt: null },
        { id: 'old2', title: '旧B', createdAt: '2026-01-02T00:00:00Z', completed: false, completedAt: null },
      ],
      sessions: [],
    })
    expect(s.getState().tasks[0].order).toBe(0)  // 旧A(createdAt早)→0
    expect(s.getState().tasks[1].order).toBe(1)  // 旧B→1
  })

  it('moveTask 后 order 保持连续 0..n-1(无空洞)', () => {
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    store.addTask({ title: 'C' })
    const [a] = store.getState().tasks
    store.moveTask(a.id, 'down')  // A下移→B,A,C
    const orders = [...store.getState().tasks].sort((x, y) => x.order - y.order).map(t => t.order)
    expect(orders).toEqual([0, 1, 2])  // 连续无空洞
  })

  it('order 相等的任务 moveTask 仍能正常交换(normalize生效)', () => {
    // 构造两个 order 都是 0 的任务(模拟 bug 场景)
    const s = createMemoryStore({
      settings: { workMinutes: 25 },
      tasks: [
        { id: 'x', title: 'X', order: 0, createdAt: '2026-01-01', completed: false, completedAt: null },
        { id: 'y', title: 'Y', order: 0, createdAt: '2026-01-02', completed: false, completedAt: null },
      ],
      sessions: [],
    })
    s.moveTask('y', 'up')  // Y上移
    const sorted = [...s.getState().tasks].sort((a, b) => a.order - b.order)
    expect(sorted.map(t => t.title)).toEqual(['Y', 'X'])
    // 且 order 已 normalize 成 0,1
    expect(sorted[0].order).toBe(0)
    expect(sorted[1].order).toBe(1)
  })
})

// ========== v0.3.0: 目标/科目/任务归属 ==========
describe('goal & subject (v0.3.0)', () => {
  let store
  beforeEach(() => { store = createMemoryStore() })

  it('能创建目标(含截止日)', () => {
    store.addGoal({ name: '考研', deadline: '2026-08-31' })
    const g = store.getState().goals[0]
    expect(g.name).toBe('考研')
    expect(g.deadline).toBe('2026-08-31')
    expect(g.archived).toBe(false)
    expect(g.id).toBeTruthy()
  })

  it('能创建科目并归属目标', () => {
    const g = store.addGoal({ name: '考研' })
    store.addSubject({ goalId: g.id, name: '数学' })
    const s = store.getState().subjects[0]
    expect(s.goalId).toBe(g.id)
    expect(s.name).toBe('数学')
  })

  it('任务能归属科目,默认无归属', () => {
    store.addTask({ title: '高数' })
    expect(store.getState().tasks[0].subjectId).toBeNull()
  })

  it('setTaskSubject 能改任务归属', () => {
    store.addTask({ title: '高数' })
    const t = store.getState().tasks[0]
    store.setTaskSubject(t.id, 's1')
    expect(store.getState().tasks[0].subjectId).toBe('s1')
    store.setTaskSubject(t.id, null)
    expect(store.getState().tasks[0].subjectId).toBeNull()
  })

  it('删目标连带删科目,任务 subjectId 置 null', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addTask({ title: '高数', subjectId: s.id })
    store.deleteGoal(g.id)
    expect(store.getState().goals).toHaveLength(0)
    expect(store.getState().subjects).toHaveLength(0)
    expect(store.getState().tasks[0].subjectId).toBeNull()  // 任务保留,归属清空
  })

  it('删科目,任务 subjectId 置 null(不删任务)', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addTask({ title: '高数', subjectId: s.id })
    store.deleteSubject(s.id)
    expect(store.getState().subjects).toHaveLength(0)
    expect(store.getState().tasks).toHaveLength(1)  // 任务还在
    expect(store.getState().tasks[0].subjectId).toBeNull()
  })

  it('归档目标连带归档科目', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.archiveGoal(g.id)
    expect(store.getState().goals[0].archived).toBe(true)
    expect(store.getState().subjects[0].archived).toBe(true)
  })

  it('renameGoal / setGoalDeadline 能改目标和截止日', () => {
    const g = store.addGoal({ name: '考研', deadline: '2026-08-31' })
    store.renameGoal(g.id, '考研冲刺')
    store.setGoalDeadline(g.id, '2026-09-15')
    const updated = store.getState().goals[0]
    expect(updated.name).toBe('考研冲刺')
    expect(updated.deadline).toBe('2026-09-15')
  })

  // v0.3.1: 科目排序
  it('科目有 order,新科目追加末尾', () => {
    const g = store.addGoal({ name: '考研' })
    store.addSubject({ goalId: g.id, name: '数学' })
    store.addSubject({ goalId: g.id, name: '英语' })
    store.addSubject({ goalId: g.id, name: '专业课' })
    const subs = store.getState().subjects.filter(s => s.goalId === g.id).sort((a, b) => a.order - b.order)
    expect(subs.map(s => s.name)).toEqual(['数学', '英语', '专业课'])
  })

  it('moveSubject 在同目标内交换 + normalize', () => {
    const g = store.addGoal({ name: '考研' })
    store.addSubject({ goalId: g.id, name: '数学' })
    store.addSubject({ goalId: g.id, name: '英语' })
    store.addSubject({ goalId: g.id, name: '专业课' })
    const subs = store.getState().subjects.filter(s => s.goalId === g.id)
    const math = subs.find(s => s.name === '数学')
    store.moveSubject(math.id, 'down')  // 数学下移
    const sorted = store.getState().subjects.filter(s => s.goalId === g.id).sort((a, b) => a.order - b.order)
    expect(sorted.map(s => s.name)).toEqual(['英语', '数学', '专业课'])
    expect(sorted.map(s => s.order)).toEqual([0, 1, 2])  // normalize 连续
  })

  it('moveSubject 不跨目标(只在自己目标内排序)', () => {
    const g1 = store.addGoal({ name: '考研' })
    const g2 = store.addGoal({ name: '公考' })
    store.addSubject({ goalId: g1.id, name: '数学' })
    store.addSubject({ goalId: g2.id, name: '行测' })
    const math = store.getState().subjects.find(s => s.name === '数学')
    // 数学在考研(单独一个科目),down 无效
    store.moveSubject(math.id, 'down')
    const sorted = store.getState().subjects.filter(s => s.goalId === g1.id).sort((a, b) => a.order - b.order)
    expect(sorted.map(s => s.name)).toEqual(['数学'])  // 不变
  })

  // v0.3.2: 归档恢复
  it('unarchiveGoal 连带恢复其下科目', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.archiveGoal(g.id)
    expect(store.getState().goals[0].archived).toBe(true)
    expect(store.getState().subjects[0].archived).toBe(true)
    store.unarchiveGoal(g.id)
    expect(store.getState().goals[0].archived).toBe(false)
    expect(store.getState().subjects[0].archived).toBe(false)  // 科目连带恢复
  })

  it('unarchiveSubject 只恢复该科目', () => {
    const g = store.addGoal({ name: '考研' })
    const s1 = store.addSubject({ goalId: g.id, name: '数学' })
    const s2 = store.addSubject({ goalId: g.id, name: '英语' })
    store.archiveSubject(s1.id)
    store.archiveSubject(s2.id)
    store.unarchiveSubject(s1.id)
    const subs = store.getState().subjects
    expect(subs.find(s => s.id === s1.id).archived).toBe(false)
    expect(subs.find(s => s.id === s2.id).archived).toBe(true)  // 英语仍归档
  })

  it('归档科目后任务的 subjectId 保留,恢复后归属关系完整', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addTask({ title: '高数第三章', subjectId: s.id })
    store.archiveSubject(s.id)
    // 归档后任务 subjectId 仍在(只是UI隐藏)
    expect(store.getState().tasks[0].subjectId).toBe(s.id)
    store.unarchiveSubject(s.id)
    // 恢复后归属关系完整
    expect(store.getState().tasks[0].subjectId).toBe(s.id)
    expect(store.getState().subjects[0].archived).toBe(false)
  })
})

// ========== v0.3.0: 数据迁移 ==========
describe('migration (v0.3.0)', () => {
  it('replaceState 迁移:老数据补 goals/subjects/task.subjectId', () => {
    const s = createMemoryStore()
    // 模拟老数据:无 goals/subjects,task 无 subjectId
    s.replaceState({
      settings: { workMinutes: 25 },
      tasks: [{ id: 't1', title: '旧任务', order: 0, createdAt: '2026-01-01', completed: false, completedAt: null }],
      sessions: [],
    })
    const st = s.getState()
    expect(st.goals).toEqual([])        // 补了空数组
    expect(st.subjects).toEqual([])
    expect(st.tasks[0].subjectId).toBeNull()  // 补了 null
  })

  it('replaceState 不破坏已有的 goals/subjects', () => {
    const s = createMemoryStore()
    s.replaceState({
      goals: [{ id: 'g1', name: '考研', deadline: null, archived: false, createdAt: '2026-06-24' }],
      subjects: [{ id: 's1', goalId: 'g1', name: '数学', archived: false, createdAt: '2026-06-24' }],
      settings: { workMinutes: 25 },
      tasks: [{ id: 't1', title: '高数', order: 0, subjectId: 's1', createdAt: '2026-06-24', completed: false, completedAt: null }],
      sessions: [],
    })
    expect(s.getState().goals).toHaveLength(1)
    expect(s.getState().subjects).toHaveLength(1)
    expect(s.getState().tasks[0].subjectId).toBe('s1')  // 保留
  })
})

// ========== v0.3.3 重构: session 科目快照 + schemaVersion 迁移链 ==========
describe('session 科目快照 (P0-1)', () => {
  let store
  beforeEach(() => { store = createMemoryStore() })

  it('addSession 自动从 task 反查补科目快照', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addTask({ title: '高数', subjectId: s.id })
    const t = store.getState().tasks[0]
    store.addSession({ taskId: t.id, type: '专注', durationSec: 1500, status: '完成' })
    const sess = store.getState().sessions[0]
    expect(sess.subjectId).toBe(s.id)
    expect(sess.subjectName).toBe('数学')
    expect(sess.goalName).toBe('考研')
  })

  it('自由任务(无科目)的 session 快照为 null', () => {
    store.addTask({ title: '写报告' })
    const t = store.getState().tasks[0]
    store.addSession({ taskId: t.id, type: '专注', durationSec: 1500, status: '完成' })
    const sess = store.getState().sessions[0]
    expect(sess.subjectId).toBeNull()
    expect(sess.subjectName).toBeNull()
    expect(sess.goalName).toBeNull()
  })

  it('addSession 存 taskName 快照(任务名)', () => {
    store.addTask({ title: '高数第三章' })
    const t = store.getState().tasks[0]
    store.addSession({ taskId: t.id, type: '专注', durationSec: 1500, status: '完成' })
    expect(store.getState().sessions[0].taskName).toBe('高数第三章')
  })

  it('taskName 快照是当时的名字:任务改名后历史保留旧名', () => {
    store.addTask({ title: '高数' })
    const t = store.getState().tasks[0]
    store.addSession({ taskId: t.id, type: '专注', durationSec: 1500, status: '完成' })
    // 改任务名(模拟删除重建)
    store.deleteTask(t.id)
    store.addTask({ title: '高数(新)' })
    // 老 session 的 taskName 仍是"高数"
    expect(store.getState().sessions[0].taskName).toBe('高数')
  })

  it('快照是当时的名字:科目改名后,历史 session 保留旧名', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addTask({ title: '高数', subjectId: s.id })
    const t = store.getState().tasks[0]
    store.addSession({ taskId: t.id, type: '专注', durationSec: 1500, status: '完成' })
    store.renameSubject(s.id, '高等数学')   // 改名
    const sess = store.getState().sessions[0]
    expect(sess.subjectName).toBe('数学')   // 历史保留旧名"数学"
  })
})

describe('schemaVersion 迁移链 (P0-3)', () => {
  it('migrateState 把 v0 老数据迁到当前版本', () => {
    // v0 老数据:无 schemaVersion,task 无 order/subjectId,无 goals/subjects
    const old = {
      settings: { workMinutes: 25 },
      tasks: [{ id: 't1', title: '旧', createdAt: '2026-01-01', completed: false, completedAt: null }],
      sessions: [],
    }
    const st = migrateState(old)
    expect(st.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(st.tasks[0].order).not.toBeUndefined()
    expect(st.tasks[0].subjectId).toBeNull()
    expect(st.goals).toEqual([])
    expect(st.subjects).toEqual([])
  })

  it('migrateState 回填老 session 的科目快照', () => {
    // 模拟 v3 数据:session 无快照字段,但有 task→subject 链路可反查
    const v3 = {
      schemaVersion: 3,
      goals: [{ id: 'g1', name: '考研', deadline: null, archived: false, createdAt: '2026-06-01' }],
      subjects: [{ id: 's1', goalId: 'g1', name: '数学', order: 0, archived: false, createdAt: '2026-06-01' }],
      tasks: [{ id: 't1', title: '高数', order: 0, subjectId: 's1', createdAt: '2026-06-01', completed: false, completedAt: null }],
      sessions: [{ id: 'x1', taskId: 't1', type: '专注', durationSec: 1500, status: '完成', startedAt: '2026-06-02', endedAt: '2026-06-02' }],
      settings: { workMinutes: 25 },
    }
    const st = migrateState(v3)
    expect(st.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(st.sessions[0].subjectId).toBe('s1')
    expect(st.sessions[0].subjectName).toBe('数学')
    expect(st.sessions[0].goalName).toBe('考研')
  })

  it('已有快照的 session 不被重复迁移', () => {
    const current = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      goals: [], subjects: [],
      tasks: [], sessions: [{ id: 'x1', taskId: null, subjectName: '历史名', type: '专注', durationSec: 60, status: '完成', startedAt: '', endedAt: '' }],
      settings: { workMinutes: 25 },
    }
    const st = migrateState(current)
    expect(st.sessions[0].subjectName).toBe('历史名')  // 保留,不覆盖
  })

  it('已是当前版本的数据直接通过,不重复迁移', () => {
    const current = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      goals: [], subjects: [], tasks: [{ id: 't', title: 'x', order: 0, subjectId: null, createdAt: '', completed: false, completedAt: null }],
      sessions: [], settings: { workMinutes: 25 },
    }
    const st = migrateState(current)
    expect(st.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // 不应破坏数据
    expect(st.tasks[0].title).toBe('x')
  })

  it('migrateState v4→v5 回填老 session 的 taskName', () => {
    // v4 数据:session 无 taskName,但有 task 可反查
    const v4 = {
      schemaVersion: 4,
      goals: [], subjects: [],
      tasks: [{ id: 't1', title: '高数第三章', order: 0, subjectId: null, createdAt: '', completed: false, completedAt: null }],
      sessions: [{ id: 'x1', taskId: 't1', type: '专注', durationSec: 1500, status: '完成', subjectId: null, subjectName: null, goalName: null, startedAt: '', endedAt: '' }],
      settings: { workMinutes: 25 },
    }
    const st = migrateState(v4)
    expect(st.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(st.sessions[0].taskName).toBe('高数第三章')   // 从 task 回填
  })

  it('v4→v5: task 已删除的 session, taskName 无法回填(留null)', () => {
    // 真实场景:你截图里删了的任务,taskName 找不回来
    const v4 = {
      schemaVersion: 4,
      goals: [], subjects: [], tasks: [],   // task 已删
      sessions: [{ id: 'x1', taskId: 'gone', type: '专注', durationSec: 1500, status: '完成', subjectId: null, subjectName: null, goalName: null, startedAt: '', endedAt: '' }],
      settings: { workMinutes: 25 },
    }
    const st = migrateState(v4)
    expect(st.sessions[0].taskName).toBeNull()   // 找不到 task,留 null
  })
})

// ========== v0.3.6: 计划(Plan) CRUD + 迁移v6 ==========
describe('plan (v0.3.6)', () => {
  let store
  beforeEach(() => { store = createMemoryStore() })

  it('能创建计划并归属科目', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    const p = store.addPlan({ subjectId: s.id, name: '第1轮', totalHours: 50, deadline: '2026-08-31' })
    expect(p.subjectId).toBe(s.id)
    expect(p.totalHours).toBe(50)
    expect(p.status).toBe('进行中')
    expect(p.manualDaily).toEqual({})
  })

  it('updatePlan 改字段', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    const p = store.addPlan({ subjectId: s.id, totalHours: 50 })
    store.updatePlan(p.id, { totalHours: 60, deadline: '2026-09-01' })
    const updated = store.getState().plans[0]
    expect(updated.totalHours).toBe(60)
    expect(updated.deadline).toBe('2026-09-01')
  })

  it('setPlanManualDaily 设置/清除手动当天时长', () => {
    const s = store.addSubject({ goalId: store.addGoal({ name: 'g' }).id, name: '数学' })
    const p = store.addPlan({ subjectId: s.id, totalHours: 50 })
    store.setPlanManualDaily(p.id, '2026-07-15', 3)
    expect(store.getState().plans[0].manualDaily['2026-07-15']).toBe(3)
    store.setPlanManualDaily(p.id, '2026-07-15', null)  // 清除
    expect(store.getState().plans[0].manualDaily['2026-07-15']).toBeUndefined()
  })

  it('删科目连带删其下计划', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addPlan({ subjectId: s.id, totalHours: 50 })
    store.deleteSubject(s.id)
    expect(store.getState().plans).toHaveLength(0)  // 计划被删
  })

  it('删目标连带删其下计划(级联)', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addPlan({ subjectId: s.id, totalHours: 50 })
    store.deleteGoal(g.id)
    expect(store.getState().plans).toHaveLength(0)  // 计划被删
  })

  it('归档科目连带归档其下计划', () => {
    const g = store.addGoal({ name: '考研' })
    const s = store.addSubject({ goalId: g.id, name: '数学' })
    store.addPlan({ subjectId: s.id, totalHours: 50 })
    store.archiveSubject(s.id)
    expect(store.getState().plans[0].archived).toBe(true)
  })

  it('setPlanStatus 改状态', () => {
    const s = store.addSubject({ goalId: store.addGoal({ name: 'g' }).id, name: '数学' })
    const p = store.addPlan({ subjectId: s.id, totalHours: 50 })
    store.setPlanStatus(p.id, '已完成')
    expect(store.getState().plans[0].status).toBe('已完成')
  })
})

describe('plan 迁移v6', () => {
  it('migrateState v5→v8 补 plans/activeFocus/settings.dailyGoalMinutes', () => {
    const v5 = {
      schemaVersion: 5,
      goals: [], subjects: [], tasks: [], sessions: [],
      settings: { workMinutes: 25 },
    }
    const st = migrateState(v5)
    expect(st.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(st.plans).toEqual([])   // v6:补了空数组
    expect(st.activeFocus).toBeNull()   // v7:补了 null
    expect(st.settings.dailyGoalMinutes).toBe(30)   // v8:补了默认门槛
    expect(st.activeTaskId).toBeNull()   // v9:补了 null(当前选中任务)
  })

  it('migrateState v7→v8:已有 dailyGoalMinutes 不被覆盖', () => {
    const v7 = {
      schemaVersion: 7,
      goals: [], subjects: [], tasks: [], sessions: [], plans: [], activeFocus: null,
      settings: { workMinutes: 25, dailyGoalMinutes: 60 },   // 用户已设60分钟
    }
    const st = migrateState(v7)
    expect(st.settings.dailyGoalMinutes).toBe(60)   // 保留用户值,不被默认30覆盖
  })
})

describe('任务选中持久化 v0.3.12', () => {
  it('setActiveTaskId/clearActiveTaskId 读写', () => {
    const store = createMemoryStore()
    expect(store.getState().activeTaskId).toBeNull()
    store.setActiveTaskId('t1')
    expect(store.getState().activeTaskId).toBe('t1')
    store.clearActiveTaskId()
    expect(store.getState().activeTaskId).toBeNull()
  })

  it('setActiveTaskId(null)=取消选中', () => {
    const store = createMemoryStore()
    store.setActiveTaskId('t1')
    store.setActiveTaskId(null)
    expect(store.getState().activeTaskId).toBeNull()
  })

  it('clearActiveTaskId 幂等(已是null不重复emit)', () => {
    const store = createMemoryStore()
    let count = 0
    store.subscribe(() => count++)
    store.clearActiveTaskId()
    store.clearActiveTaskId()
    expect(count).toBe(0)
  })

  it('deleteTask 级联:删的是当前选中任务→清空activeTaskId', () => {
    const store = createMemoryStore()
    const task = store.addTask({ title: '背单词' })
    store.setActiveTaskId(task.id)
    expect(store.getState().activeTaskId).toBe(task.id)
    store.deleteTask(task.id)
    expect(store.getState().activeTaskId).toBeNull()   // 悬空引用已清
  })

  it('deleteTask 级联:删的不是当前任务→activeTaskId保持', () => {
    const store = createMemoryStore()
    const t1 = store.addTask({ title: '任务1' })
    const t2 = store.addTask({ title: '任务2' })
    store.setActiveTaskId(t1.id)
    store.deleteTask(t2.id)   // 删的是t2,不影响选中的t1
    expect(store.getState().activeTaskId).toBe(t1.id)
  })
})

describe('异常退出恢复 v0.3.7', () => {
  it('evaluateRecovery:无快照→丢弃', () => {
    expect(evaluateRecovery(null).action).toBe('discard')
  })

  it('evaluateRecovery:专注≥30秒→记录', () => {
    const now = Date.now()
    const af = { taskId: 't1', startedAtTs: now - 40 * 1000, totalSec: 25 * 60 }
    const r = evaluateRecovery(af, now)
    expect(r.action).toBe('record')
    expect(r.durationSec).toBe(40)
  })

  it('evaluateRecovery:专注<30秒→丢弃(防垃圾记录)', () => {
    const now = Date.now()
    const af = { taskId: 't1', startedAtTs: now - 10 * 1000, totalSec: 25 * 60 }
    expect(evaluateRecovery(af, now).action).toBe('discard')
  })

  it('evaluateRecovery:时长限幅不超过totalSec', () => {
    const now = Date.now()
    // 设定专注25分钟(1500秒),但实际过了1小时,应限幅到1500
    const af = { taskId: 't1', startedAtTs: now - 3600 * 1000, totalSec: 1500 }
    const r = evaluateRecovery(af, now)
    expect(r.action).toBe('record')
    expect(r.durationSec).toBe(1500)
  })

  it('evaluateRecovery:开始时刻超过7天→丢弃(脏数据)', () => {
    const now = Date.now()
    const af = { taskId: 't1', startedAtTs: now - 8 * 86400000, totalSec: 1500 }
    expect(evaluateRecovery(af, now).action).toBe('discard')
  })

  it('evaluateRecovery:totalSec 非法(NaN/负数/undefined)→丢弃(防污染)', () => {
    const now = Date.now()
    expect(evaluateRecovery({ taskId: 't1', startedAtTs: now - 100000, totalSec: NaN }, now).action).toBe('discard')
    expect(evaluateRecovery({ taskId: 't1', startedAtTs: now - 100000, totalSec: -1 }, now).action).toBe('discard')
    expect(evaluateRecovery({ taskId: 't1', startedAtTs: now - 100000, totalSec: undefined }, now).action).toBe('discard')
  })

  it('evaluateRecovery:系统时钟回拨(now早于startedAtTs,负时长)→丢弃', () => {
    const now = Date.now()
    const af = { taskId: 't1', startedAtTs: now + 100000, totalSec: 1500 }   // 开始时刻在未来
    expect(evaluateRecovery(af, now).action).toBe('discard')
  })

  it('evaluateRecovery:resume 重写 startedAtTs 语义(只算最后一段running)', () => {
    // 模拟:start(T0)→专注10分钟→pause→resume(T1,重写)→专注5分钟→闪退
    // 恢复时应按 now-T1 算(5分钟),而非 now-T0(15分钟,含暂停段)。这是 App 层 resume 重写的语义验证。
    const T0 = Date.now() - 15 * 60 * 1000   // 15分钟前开始
    const T1 = Date.now() - 5 * 60 * 1000    // resume 在5分钟前
    const now = Date.now()
    // resume 后快照是 T1(被重写)
    const af = { taskId: 't1', startedAtTs: T1, totalSec: 25 * 60 }
    const r = evaluateRecovery(af, now)
    expect(r.action).toBe('record')
    expect(r.durationSec).toBeGreaterThanOrEqual(290)   // 约5分钟(300s),容差
    expect(r.durationSec).toBeLessThanOrEqual(301)
  })

  it('setActiveFocus/clearActiveFocus 读写', () => {
    const store = createMemoryStore()
    expect(store.getState().activeFocus).toBeNull()
    const now = Date.now()
    store.setActiveFocus({ taskId: 't1', startedAtTs: now, totalSec: 1500 })
    expect(store.getState().activeFocus).toEqual({ taskId: 't1', startedAtTs: now, totalSec: 1500 })
    store.clearActiveFocus()
    expect(store.getState().activeFocus).toBeNull()
  })

  it('clearActiveFocus:已是null不重复emit(幂等)', () => {
    const store = createMemoryStore()
    let count = 0
    store.subscribe(() => count++)
    store.clearActiveFocus()   // 本来就是null
    store.clearActiveFocus()   // 还是null
    expect(count).toBe(0)
  })

  it('recoverActiveFocus:满足条件→记一条异常中断并清空快照', () => {
    const store = createMemoryStore()
    const now = Date.now()
    const task = store.addTask({ title: '背单词' })
    // 模拟:40秒前开始专注,然后闪退
    store.setActiveFocus({ taskId: task.id, startedAtTs: now - 40 * 1000, totalSec: 1500 })
    const result = store.recoverActiveFocus(now)
    expect(result.recorded).toBe(true)
    expect(result.durationSec).toBe(40)
    // 记了一条 session
    const sessions = store.getState().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].status).toBe('异常中断')
    expect(sessions[0].durationSec).toBe(40)
    expect(sessions[0].taskId).toBe(task.id)
    expect(sessions[0].taskName).toBe('背单词')   // 快照正常
    // 快照已清空
    expect(store.getState().activeFocus).toBeNull()
  })

  it('recoverActiveFocus:太短→丢弃且清空快照', () => {
    const store = createMemoryStore()
    const now = Date.now()
    store.setActiveFocus({ taskId: null, startedAtTs: now - 10 * 1000, totalSec: 1500 })
    const result = store.recoverActiveFocus(now)
    expect(result.recorded).toBe(false)
    expect(store.getState().sessions).toHaveLength(0)   // 没记
    expect(store.getState().activeFocus).toBeNull()     // 但清空了
  })

  it('recoverActiveFocus:无快照→返回null', () => {
    const store = createMemoryStore()
    expect(store.recoverActiveFocus()).toBeNull()
  })

  it('v0.4.2 集成回归:归档目标后,其名下进行中计划不进今日计划', () => {
    // 2026-09-19 森哥实报bug:归档目标→科目级联归档但计划未动→今日计划仍显示。
    // 本用例锁住 store 级联与展示过滤之间的链路(纯函数单测覆盖不到这层)。
    const store = createMemoryStore()
    store.addGoal({ name: '中级会计', deadline: '2026-12-20' })
    const goalId = store.getState().goals[0].id
    store.addSubject({ goalId, name: '实务' })
    const subjectId = store.getState().subjects[0].id
    store.addPlan({ subjectId, name: '第2轮', totalHours: 40, deadline: '2026-12-20' })
    const s1 = store.getState()
    expect(todayPlanSummary(s1.sessions, s1.plans, s1.subjects)).toHaveLength(1)   // 归档前:在
    store.archiveGoal(goalId)
    const s2 = store.getState()
    expect(todayPlanSummary(s2.sessions, s2.plans, s2.subjects)).toHaveLength(0)   // 归档后:排除
  })
})

describe('恢复目标时修复幽灵计划', () => {
  function setup() {
    const store = createMemoryStore()
    const goal = store.addGoal({ name: '目标' })
    const subject = store.addSubject({ goalId: goal.id, name: '科目' })
    const plan = store.addPlan({ subjectId: subject.id, name: '计划', totalHours: 4, deadline: '2026-09-30' })
    return { store, goal, subject, plan }
  }

  it('归档科目→归档目标→恢复目标后，计划在目标页和今日计划可见', () => {
    const { store, goal, subject, plan } = setup()
    store.archiveSubject(subject.id)
    expect(store.getState().plans[0].archived).toBe(true)
    store.archiveGoal(goal.id)
    store.unarchiveGoal(goal.id)
    const state = store.getState()
    expect(state.subjects[0].archived).toBe(false)
    expect(state.plans.filter(p => !p.archived).map(p => p.id)).toContain(plan.id)
    expect(todayPlanSummary(state.sessions, state.plans, state.subjects, new Date(2026, 8, 24))).toHaveLength(1)
  })

  it('单独归档的计划也随目标恢复', () => {
    const { store, goal, plan } = setup()
    store.archivePlan(plan.id)
    store.archiveGoal(goal.id)
    store.unarchiveGoal(goal.id)
    expect(store.getState().plans[0].archived).toBe(false)
  })

  it('只恢复当前目标名下计划', () => {
    const { store, goal } = setup()
    const otherGoal = store.addGoal({ name: '其他' })
    const otherSubject = store.addSubject({ goalId: otherGoal.id, name: '别科' })
    const otherPlan = store.addPlan({ subjectId: otherSubject.id, totalHours: 2 })
    store.archivePlan(otherPlan.id)
    store.archiveGoal(goal.id)
    store.unarchiveGoal(goal.id)
    expect(store.getState().plans.find(p => p.id === otherPlan.id).archived).toBe(true)
  })

  it('已完成计划只恢复归档标记，其他字段不变', () => {
    const { store, goal, plan } = setup()
    store.setPlanStatus(plan.id, '已完成')
    store.setPlanManualDaily(plan.id, '2026-09-24', 2)
    store.archivePlan(plan.id)
    const before = store.getState().plans[0]
    store.archiveGoal(goal.id)
    store.unarchiveGoal(goal.id)
    expect(store.getState().plans[0]).toEqual({ ...before, archived: false })
  })

  it('重复恢复、空计划和不存在目标不会改动无关数据', () => {
    const { store, goal } = setup()
    store.archiveGoal(goal.id)
    store.unarchiveGoal(goal.id)
    const once = store.getState()
    store.unarchiveGoal(goal.id)
    store.unarchiveGoal('missing')
    expect(store.getState()).toEqual(once)
    store.deletePlan(once.plans[0].id)
    store.unarchiveGoal(goal.id)
    expect(store.getState().plans).toEqual([])
  })
})

describe('persistent store: 读取失败保护(v0.5.0 复审 B1 回归)', () => {
  it('loadState 失败时:本会话禁用自动落盘(防旧档被空状态覆盖),UI 仍解锁', async () => {
    vi.stubGlobal('window', {
      pomodoroAPI: {
        loadState: () => Promise.reject(new Error('EISDIR/EBUSY')),
        saveState: () => { throw new Error('saveState must not be called') },
      },
    })
    const { createPersistentStore } = await import('../src/data/store.js')
    const store = createPersistentStore()
    store.addTask({ title: 'x' })   // 触发一次 emit(若落盘未停用会调 saveState 直接抛错)
    await new Promise(r => setTimeout(r, 10))
    expect(store.isLoaded()).toBe(true)        // UI 解锁
    expect(store.isLoadFailed()).toBe(true)    // 但标记读取失败
    vi.unstubAllGlobals()
  })

  it('loadState 失败后 emit 多次仍零落盘;正常加载时照常落盘', async () => {
    const saved = []
    vi.stubGlobal('window', {
      pomodoroAPI: {
        loadState: () => Promise.reject(new Error('io')),
        saveState: s => { saved.push(s); return Promise.resolve(true) },
      },
    })
    const { createPersistentStore } = await import('../src/data/store.js')
    const store = createPersistentStore()
    store.addTask({ title: 'a' })
    store.addTask({ title: 'b' })
    await new Promise(r => setTimeout(r, 10))
    expect(saved).toHaveLength(0)
    vi.unstubAllGlobals()
  })
})
