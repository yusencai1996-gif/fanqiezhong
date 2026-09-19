// 分组与可见性:纯函数集中地(P0-2 + P1-5 收口)。
// 把"哪些任务可见、怎么分组、标签聚合"的逻辑从组件层抽到这里,带测试,杜绝散落。

// 活跃(未归档)科目
export function selectActiveSubjects(subjects) {
  return subjects.filter(s => !s.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

// 活跃科目的 id 集合
export function selectActiveSubjectIds(subjects) {
  return new Set(selectActiveSubjects(subjects).map(s => s.id))
}

// 可见任务:剔除"归属已归档科目"的任务(保留自由任务 + 活跃科目任务)
// 统一可见性口径,TaskList/TaskItem 都用它,杜绝各算一遍导致不一致
export function selectVisibleTasks(tasks, subjects) {
  const activeSubjectIds = selectActiveSubjectIds(subjects)
  return tasks.filter(t => !t.subjectId || activeSubjectIds.has(t.subjectId))
}

// 收集任务用过的标签(按字母序)
export function collectTags(tasks) {
  const set = new Set()
  for (const t of tasks) for (const tag of (t.tags || [])) set.add(tag)
  return [...set].sort()
}

// 按 subjectId 分组:每个活跃科目一个组 + 一个"自由任务"组(null)。
// 归档科目的任务已在外层 selectVisibleTasks 剔除,这里不再处理。
// 组内按 order 排序;空科目组保留(显示科目存在),空自由任务组隐藏。
// 返回 [{key, name, type:'subject'|'free', subjectId, tasks:[]}]
export function groupTasks(tasks, subjects) {
  const activeSubjects = selectActiveSubjects(subjects)
  const groups = activeSubjects.map(s => ({
    key: s.id, name: s.name, type: 'subject', subjectId: s.id, tasks: [],
  }))
  const freeGroup = { key: '__free__', name: '自由任务', type: 'free', subjectId: null, tasks: [] }
  groups.push(freeGroup)
  for (const t of tasks) {
    const g = t.subjectId ? groups.find(g => g.subjectId === t.subjectId) : null
    ;(g || freeGroup).tasks.push(t)
  }
  groups.forEach(g => g.tasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
  return groups.filter(g => g.type === 'subject' || g.tasks.length > 0)
}
