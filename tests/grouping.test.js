import { describe, it, expect } from 'vitest'
import { collectTags, groupTasks, selectVisibleTasks, selectActiveSubjects, selectActiveSubjectIds } from '../src/features/grouping.js'

const t = (id, subjectId, order = 0, tags = []) => ({ id, title: id, subjectId, order, tags, completed: false, completedAt: null })

describe('grouping: selectActiveSubjects', () => {
  it('只返回未归档科目,按 order 排序', () => {
    const subjects = [
      { id: 's1', name: '数学', order: 1, archived: false },
      { id: 's2', name: '英语', order: 0, archived: false },
      { id: 's3', name: '旧', order: 0, archived: true },
    ]
    const active = selectActiveSubjects(subjects)
    expect(active.map(s => s.name)).toEqual(['英语', '数学'])  // order 升序,旧被过滤
  })
})

describe('grouping: selectVisibleTasks', () => {
  it('剔除归属已归档科目的任务,保留自由任务和活跃科目任务', () => {
    const tasks = [
      t('t1', null),        // 自由任务 → 可见
      t('t2', 's1'),        // 活跃科目 → 可见
      t('t3', 's2'),        // 归档科目 → 隐藏
    ]
    const subjects = [
      { id: 's1', name: '数学', order: 0, archived: false },
      { id: 's2', name: '旧', order: 0, archived: true },
    ]
    const visible = selectVisibleTasks(tasks, subjects)
    expect(visible.map(x => x.id)).toEqual(['t1', 't2'])
  })
})

describe('grouping: groupTasks', () => {
  const subjects = [
    { id: 's1', name: '数学', order: 0, archived: false },
    { id: 's2', name: '英语', order: 1, archived: false },
  ]

  it('按科目分组,每组内有任务', () => {
    // 注意:groupTasks 不再做归档隐藏,调用方应先 selectVisibleTasks
    const tasks = [t('t1', 's1', 1), t('t2', 's1', 0), t('t3', 's2', 0), t('t4', null)]
    const groups = groupTasks(tasks, subjects)
    const math = groups.find(g => g.subjectId === 's1')
    expect(math.tasks.map(x => x.id)).toEqual(['t2', 't1'])  // 组内 order 升序
    const free = groups.find(g => g.type === 'free')
    expect(free.tasks.map(x => x.id)).toEqual(['t4'])
  })

  it('空科目组保留(显示科目存在),空自由组隐藏', () => {
    const tasks = [t('t1', 's1', 0)]  // 只有数学有任务,英语空,自由组空
    const groups = groupTasks(tasks, subjects)
    const names = groups.map(g => g.name)
    expect(names).toContain('数学')
    expect(names).toContain('英语')   // 空科目组保留
    expect(names).not.toContain('自由任务')  // 空自由组隐藏
  })

  it('组内按 order 排序', () => {
    const tasks = [t('t3', 's1', 2), t('t1', 's1', 0), t('t2', 's1', 1)]
    const groups = groupTasks(tasks, subjects)
    const math = groups.find(g => g.subjectId === 's1')
    expect(math.tasks.map(x => x.id)).toEqual(['t1', 't2', 't3'])
  })
})

describe('grouping: collectTags', () => {
  it('收集所有任务的标签,去重排序', () => {
    const tasks = [t('t1', null, 0, ['高数', '重点']), t('t2', null, 0, ['高数', '线代'])]
    expect(collectTags(tasks)).toEqual(['重点', '线代', '高数'].sort())
  })
})
