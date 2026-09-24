// 内存版 store(逻辑核心,可单测)。
// 持久化层(写 JSON 文件)在 Electron 主进程,渲染层通过 preload API 读写。
// 这里只管状态逻辑,持久化在外层包一层。

// P0-3:数据 schema 版本 + 迁移链。每加一次结构演进,版本号+1,加一个迁移函数。
// 迁移从 state.schemaVersion(默认0=老数据)依次跑到 CURRENT_SCHEMA_VERSION。
// 注意:产品版本 v0.3.x 与 schema 版本是两套编号(如产品 v0.3.7 = schema v7)。
export const CURRENT_SCHEMA_VERSION = 10

// 各版本迁移函数:输入 state,返回迁移后的 state(就地补字段)。
// v0→v1: task 补 order(按 createdAt)
// v1→v2: task 补 subjectId(null); goals/subjects 补空数组
// v2→v3: subject 补 order(同目标内按 createdAt)
// v3→v4: session 补科目快照(subjectId/subjectName/goalName,从 task 反查回填)
// v4→v5: session 补 taskName 快照(从 task 反查,解决删除任务后排行榜显示"已删除")
// v5→v6: plans 补空数组(新实体:计划/轮次)
// v6→v7: activeFocus 补 null(进行中专注快照,供异常退出恢复用)
// v7→v8: settings 补 dailyGoalMinutes(打卡表每日门槛,默认30分钟)
// v8→v9: activeTaskId 补 null(当前选中任务,持久化防重启丢失)
// v9→v10: settings 补 AI 配置;密钥由主进程私有网关保护
const migrations = [
  // v0 → v1
  (s) => {
    let tasks = Array.isArray(s.tasks) ? s.tasks : []
    if (tasks.some(t => t.order === undefined || t.order === null)) {
      const sorted = [...tasks].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      const orderMap = new Map(sorted.map((t, i) => [t.id, i]))
      tasks = tasks.map(t => ({ ...t, order: orderMap.has(t.id) ? orderMap.get(t.id) : 0 }))
    }
    return { ...s, tasks }
  },
  // v1 → v2
  (s) => {
    const tasks = (Array.isArray(s.tasks) ? s.tasks : []).map(t => t.subjectId === undefined ? { ...t, subjectId: null } : t)
    return { ...s, tasks, goals: Array.isArray(s.goals) ? s.goals : [], subjects: Array.isArray(s.subjects) ? s.subjects : [] }
  },
  // v2 → v3
  (s) => {
    let subjects = Array.isArray(s.subjects) ? s.subjects : []
    if (subjects.some(sub => sub.order === undefined || sub.order === null)) {
      const byGoal = new Map()
      for (const gid of [...new Set(subjects.map(sub => sub.goalId))]) {
        const arr = subjects.filter(sub => sub.goalId === gid).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        byGoal.set(gid, new Map(arr.map((sub, i) => [sub.id, i])))
      }
      subjects = subjects.map(sub => ({ ...sub, order: byGoal.get(sub.goalId)?.get(sub.id) ?? 0 }))
    }
    return { ...s, subjects }
  },
  // v3 → v4
  (s) => {
    const tasks = Array.isArray(s.tasks) ? s.tasks : []
    const subjects = Array.isArray(s.subjects) ? s.subjects : []
    const goals = Array.isArray(s.goals) ? s.goals : []
    let sessions = Array.isArray(s.sessions) ? s.sessions : []
    sessions = sessions.map(sess => {
      if (sess.subjectId !== undefined) return sess   // 已有快照
      let subjectId = null, subjectName = null, goalName = null
      if (sess.taskId) {
        const task = tasks.find(t => t.id === sess.taskId)
        if (task && task.subjectId) {
          const subj = subjects.find(sub => sub.id === task.subjectId)
          if (subj) {
            subjectId = subj.id
            subjectName = subj.name
            const goal = goals.find(g => g.id === subj.goalId)
            if (goal) goalName = goal.name
          }
        }
      }
      return { ...sess, subjectId, subjectName, goalName }
    })
    return { ...s, sessions }
  },
  // v4 → v5: session 补 taskName 快照(从 task 反查)。注意:已删除的 task 无法回填,taskName 留 null。
  (s) => {
    const tasks = Array.isArray(s.tasks) ? s.tasks : []
    let sessions = Array.isArray(s.sessions) ? s.sessions : []
    sessions = sessions.map(sess => {
      if (sess.taskName !== undefined) return sess   // 已有快照
      let taskName = null
      if (sess.taskId) {
        const task = tasks.find(t => t.id === sess.taskId)
        if (task) taskName = task.title
      }
      return { ...sess, taskName }
    })
    return { ...s, sessions }
  },
  // v5 → v6: plans 补空数组(新实体:计划/轮次)
  (s) => ({ ...s, plans: Array.isArray(s.plans) ? s.plans : [] }),
  // v6 → v7: activeFocus 补 null(进行中专注快照,供异常退出恢复)。null=无进行中专注。
  (s) => ({ ...s, activeFocus: s.activeFocus ?? null }),
  // v7 → v8: settings 补 dailyGoalMinutes(打卡表每日门槛,默认30分钟)
  (s) => ({
    ...s,
    settings: {
      ...s.settings,
      dailyGoalMinutes: (s.settings && s.settings.dailyGoalMinutes != null)
        ? s.settings.dailyGoalMinutes : 30,
    },
  }),
  // v8 → v9: activeTaskId 补 null(当前选中任务,持久化防重启丢失)
  (s) => ({ ...s, activeTaskId: s.activeTaskId ?? null }),
  // v9 → v10
  (s) => {
    const settings = s.settings && typeof s.settings === 'object' && !Array.isArray(s.settings) ? s.settings : {}
    const aiConfig = settings.aiConfig && typeof settings.aiConfig === 'object' && !Array.isArray(settings.aiConfig) ? settings.aiConfig : {}
    return {
      ...s,
      settings: {
        ...settings,
        aiConfig: {
          ...aiConfig,
          apiKey: typeof aiConfig.apiKey === 'string' ? aiConfig.apiKey : '',
          model: ['deepseek-chat', 'deepseek-reasoner'].includes(aiConfig.model) ? aiConfig.model : 'deepseek-chat',
        },
      },
    }
  },
]

