import { useEffect, useRef, useState } from 'react'
import { createPersistentStore } from './data/store.js'
import { createTimer } from './features/timer.js'
import { summarizeToday } from './features/stats.js'
// v0.7.0:应用前复检(过期→STALE_PREVIEW 零写入)。冻结签名见 PLAN 第三节。
import { preparePlanAdjustmentApply } from './features/ai.js'
import TaskList from './components/TaskList.jsx'
import Timer from './components/Timer.jsx'
import TodaySummary from './components/TodaySummary.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import StatsPanel from './components/StatsPanel.jsx'
import GoalManager from './components/GoalManager.jsx'
import TodayPlanPanel from './components/TodayPlanPanel.jsx'
import CheckinPanel from './components/CheckinPanel.jsx'
import ProgressPanel from './components/ProgressPanel.jsx'
import DeadlineCountdown from './components/DeadlineCountdown.jsx'
import HelpPanel from './components/HelpPanel.jsx'
import AiAssistantPanel from './components/AiAssistantPanel.jsx'
import { Target, CalendarCheck, TrendingUp, BarChart3, Settings, RotateCcw, HelpCircle, Menu, Sparkles } from 'lucide-react'

export default function App() {
  const storeRef = useRef(null)
  if (!storeRef.current) storeRef.current = createPersistentStore()
  const store = storeRef.current

  const [state, setState] = useState(store.getState())
  const [loaded, setLoaded] = useState(store.isLoaded())
  const [loadFailed, setLoadFailed] = useState(store.isLoadFailed && store.isLoadFailed())   // v0.5.0 复审B1:读取失败提示
  const [mode, setMode] = useState('专注')
  // v0.3.12:activeTaskId 改读 store(持久化,防重启丢失)。下游用 const activeTaskId 引用,不需大改。
  const activeTaskId = state.activeTaskId
  const [showSettings, setShowSettings] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showGoalManager, setShowGoalManager] = useState(false)
  const [showCheckin, setShowCheckin] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)   // v0.3.15:小窗口折叠菜单展开态

  // v0.5.0 AI 助手:aiConfig=null 表示未读取/桥不存在(此时两处入口都不显示)。
  // 入口可见性只看 aiConfig.hasApiKey(宽屏顶栏 + 窄屏菜单同一数据源)。
  const [aiConfig, setAiConfig] = useState(null)
  const [aiOpen, setAiOpen] = useState(false)
  const aiTestReqRef = useRef(null)   // 连接测试在途 requestId(供取消用)

  // v0.3.15:监听窗口宽度,小于960px时顶栏折叠成菜单按钮(防6按钮挤占计时区)
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 960)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 820)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const workCountRef = useRef(0)
  const recoveredRef = useRef(false)   // v0.3.7:确保启动恢复只执行一次
  const [recoveryNotice, setRecoveryNotice] = useState(null)   // 恢复成功提示(显示片刻)

  // v0.3.7 异常退出恢复:loaded 后检查进行中快照,若存在则恢复成"异常中断"记录。
  // recoveredRef 保证只执行一次(loaded 可能多次变化)。
  useEffect(() => {
    if (loaded && !recoveredRef.current) {
      recoveredRef.current = true
      const result = store.recoverActiveFocus()
      if (result && result.recorded) {
        setRecoveryNotice(result)
      }
    }
  }, [loaded, store])

  // 恢复提示显示几秒后自动消失
  useEffect(() => {
    if (!recoveryNotice) return
    const id = setTimeout(() => setRecoveryNotice(null), 8000)
    return () => clearTimeout(id)
  }, [recoveryNotice])

  // v0.5.0 AI 助手:加载完成后读一次 AI 公开配置(掩码信息,不含明文密钥)。
  // 桥不存在(旧版本/纯浏览器无 mock)时保持 null → 无入口、零请求。
  useEffect(() => {
    if (!loaded) return
    const api = window.pomodoroAPI
    if (!api?.aiGetConfig) return
    let alive = true
    api.aiGetConfig().then(res => { if (alive && res?.ok) setAiConfig(res.data) }).catch(() => {})
    return () => { alive = false }
  }, [loaded])

  // AI 配置保存(密钥/清除/模型)。密钥全程不经 store.updateSettings。
  async function handleAiSave(patch) {
    const api = window.pomodoroAPI
    if (!api?.aiUpdateConfig) return { ok: false, error: { code: 'FORBIDDEN', message: '', retryable: false } }
    const res = await api.aiUpdateConfig(patch)
    if (res.ok) {
      setAiConfig(res.data)
      // 清除成功:立即关闭助手面板;hasApiKey 变 false 后面板整体卸载,会话内存随之清空
      if (patch.clearApiKey) setAiOpen(false)
    }
    return res
  }

  // 连接测试:使用已保存配置(最小测试消息,不带学习摘要)
  async function handleAiTest() {
    const api = window.pomodoroAPI
    if (!api?.aiTestConnection) return { ok: false, error: { code: 'FORBIDDEN', message: '', retryable: false } }
    const requestId = 'ai-test-' + Date.now().toString(36)
    aiTestReqRef.current = requestId
    try {
      return await api.aiTestConnection({ requestId })
    } finally {
      if (aiTestReqRef.current === requestId) aiTestReqRef.current = null
    }
  }

  function handleAiCancelTest() {
    const api = window.pomodoroAPI
    if (api?.aiCancel && aiTestReqRef.current) api.aiCancel({ requestId: aiTestReqRef.current })
  }

  // v0.6.0 引导式建档:应用 AI 方案。按 validatePlanAgainstStore 生成的操作序列
  // 逐个调 store API(只新建,不改不删),用返回的 id 串 goal→subject→plan 依赖。
  // store 无事务:中途失败不回滚,返回错误供面板提示用户检查(失败概率极低)。
  function applyPlanProposal(ops) {
    const goalIdsByName = new Map()
    const subjectIdsByName = new Map()
    const created = { goal: null, subjects: [], plans: [] }
    try {
      for (const op of Array.isArray(ops) ? ops : []) {
        if (op.op === 'addGoal') {
          const goal = store.addGoal({ name: op.name, deadline: op.deadline })
          goalIdsByName.set(op.name, goal.id)
          created.goal = goal
        } else if (op.op === 'addSubject') {
          const goalId = goalIdsByName.get(op.goalName)
          if (!goalId) throw new Error(`找不到目标「${op.goalName}」`)
          const subject = store.addSubject({ goalId, name: op.name })
          subjectIdsByName.set(op.name, subject.id)
          created.subjects.push(subject)
        } else if (op.op === 'addPlan') {
          const subjectId = subjectIdsByName.get(op.subjectName)
          if (!subjectId) throw new Error(`找不到科目「${op.subjectName}」`)
          created.plans.push(store.addPlan({ subjectId, name: op.name, totalHours: op.totalHours, deadline: op.deadline }))
        }
      }
      if (!created.goal) return { ok: false, error: '操作序列里没有目标' }
      return { ok: true, created }
    } catch (e) {
      return { ok: false, error: e?.message || '写入失败' }
    }
  }

  // v0.7.0 智能调计划:应用 AI 调整方案(只改计划 name/totalHours/deadline)。
  // 安全顺序(PLAN 第六节 + 统筹裁决第 2 条):
  //   同步 ref 防双击 → 重新 store.getState()(不依赖 render 闭包)→ preparePlanAdjustmentApply
  //   完整复检(过期/身份不符→STALE_PREVIEW 零写入)→ 逐条 updatePlan(ops 由 ai.js 白名单重新构造,
  //   不信任卡片传来的任何操作序列)→ 返回 ApplyResult。updatePlan 为同步纯内存写,预检已穷尽
  //   现实失败模式;try/catch 兜底返回错误,不为本期单独做渲染层事务化(裁决:已知限制)。
  const adjustApplyRef = useRef(false)
  async function applyPlanAdjustment({ adjustment, expectedPreview } = {}) {
    if (adjustApplyRef.current) return { ok: false, code: 'BUSY', error: '已有调整正在应用,请稍候' }
    adjustApplyRef.current = true
    const appliedIds = []   // 提到 try 外:catch 里能如实报告部分写入(专审建议)
    try {
      if (!store.isLoaded()) return { ok: false, code: 'NOT_READY', error: '数据尚未加载完成,请稍后重试' }
      // v0.7.0 专审整改:读取失败会话不落盘,不能让调整报"已应用"误导用户
      if (store.isLoadFailed && store.isLoadFailed()) {
        return { ok: false, code: 'NOT_READY', error: '数据文件读取失败,本次会话不会保存任何改动;请重启应用后再调整' }
      }
      if (!adjustment || typeof adjustment !== 'object') {
        return { ok: false, code: 'INVALID_ADJUSTMENT', error: '调整方案为空或格式异常' }
      }
      const recheck = preparePlanAdjustmentApply(adjustment, store.getState(), expectedPreview)
      if (!recheck || typeof recheck !== 'object') {
        return { ok: false, code: 'INVALID_ADJUSTMENT', error: '调整方案复检异常' }
      }
      if (recheck.stale) {
        return {
          ok: false, code: 'STALE_PREVIEW',
          error: '预览已过期:相关计划在确认前已被修改,本次未写入。请重新查看后再应用',
          previews: recheck.previews,
        }
      }
      if (!recheck.ok) {
        const first = (Array.isArray(recheck.errors) ? recheck.errors : [])[0]
        const reason = typeof first === 'string' ? first : first?.message
        return { ok: false, code: 'INVALID_ADJUSTMENT', error: `调整方案未通过校验${reason ? `:${reason}` : ''}`, previews: recheck.previews }
      }
      const ops = Array.isArray(recheck.ops) ? recheck.ops : []
      if (!ops.length) return { ok: false, code: 'INVALID_ADJUSTMENT', error: '方案没有实际变化,无需应用' }
      // v0.7.0 专审整改:整批形状预检提到循环前——不允许"前几条已写入才报已取消"
      if (!ops.every(op => op && op.op === 'updatePlan' && typeof op.id === 'string'
        && op.patch && typeof op.patch === 'object' && !Array.isArray(op.patch))) {
        return { ok: false, code: 'INVALID_ADJUSTMENT', error: '操作序列异常,未应用任何调整' }
      }
      for (const op of ops) {
        store.updatePlan(op.id, op.patch)
        appliedIds.push(op.id)
      }
      console.info('plan adjustment applied:', appliedIds.join(','))
      return { ok: true, appliedIds }
    } catch (e) {
      return {
        ok: false, code: 'APPLY_FAILED', appliedIds,
        error: (e?.message || '写入失败') + (appliedIds.length
          ? `;前 ${appliedIds.length} 条调整可能已写入,请到「目标与科目」核对`
          : ',未写入任何调整'),
      }
    } finally {
      adjustApplyRef.current = false
    }
  }

  useEffect(() => {
    const unsub = store.subscribe(s => {
      setState(s)
      if (!loaded && store.isLoaded()) setLoaded(true)
      if (!loadFailed && store.isLoadFailed && store.isLoadFailed()) setLoadFailed(true)
    })
    return unsub
  }, [store, loaded, loadFailed])

  // 全局快捷键:Ctrl+Shift+Space 切换开始/暂停
  useEffect(() => {
    const api = window.pomodoroAPI
    if (!api?.onToggleStartPause) return
    // 复用 toggleStartPause(消除内联重复)。toggleStartPause 内部读 timerRef(ref,永远最新),闭包陈旧不影响。
    return api.onToggleStartPause(() => toggleStartPause())
  }, [])

  // A根治:监听主进程"时间到"通知。主窗口进后台时渲染层定时器被节流,
  // 主进程到点会发这个事件。这里只在"渲染层timer还在running(还没察觉结束)"时接管,
  // 避免与渲染层自身的onFinished重复触发(防双记录session/重复通知)。
  useEffect(() => {
    const api = window.pomodoroAPI
    if (!api?.onTimerFinished) return
    return api.onTimerFinished(() => {
      const t = timerRef.current
      // 守卫:只在running时接管。若渲染层已处理(状态变stopped/finished),不重复触发。
      if (t && t.getStatus() === 'running') {
        handleFinishedRef.current()
      }
    })
  }, [])

  // handleFinished 用 ref 保存最新引用(供上面 onTimerFinished effect 用,避免闭包陈旧)。
  // 关键:每渲染更新 ref.current,否则 effect([])闭包里永远是初始空函数。
  const handleFinishedRef = useRef(() => {})

  // 实时上报计时状态给小插件窗口(每 500ms)
  // 关键:interval 只依赖 [],永不重建——用 ref 读最新的 mode/task 等,
  // 避免 mode/task 变化时 interval 被销毁重建导致小窗口"卡一下"。
  const modeRef = useRef(mode)
  const activeTaskIdRef = useRef(activeTaskId)
  const tasksRef = useRef(state.tasks)
  modeRef.current = mode
  activeTaskIdRef.current = activeTaskId
  tasksRef.current = state.tasks

  useEffect(() => {
    // api 判断挪进 interval:若首次 mount 时 preload 未注入,每次 tick 重试,API 就绪后自动恢复上报
    const id = setInterval(() => {
      const api = window.pomodoroAPI
      if (!api?.reportTimerState) return
      const t = timerRef.current
      if (!t) return
      const m = modeRef.current
      const aid = activeTaskIdRef.current
      api.reportTimerState({
        remainingSec: t.getRemainingSec(),
        mode: m,
        status: t.getStatus(),
        taskTitle: tasksRef.current.find(x => x.id === aid)?.title || '',
      })
    }, 500)
    return () => clearInterval(id)
  }, [])  // ← 只依赖空数组,interval 全程不重建

  // 切换开始/暂停(供小插件和快捷键共用)
  function toggleStartPause() {
    const t = timerRef.current
    if (!t) return
    const st = t.getStatus()
    if (st === 'stopped' || st === 'paused') {
      t.start()
      // v0.3.7 异常退出恢复:专注模式开始时记录"进行中快照"。
      // 每次开始(含resume)都用当前时刻重写startedAtTs——恢复时只算最后一个running段,
      // 宁少算不多算(不把暂停时长误计为专注)。休息模式不记录(休息中断不计专注)。
      if (mode === '专注') {
        store.setActiveFocus({
          taskId: activeTaskId,
          startedAtTs: Date.now(),
          totalSec: minutes * 60,
        })
      }
    } else if (st === 'running') {
      t.pause()
      // v0.3.7:暂停时清空快照(resume时会重写)。避免暂停期间闪退误恢复暂停时长。
      if (mode === '专注') store.clearActiveFocus()
    }
    syncTimerEnd()   // 开始/暂停后同步结束时刻给主进程
  }

  // A根治:把本轮结束时刻同步给主进程。主窗口进后台时渲染层定时器被节流,
  // 主进程定时器不受影响,到点主动通知(避免计时到了却不提醒)。
  function syncTimerEnd() {
    const api = window.pomodoroAPI
    if (!api?.setTimerEnd) return
    const t = timerRef.current
    if (!t) return
    const st = t.getStatus()
    if (st === 'running') {
      // 结束时刻 = 现在 + 剩余秒数
      api.setTimerEnd(Date.now() + t.getRemainingSec() * 1000)
    } else {
      // 非running(暂停/停止/完成):清除主进程监控
      api.clearTimerEnd()
    }
  }

  const minutes = mode === '休息'
    ? (workCountRef.current > 0 && workCountRef.current % state.settings.longBreakInterval === 0
        ? state.settings.longBreakMinutes : state.settings.shortBreakMinutes)
    : state.settings.workMinutes

  const timerRef = useRef(null)
  // v0.4.1 加固:计时进行中(running/paused)不重建 timer,防止"专注中改设置→实例丢失→
  // 主进程到点发 timerFinished 时守卫读到新实例 stopped → 误拦截 → 不通知。
  // 新时长在下一轮(停止态)才生效,语义合理(进行中改设置只影响下一轮)。
  // 重建判定用 timer.getTotalSec() 比较实例实际时长(而非 _mins 标记,防预写导致重置后不重建)。
  if (timerRef.current) {
    const st = timerRef.current.getStatus()
    const needRebuild = timerRef.current._mode !== mode || timerRef.current.getTotalSec() !== minutes * 60
    if (st === 'running' || st === 'paused') {
      // 进行中:不替换实例(新时长下一轮生效),但更新 _mode 标记
      timerRef.current._mode = mode
    } else if (needRebuild) {
      // 停止/完成态:安全重建(用 getTotalSec 判定,重置后也能正确重建)
      const t = createTimer({ totalSec: minutes * 60 })
      t._mode = mode
      timerRef.current = t
    }
  } else {
    // 首次初始化
    const t = createTimer({ totalSec: minutes * 60 })
    t._mode = mode
    timerRef.current = t
  }
  const timer = timerRef.current

  function handleFinished() {
    // v0.4.1:用 timer 实例的实际时长,而非当前渲染的 minutes(防"专注中改设置"导致记录时长虚增)
    const usedSec = timer.getTotalSec()
    store.addSession({
      taskId: mode === '专注' ? activeTaskId : null,
      type: mode === '专注' ? '专注' : '休息',
      durationSec: usedSec,
      status: '完成',
    })
    store.clearActiveFocus()   // v0.3.7:正常结束清空进行中快照(防下次启动误恢复/双计)
    // 系统通知(森哥要求:结束弹提醒就够)
    const api = window.pomodoroAPI
    if (api?.notify) {
      if (mode === '专注') {
        api.notify('专注完成 🍅', '辛苦了,休息一下吧')
      } else {
        api.notify('休息结束 ☕', '准备好开始下一个番茄了吗?')
      }
    }
    if (mode === '专注') {
      workCountRef.current += 1
      setMode('休息')
    } else {
      setMode('专注')
    }
    timer.reset()
    window.pomodoroAPI?.clearTimerEnd?.()   // 本轮结束,清除主进程监控
  }
  handleFinishedRef.current = handleFinished   // 🔴-1修复:每渲染更新ref,供onTimerFinished effect用

  function handleSkip() {
    // v0.4.1:用 timer 实例实际时长(同 handleFinished 的修复理由)
    const usedSec = timer.getTotalSec() - timer.getRemainingSec()
    store.addSession({
      taskId: mode === '专注' ? activeTaskId : null,
      type: mode === '专注' ? '专注' : '休息',
      durationSec: usedSec,
      status: '跳过',
    })
    store.clearActiveFocus()   // v0.3.7:正常结束清空进行中快照
    timer.skip()
    timer.reset()
    window.pomodoroAPI?.clearTimerEnd?.()
    if (mode === '专注') {
      workCountRef.current += 1
      setMode('休息')
    } else {
      setMode('专注')
    }
  }

  // 中途结束本轮:按实际专注时间记录为"提前结束"(区别于自然"完成"和"跳过")。
  // 场景:设定25分钟,20分钟时临时有事,点这个按20分钟记,并进入休息。
  function handleFinishEarly() {
    const elapsedSec = timer.getElapsedSec()
    // 0秒边界:还没专注就点结束,等同于跳过(记一条"跳过"),避免"啥也没记就进休息"
    if (elapsedSec === 0) { handleSkip(); return }
    // 只记录真正专注过的。休息中途结束不计专注。
    if (mode === '专注') {
      store.addSession({
        taskId: activeTaskId,
        type: '专注',
        durationSec: elapsedSec,
        status: '提前结束',   // 与"完成"(自然到点)区分,供统计区分
      })
      workCountRef.current += 1
    }
    store.clearActiveFocus()   // v0.3.7:正常结束清空进行中快照
    timer.skip()
    timer.reset()
    window.pomodoroAPI?.clearTimerEnd?.()
    setMode(mode === '专注' ? '休息' : '专注')
  }

  // v0.3.7:重置按钮 = 放弃本轮(语义)。清 timer + 清进行中快照(防闪退后误恢复)。
  // 与 handleSkip 的区别:重置不记 session(纯粹丢弃),handleSkip 记"跳过"。
  function handleReset() {
    timer.reset()
    store.clearActiveFocus()
    syncTimerEnd()
  }

  const today = summarizeToday(state.sessions)
  const activeTask = state.tasks.find(t => t.id === activeTaskId) || null

  if (!loaded) {
    return <div className="loading">正在加载…</div>
  }

  return (
    <div className="app">
      <TaskList
        tasks={state.tasks}
        subjects={state.subjects}
        activeTaskId={activeTaskId}
        onAdd={(title) => store.addTask({ title })}
        onSelect={(id) => store.setActiveTaskId(id)}
        onToggle={(id) => store.toggleTask(id)}
        onDelete={(id) => store.deleteTask(id)}
        onAddTag={(id, tag) => store.addTagToTask(id, tag)}
        onRemoveTag={(id, tag) => store.removeTagFromTask(id, tag)}
        onMoveTask={(id, dir) => store.moveTask(id, dir)}
        onSetSubject={(id, subjectId) => store.setTaskSubject(id, subjectId)}
      />
      <main className="app__main">
        {loadFailed && (
          <div className="app__recovery-banner" role="alert">
            ⚠ 数据文件读取失败:为防止覆盖原有数据,本次会话的改动不会保存。请重启应用重试;若持续出现,检查数据文件是否被其他程序占用。
          </div>
        )}
        {recoveryNotice && (
          <div className="app__recovery-banner">
            <RotateCcw size={16} /> 上次专注未正常结束，已自动恢复 {recoveryNotice.durationSec < 60
              ? `${recoveryNotice.durationSec} 秒`
              : `约 ${Math.round(recoveryNotice.durationSec / 60)} 分钟`} 记录
          </div>
        )}
        <Timer
          timer={timer}
          mode={mode}
          activeTask={activeTask}
          onFinished={handleFinished}
          onSkip={handleSkip}
          onFinishEarly={handleFinishEarly}
          onTimerChange={syncTimerEnd}
          onStartPause={toggleStartPause}
          onReset={handleReset}
        />
        <DeadlineCountdown goals={state.goals} onOpenProgress={() => setShowProgress(true)} />
        <TodaySummary totalSec={today.totalSec} count={today.count} />
        <TodayPlanPanel
          sessions={state.sessions}
          plans={state.plans}
          subjects={state.subjects}
          onOpenGoalManager={() => setShowGoalManager(true)}
        />
      </main>

      {/* v0.3.15 右上角按钮:宽屏6按钮展开,窄屏(<820)折叠成☰菜单(防挤占计时区) */}
      <div className="app__topbar">
        {narrow ? (
          // 窄屏:折叠成菜单按钮 + 下拉
          <div className="app__topbar-menu">
            <button className="app__icon-btn" title="菜单" onClick={() => setMenuOpen(v => !v)}><Menu size={18} /></button>
            {menuOpen && (
              <>
                <div className="app__menu-overlay" onClick={() => setMenuOpen(false)} />
                <div className="app__menu-dropdown">
                  {aiConfig?.hasApiKey && (
                    <button onClick={() => { setAiOpen(true); setMenuOpen(false) }}><Sparkles size={16} /> AI 助手</button>
                  )}
                  <button onClick={() => { setShowGoalManager(true); setMenuOpen(false) }}><Target size={16} /> 目标与科目</button>
                  <button onClick={() => { setShowCheckin(true); setMenuOpen(false) }}><CalendarCheck size={16} /> 打卡表</button>
                  <button onClick={() => { setShowProgress(true); setMenuOpen(false) }}><TrendingUp size={16} /> 进度预测</button>
                  <button onClick={() => { setShowStats(true); setMenuOpen(false) }}><BarChart3 size={16} /> 数据统计</button>
                  <div className="app__menu-sep" />
                  <button onClick={() => { setShowHelp(true); setMenuOpen(false) }}><HelpCircle size={16} /> 使用说明</button>
                  <button onClick={() => { setShowSettings(true); setMenuOpen(false) }}><Settings size={16} /> 设置</button>
                </div>
              </>
            )}
          </div>
        ) : (
          // 宽屏:6按钮展开(原样)+ AI 助手入口(仅已配置密钥时显示)
          <>
            {aiConfig?.hasApiKey && (
              <button className="app__icon-btn" title="AI 助手" onClick={() => setAiOpen(true)}><Sparkles size={18} /></button>
            )}
            <button className="app__icon-btn" title="目标与科目" onClick={() => setShowGoalManager(true)}><Target size={18} /></button>
            <button className="app__icon-btn" title="打卡表" onClick={() => setShowCheckin(true)}><CalendarCheck size={18} /></button>
            <button className="app__icon-btn" title="进度预测" onClick={() => setShowProgress(true)}><TrendingUp size={18} /></button>
            <button className="app__icon-btn" title="数据统计" onClick={() => setShowStats(true)}><BarChart3 size={18} /></button>
            <span className="app__topbar-sep" />
            <button className="app__icon-btn" title="使用说明" onClick={() => setShowHelp(true)}><HelpCircle size={18} /></button>
            <button className="app__icon-btn" title="设置" onClick={() => setShowSettings(true)}><Settings size={18} /></button>
          </>
        )}
      </div>

      {showSettings && (
        <SettingsPanel
          settings={state.settings}
          onChange={(patch) => store.updateSettings(patch)}
          onClose={() => setShowSettings(false)}
          aiConfig={aiConfig}
          onAiSave={handleAiSave}
          onAiTest={handleAiTest}
          onAiCancelTest={handleAiCancelTest}
        />
      )}
      {/* v0.5.0 AI 助手面板:已配置期间保持挂载,open 只控制弹层显隐——
          关闭再开会话历史保留;清除密钥(hasApiKey→false)整体卸载,内存清空、请求随配置失效。 */}
      {aiConfig?.hasApiKey && (
        <AiAssistantPanel
          open={aiOpen}
          config={aiConfig}
          getStudyData={() => {
            // v0.7.0:从 store 取最新(修 PLAN 第六节指出的 render 闭包旧数据问题),只返回四类学习数据
            const s = store.getState()
            return { sessions: s.sessions, plans: s.plans, subjects: s.subjects, goals: s.goals }
          }}
          onApplyPlan={applyPlanProposal}
          onApplyAdjustment={applyPlanAdjustment}
          onClose={() => setAiOpen(false)}
        />
      )}
      {showStats && (
        <StatsPanel
          sessions={state.sessions}
          tasks={state.tasks}
          onClose={() => setShowStats(false)}
        />
      )}
      {showCheckin && (
        <CheckinPanel
          sessions={state.sessions}
          plans={state.plans}
          subjects={state.subjects}
          dailyGoalMinutes={state.settings.dailyGoalMinutes}
          onClose={() => setShowCheckin(false)}
        />
      )}
      {showProgress && (
        <ProgressPanel
          goals={state.goals}
          subjects={state.subjects}
          plans={state.plans}
          sessions={state.sessions}
          onClose={() => setShowProgress(false)}
        />
      )}
      {showHelp && (
        <HelpPanel onClose={() => setShowHelp(false)} />
      )}
      {showGoalManager && (
        <GoalManager
          goals={state.goals}
          subjects={state.subjects}
          onAddGoal={(name) => store.addGoal({ name })}
          onRenameGoal={(id, name) => store.renameGoal(id, name)}
          onSetGoalDeadline={(id, deadline) => store.setGoalDeadline(id, deadline)}
          onArchiveGoal={(id) => store.archiveGoal(id)}
          onUnarchiveGoal={(id) => store.unarchiveGoal(id)}
          onDeleteGoal={(id) => store.deleteGoal(id)}
          onAddSubject={(goalId, name) => store.addSubject({ goalId, name })}
          onRenameSubject={(id, name) => store.renameSubject(id, name)}
          onMoveSubject={(id, dir) => store.moveSubject(id, dir)}
          onArchiveSubject={(id) => store.archiveSubject(id)}
          onUnarchiveSubject={(id) => store.unarchiveSubject(id)}
          onDeleteSubject={(id) => store.deleteSubject(id)}
          plans={state.plans}
          sessions={state.sessions}
          onAddPlan={(data) => store.addPlan(data)}
          onUpdatePlan={(id, patch) => store.updatePlan(id, patch)}
          onDeletePlan={(id) => store.deletePlan(id)}
          onClose={() => setShowGoalManager(false)}
        />
      )}
    </div>
  )
}