// 应用所有未跑的迁移,返回迁移后的 state + 更新 schemaVersion
export function migrateState(input) {
  let st = input || {}
  let v = st.schemaVersion || 0
  while (v < CURRENT_SCHEMA_VERSION) {
    st = migrations[v](st)
    v += 1
  }
  const settings = st.settings && typeof st.settings === 'object' && !Array.isArray(st.settings) ? st.settings : {}
  const aiConfig = settings.aiConfig && typeof settings.aiConfig === 'object' && !Array.isArray(settings.aiConfig) ? settings.aiConfig : {}
  return {
    ...st,
    settings: { ...settings, aiConfig: { ...aiConfig, apiKey: typeof aiConfig.apiKey === 'string' ? aiConfig.apiKey : '', model: ['deepseek-chat', 'deepseek-reasoner'].includes(aiConfig.model) ? aiConfig.model : 'deepseek-chat' } },
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }
}

// v0.3.7 异常退出恢复:核心判定(纯函数,便于单测)。
// 输入 activeFocus(进行中快照)+ now(时间戳),返回恢复决策。
//   恢复条件:① 快照存在;② 专注时长≥最低阈值(默认30s,防"点一下就关"垃圾记录);
//             ③ 时长≤totalSec(限幅,防超过设定时长);④ 开始时刻不超过7天(防脏数据)。
//   返回 { action: 'record'|'discard', durationSec?, startedAt?, reason }
//   'record' = 应记一条"异常中断"; 'discard' = 丢弃(太短/异常)。
export const RECOVER_MIN_SEC = 30
export const RECOVER_MAX_AGE_DAYS = 7
export function evaluateRecovery(activeFocus, now = Date.now()) {
  if (!activeFocus) return { action: 'discard', reason: '无进行中快照' }
  const { startedAtTs, totalSec } = activeFocus
  // totalSec 非法值(脏数据/旧文件损坏)→ 丢弃,防 Math.min(NaN,x)=NaN 污染 sessions
  if (!Number.isFinite(totalSec) || totalSec <= 0) {
    return { action: 'discard', reason: 'totalSec 非法' }
  }
  // 限幅时长 = min(totalSec, now - startedAtTs),按秒取整
  const rawSec = Math.floor((now - startedAtTs) / 1000)
  const elapsedSec = Math.min(totalSec, Math.max(0, rawSec))
  // 太短:丢弃(不算有效专注)
  if (elapsedSec < RECOVER_MIN_SEC) {
    return { action: 'discard', reason: `专注时长不足${RECOVER_MIN_SEC}秒` }
  }
  // 跨天异常(开始时刻太久远):丢弃,防脏数据
  const ageDays = (now - startedAtTs) / 86400000
  if (ageDays > RECOVER_MAX_AGE_DAYS) {
    return { action: 'discard', reason: '快照超过7天,疑似脏数据' }
  }
  return {
    action: 'record',
    durationSec: elapsedSec,
    startedAt: new Date(startedAtTs).toISOString(),
    reason: `已专注${elapsedSec}秒`,
  }
}

export function createMemoryStore(initialState) {
  let state = initialState || {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: {
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakInterval: 4,
      autoStartBreak: false,
      autoStartWork: false,
      dailyGoalMinutes: 30,   // v0.3.8:打卡表每日专注门槛(分钟),达标=打卡成功
      aiConfig: { apiKey: '', model: 'deepseek-chat' },
    },
    goals: [],       // v0.3.0:目标(如"考研")
    subjects: [],    // v0.3.0:科目(如"数学"),归属 goal
    plans: [],       // v0.3.6:计划/轮次,归属 subject
    tasks: [],
    sessions: [],
    activeFocus: null, // v0.3.7:进行中专注快照(供异常退出恢复)。{taskId,startedAtTs,totalSec}
    activeTaskId: null, // v0.3.12:当前选中任务(持久化,防重启丢失。null=自由专注)
  }
  const listeners = new Set()

  function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return String(Date.now()) + Math.random().toString(36).slice(2)
  }

  function emit() { listeners.forEach(fn => fn(state)) }

  // 快照辅助:从 taskId 反查 task→subject→goal,返回名字快照(防改名/删除后历史失真)。
  // addSession 和 recoverActiveFocus 共用此逻辑(单一真相源)。
  function snapshotForTask(taskId) {
    let taskName = null, subjectId = null, subjectName = null, goalName = null
    if (taskId) {
      const task = state.tasks.find(t => t.id === taskId)
      if (task) {
        taskName = task.title
        if (task.subjectId) {
          const subj = state.subjects.find(s => s.id === task.subjectId)
          if (subj) {
            subjectId = subj.id
            subjectName = subj.name
            const goal = state.goals.find(g => g.id === subj.goalId)
            if (goal) goalName = goal.name
          }
        }
      }
    }
    return { taskName, subjectId, subjectName, goalName }
  }

  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },

    addTask: ({ title, tags = [], subjectId = null }) => {
      // order:越大越靠后。新任务追加到末尾(当前最大order+1)
      const maxOrder = state.tasks.reduce((m, t) => Math.max(m, t.order ?? 0), 0)
      const task = {
        id: genId(),
        title,
        tags: Array.isArray(tags) ? tags : [],
        order: state.tasks.length > 0 ? maxOrder + 1 : 0,
        subjectId: subjectId ?? null,   // v0.3.0:归属科目(null=自由任务)
        createdAt: new Date().toISOString(),
        completed: false,
        completedAt: null,
      }
      state = { ...state, tasks: [...state.tasks, task] }
      emit()
      return task
    },

    // 移动任务顺序:dir='up'上移,'down'下移。
    // 实现:按 order 排序→找相邻→交换位置→normalize(重写为 0..n-1,消除空洞和相等)
    moveTask: (id, dir) => {
      if (dir !== 'up' && dir !== 'down') return
      const sorted = [...state.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const idx = sorted.findIndex(t => t.id === id)
      if (idx === -1) return
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= sorted.length) return  // 已到顶/底
      // 交换 sorted 里两个位置,然后整体 normalize 成 0..n-1
      ;[sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]]
      const orderMap = new Map(sorted.map((t, i) => [t.id, i]))
      state = {
        ...state,
        tasks: state.tasks.map(t => orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id) } : t),
      }
      emit()
    },

    // 给任务设置标签(整体替换)
    setTaskTags: (id, tags) => {
      state = {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === id ? { ...t, tags: Array.isArray(tags) ? tags : [] } : t
        ),
      }
      emit()
    },

    // 给任务加一个标签(去重)
    addTagToTask: (id, tag) => {
      const clean = String(tag).trim()
      if (!clean) return
      state = {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === id && !(t.tags || []).includes(clean)
            ? { ...t, tags: [...(t.tags || []), clean] }
            : t
        ),
      }
      emit()
    },

    // 从任务移除一个标签
    removeTagFromTask: (id, tag) => {
      state = {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === id ? { ...t, tags: (t.tags || []).filter(x => x !== tag) } : t
        ),
      }
      emit()
    },

    // v0.3.0:设置任务归属科目(subjectId=null=自由任务)
    setTaskSubject: (taskId, subjectId) => {
      state = {
        ...state,
        tasks: state.tasks.map(t => t.id === taskId ? { ...t, subjectId: subjectId ?? null } : t),
      }
      emit()
    },

    toggleTask: (id) => {
      state = {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === id
            ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : null }
            : t
        ),
      }
      emit()
    },

    deleteTask: (id) => {
      // v0.3.12:若删的是当前选中任务,清空 activeTaskId(防悬空引用)
      const clearActive = state.activeTaskId === id
      state = {
        ...state,
        tasks: state.tasks.filter(t => t.id !== id),
        activeTaskId: clearActive ? null : state.activeTaskId,
      }
      emit()
    },

    // ===== v0.3.0: 目标(Goal) CRUD =====
    addGoal: ({ name, deadline }) => {
      const goal = {
        id: genId(), name,
        deadline: deadline || null,
        createdAt: new Date().toISOString(),
        archived: false,
      }
      state = { ...state, goals: [...state.goals, goal] }
      emit()
      return goal
    },
    renameGoal: (id, name) => {
      state = { ...state, goals: state.goals.map(g => g.id === id ? { ...g, name } : g) }
      emit()
    },
    setGoalDeadline: (id, deadline) => {
      state = { ...state, goals: state.goals.map(g => g.id === id ? { ...g, deadline: deadline || null } : g) }
      emit()
    },
    archiveGoal: (id) => {
      // 归档目标:连带归档其下科目(任务 subjectId 保留,不丢历史归属)
      const subjectIds = new Set(state.subjects.filter(s => s.goalId === id).map(s => s.id))
      state = {
        ...state,
        goals: state.goals.map(g => g.id === id ? { ...g, archived: true } : g),
        subjects: state.subjects.map(s => subjectIds.has(s.id) ? { ...s, archived: true } : s),
      }
      emit()
    },
    unarchiveGoal: (id) => {
      // 恢复目标:连带恢复其下科目和计划。任务因归属还在,自动重新显示。
      const subjectIds = new Set(state.subjects.filter(s => s.goalId === id).map(s => s.id))
      state = {
        ...state,
        goals: state.goals.map(g => g.id === id ? { ...g, archived: false } : g),
        subjects: state.subjects.map(s => subjectIds.has(s.id) ? { ...s, archived: false } : s),
        plans: state.plans.map(p => subjectIds.has(p.subjectId) ? { ...p, archived: false } : p),
      }
      emit()
    },
    deleteGoal: (id) => {
      // 删目标:连带删其下科目+计划;其下任务的 subjectId 置 null(不删任务)
      const subjectIds = new Set(state.subjects.filter(s => s.goalId === id).map(s => s.id))
      state = {
        ...state,
        goals: state.goals.filter(g => g.id !== id),
        subjects: state.subjects.filter(s => s.goalId !== id),
        plans: state.plans.filter(p => !subjectIds.has(p.subjectId)),   // 级联删计划
        tasks: state.tasks.map(t => subjectIds.has(t.subjectId) ? { ...t, subjectId: null } : t),
      }
      emit()
    },

    // ===== v0.3.0: 科目(Subject) CRUD =====
    addSubject: ({ goalId, name }) => {
      // order:同目标下科目排序,新科目追加末尾(当前最大order+1)
      const goalSubjects = state.subjects.filter(s => s.goalId === goalId)
      const maxOrder = goalSubjects.reduce((m, s) => Math.max(m, s.order ?? 0), 0)
      const subject = {
        id: genId(), goalId, name,
        order: goalSubjects.length > 0 ? maxOrder + 1 : 0,   // v0.3.1:科目排序字段
        createdAt: new Date().toISOString(),
        archived: false,
      }
      state = { ...state, subjects: [...state.subjects, subject] }
      emit()
      return subject
    },
    renameSubject: (id, name) => {
      state = { ...state, subjects: state.subjects.map(s => s.id === id ? { ...s, name } : s) }
      emit()
    },
    // v0.3.1:移动科目顺序(在某目标下)。实现:按 order 排序找相邻→交换→normalize。
    moveSubject: (id, dir) => {
      if (dir !== 'up' && dir !== 'down') return
      const subj = state.subjects.find(s => s.id === id)
      if (!subj) return
      // 只在同目标下排序
      const sorted = state.subjects
        .filter(s => s.goalId === subj.goalId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const idx = sorted.findIndex(s => s.id === id)
      if (idx === -1) return
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= sorted.length) return
      ;[sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]]
      const orderMap = new Map(sorted.map((s, i) => [s.id, i]))
      state = {
        ...state,
        subjects: state.subjects.map(s => orderMap.has(s.id) ? { ...s, order: orderMap.get(s.id) } : s),
      }
      emit()
    },
    archiveSubject: (id) => {
      // 归档科目:连带归档其下计划(今日面板不再统计)
      state = {
        ...state,
        subjects: state.subjects.map(s => s.id === id ? { ...s, archived: true } : s),
        plans: state.plans.map(p => p.subjectId === id ? { ...p, archived: true } : p),
      }
      emit()
    },
    unarchiveSubject: (id) => {
      // 恢复科目:连带恢复其下计划。注:若其归属的目标也归档着,需先恢复目标。
      state = {
        ...state,
        subjects: state.subjects.map(s => s.id === id ? { ...s, archived: false } : s),
        plans: state.plans.map(p => p.subjectId === id ? { ...p, archived: false } : p),
      }
      emit()
    },
    deleteSubject: (id) => {
      // 删科目:连带删其下计划;其下任务的 subjectId 置 null(不删任务)
      state = {
        ...state,
        subjects: state.subjects.filter(s => s.id !== id),
        plans: state.plans.filter(p => p.subjectId !== id),   // 连带删计划
        tasks: state.tasks.map(t => t.subjectId === id ? { ...t, subjectId: null } : t),
      }
      emit()
    },

    // ===== v0.3.6: 计划/轮次(Plan) CRUD =====
    addPlan: ({ subjectId, name = '复习计划', totalHours, deadline }) => {
      const plan = {
        id: genId(), subjectId, name,
        totalHours: Number(totalHours) || 0,
        deadline: deadline || null,
        status: '进行中',           // 进行中 | 已完成 | 已归档
        manualDaily: {},            // { "YYYY-MM-DD": 小时数 } 手动覆盖当天应学
        createdAt: new Date().toISOString(),
        archived: false,
      }
      state = { ...state, plans: [...state.plans, plan] }
      emit()
      return plan
    },
    updatePlan: (id, patch) => {
      state = { ...state, plans: state.plans.map(p => p.id === id ? { ...p, ...patch } : p) }
      emit()
    },
    setPlanStatus: (id, status) => {
      state = { ...state, plans: state.plans.map(p => p.id === id ? { ...p, status } : p) }
      emit()
    },
    // 手动设置某天该计划学多久(覆盖自动分配);hours=null 清除
    setPlanManualDaily: (id, dateKey, hours) => {
      state = {
        ...state,
        plans: state.plans.map(p => {
          if (p.id !== id) return p
          const manualDaily = { ...(p.manualDaily || {}) }
          if (hours === null || hours === undefined) delete manualDaily[dateKey]
          else manualDaily[dateKey] = Number(hours) || 0
          return { ...p, manualDaily }
        }),
      }
      emit()
    },
    archivePlan: (id) => {
      state = { ...state, plans: state.plans.map(p => p.id === id ? { ...p, archived: true } : p) }
      emit()
    },
    deletePlan: (id) => {
      state = { ...state, plans: state.plans.filter(p => p.id !== id) }
      emit()
    },

    addSession: ({ taskId, type, durationSec, status, startedAt, endedAt }) => {
      // 快照:复用 snapshotForTask(防改名/删除后历史失真)
      const snap = snapshotForTask(taskId)
      const session = {
        id: genId(),
        taskId: taskId ?? null,
        type,                       // '专注' | '休息'
        durationSec,
        status,                     // '完成'(自然到点) | '提前结束'(中途完成本轮) | '跳过'(放弃) | '异常中断'(v0.3.7闪退恢复)
        ...snap,                    // taskName/subjectId/subjectName/goalName 快照
        startedAt: startedAt || new Date().toISOString(),
        endedAt: endedAt || new Date().toISOString(),
      }
      state = { ...state, sessions: [...state.sessions, session] }
      emit()
      return session
    },

    // v0.3.7 异常退出恢复:记录"进行中专注"快照。
    // 开始专注(或resume)时调用:存下 taskId+开始时刻戳+本轮总时长,随 data.json 落盘。
    // 软件闪退/崩溃后,下次启动用这些信息把"已专注时长"恢复成一条 session。
    setActiveFocus: ({ taskId, startedAtTs, totalSec }) => {
      state = {
        ...state,
        activeFocus: { taskId: taskId ?? null, startedAtTs, totalSec },
      }
      emit()
    },
    // 正常结束(完成/跳过/提前结束)或暂停时调用:清除进行中快照,防下次启动误恢复。
    clearActiveFocus: () => {
      if (state.activeFocus === null) return   // 已是null,不重复emit
      state = { ...state, activeFocus: null }
      emit()
    },

    updateSettings: (patch) => {
      state = { ...state, settings: { ...state.settings, ...patch } }
      emit()
    },

    // v0.3.12:当前选中任务持久化(防重启丢失)。setActiveTaskId(null)=取消选中(自由专注)。
    setActiveTaskId: (taskId) => {
      state = { ...state, activeTaskId: taskId ?? null }
      emit()
    },
    clearActiveTaskId: () => {
      if (state.activeTaskId === null) return
      state = { ...state, activeTaskId: null }
      emit()
    },

    // 供持久化层整体替换状态(从文件加载)。
    // 加载时通过 migrateState 跑版本链迁移(P0-3:从老 schemaVersion 依次迁到当前版本)。
    replaceState: (newState) => {
      state = migrateState(newState)
      emit()
    },

    // v0.3.7 异常退出恢复:启动时调用。读取进行中快照,若满足恢复条件则记一条"异常中断"
    // session 并清空快照。返回恢复结果(供 UI 通知用户"上次专注X分钟已恢复")。
    // 关键:必须 loaded 后调用(App 层已闸门),否则在空状态上误判。
    recoverActiveFocus: (now = Date.now()) => {
      const af = state.activeFocus
      if (!af) return null   // 无进行中快照,无需恢复
      const result = evaluateRecovery(af, now)
      if (result.action === 'record') {
        const snap = snapshotForTask(af.taskId)
        const session = {
          id: genId(),
          taskId: af.taskId ?? null,
          type: '专注',
          durationSec: result.durationSec,
          status: '异常中断',
          ...snap,                    // taskName/subjectId/subjectName/goalName 快照
          startedAt: result.startedAt,   // 用实际开始时刻(非now)
          endedAt: new Date().toISOString(),
        }
        state = { ...state, sessions: [...state.sessions, session], activeFocus: null }
      } else {
        state = { ...state, activeFocus: null }
      }
      emit()
      return { recorded: result.action === 'record', durationSec: result.durationSec || 0, reason: result.reason }
    },
  }
}

// 持久化版:包装内存 store,每次变更后通过 preload API 存到磁盘。
// 在浏览器/测试环境(window.pomodoroAPI 不存在)时退化为纯内存。
// 关键:加载态(isLoaded)防止首屏竞态——
//   启动时默认 state 先渲染,异步 loadState 完成前若用户已操作,会被 replaceState 覆盖。
//   故提供 isLoaded():加载完成才返回 true,App 层据此阻塞交互。
export function createPersistentStore() {
  const store = createMemoryStore()
  const api = typeof window !== 'undefined' ? window.pomodoroAPI : null
  let loaded = !api || !api.loadState   // 无持久化(测试/浏览器)视为已加载
  let loadFailed = false                // v0.5.0 复审 B1:读取失败标记(本会话停用自动落盘防覆盖旧档)

  if (api && api.loadState) {
    // 启动时从磁盘恢复。三态(v0.5.0 复审 B1):
    //   正常返回/已自愈的 null → 正常加载与落盘
    //   读取失败(reject)→ 本会话禁用自动落盘,保护磁盘旧档不被空状态覆盖;UI 仍解锁(空状态+提示)
    api.loadState().then(saved => {
      if (saved) store.replaceState(saved)
      loaded = true
      // 加载完成触发一次空状态 emit,通知订阅者(让 App 重渲染解锁)
      store.replaceState(store.getState())
    }).catch(() => {
      loadFailed = true
      loaded = true
      console.error('loadState failed: 本次会话已停用自动保存,防止覆盖磁盘上的原有数据;重启应用可重试读取')
      store.replaceState(store.getState())
    })
  }

  // 变更即落盘(仅加载完成且未发生读取失败时落盘)
  store.subscribe((state) => {
    if (loaded && !loadFailed && api && api.saveState) {
      // v0.5.0:saveState 返回 Promise,失败结果异步比较(独立复审建议1)
      api.saveState(state).then(ok => {
        if (ok === false) console.error('saveState failed: 本次改动未落盘')
      }).catch(() => console.error('saveState failed: 本次改动未落盘'))
    }
  })

  return {
    ...store,
    isLoaded: () => loaded,
    isLoadFailed: () => loadFailed,
  }
}
