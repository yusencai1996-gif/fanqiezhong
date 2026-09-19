import { useState, useMemo } from 'react'
import { goalProgress, planForecast, burndownData } from '../features/forecast.js'
import { fmtDuration, fmtHours } from '../features/format.js'
import { dateKey } from '../features/date.js'
import { TrendingUp, Target, BookOpen, PartyPopper, TrendingDown } from 'lucide-react'
import './ProgressPanel.css'

// 进度预测面板:目标总进度 + 完成预测(双速率) + 燃尽图。
// 精度:科目级(session无planId,按subject聚合)。
const STATUS_INFO = {
  'on-track': { text: '✅ 进度健康', cls: 'pf-status--ok' },
  'behind': { text: '⚠️ 落后于计划', cls: 'pf-status--warn' },
  'no-data': { text: '💤 暂无数据', cls: 'pf-status--muted' },
  'done': { text: '✅ 已完成', cls: 'pf-status--ok' },
  'no-deadline': { text: '📌 未设截止日', cls: 'pf-status--muted' },
}

function fmtDate(d) {
  if (!d) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function ProgressPanel({ goals, subjects, plans, sessions, onClose }) {
  const now = new Date()
  // 只看未归档目标
  const activeGoals = goals.filter(g => !g.archived)
  const [goalId, setGoalId] = useState(activeGoals[0]?.id || null)
  const [selectedPlanId, setSelectedPlanId] = useState(null)

  const selectedGoal = activeGoals.find(g => g.id === goalId) || activeGoals[0]

  // 目标进度
  const progress = useMemo(
    () => selectedGoal ? goalProgress(sessions, subjects, plans, selectedGoal.id, now) : null,
    [sessions, subjects, plans, selectedGoal]
  )

  // 该目标下进行中的计划列表 + 各自预测
  const goalSubjects = subjects.filter(s => s.goalId === (selectedGoal?.id) && !s.archived)
  const goalPlans = (plans || []).filter(p =>
    goalSubjects.some(s => s.id === p.subjectId) && p.status !== '已归档' && !p.archived
  )
  // v0.4.0:检测共享科目(同科目多计划),用于显示语义提示
  const sharedSubjectIds = useMemo(() => {
    const counts = new Map()
    for (const p of goalPlans) counts.set(p.subjectId, (counts.get(p.subjectId) || 0) + 1)
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([sid]) => sid))
  }, [goalPlans])
  const hasSharedSubject = sharedSubjectIds.size > 0
  const forecasts = useMemo(
    () => goalPlans.map(p => planForecast(sessions, p, now)),
    [sessions, goalPlans]
  )

  // 燃尽图:默认选第一个计划
  const burnPlanId = selectedPlanId || goalPlans[0]?.id
  const burnPlan = goalPlans.find(p => p.id === burnPlanId)
  const burn = useMemo(
    () => burnPlan ? burndownData(sessions, burnPlan, now) : null,
    [sessions, burnPlan]
  )

  if (activeGoals.length === 0) {
    return (
      <div className="pf-overlay" onClick={onClose}>
        <div className="pf-panel" onClick={(e) => e.stopPropagation()}>
          <div className="pf-header">
            <h2><TrendingUp size={20} /> 进度预测</h2>
            <button className="pf-close" onClick={onClose}>×</button>
          </div>
          <p className="pf-empty">还没有目标。去 <Target size={14} /> 设置里建一个目标,设个计划和截止日,这里就能预测能不能按时完成。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pf-overlay" onClick={onClose}>
      <div className="pf-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pf-header">
          <h2><TrendingUp size={20} /> 进度预测</h2>
          <button className="pf-close" onClick={onClose}>×</button>
        </div>

        {/* 目标切换 */}
        {activeGoals.length > 1 && (
          <div className="pf-goal-tabs">
            {activeGoals.map(g => (
              <button
                key={g.id}
                className={`pf-goal-tab${g.id === selectedGoal.id ? ' pf-goal-tab--active' : ''}`}
                onClick={() => { setGoalId(g.id); setSelectedPlanId(null) }}
              ><Target size={16} /> {g.name}</button>
            ))}
          </div>
        )}

        {/* 目标总进度 */}
        {progress && (
          <div className="pf-section">
            <div className="pf-section__title">目标总进度</div>
            <div className="pf-overall">
              <div className="pf-overall__head">
                <span className="pf-overall__name"><Target size={18} /> {selectedGoal.name}</span>
                <span className="pf-overall__pct">{progress.pct}%</span>
              </div>
              <div className="pf-overall__bar-bg">
                <div className="pf-overall__bar" style={{ width: progress.pct + '%' }} />
              </div>
              <div className="pf-overall__meta">
                已学 <b>{fmtHours(progress.doneHours)}</b> / 共 <b>{fmtHours(progress.totalHours)}</b>
              </div>
            </div>
            {/* 各科目细分 */}
            <div className="pf-subjects">
              {progress.subjects.map(r => (
                <div className="pf-subject" key={r.subject.id}>
                  <span className="pf-subject__name"><BookOpen size={16} /> {r.subject.name}</span>
                  <div className="pf-subject__bar-bg">
                    <div className="pf-subject__bar" style={{ width: r.pct + '%' }} />
                  </div>
                  <span className="pf-subject__meta">{fmtHours(r.doneHours)}/{fmtHours(r.totalHours)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 完成预测 */}
        <div className="pf-section">
          <div className="pf-section__title">完成预测</div>
          {hasSharedSubject && (
            <p className="pf-shared-hint">
              ⚠ 以下进度按【科目】统计。该目标下有科目被多个计划共享,各计划的"已学"显示的是该科目总投入,非该计划独占。
            </p>
          )}
          {forecasts.length === 0 ? (
            <p className="pf-empty">该目标下还没有进行中的计划。去 <Target size={14} /> 给科目加个计划(总时长+截止日),这里会预测能不能按时完成。</p>
          ) : (
            <div className="pf-forecasts">
              {forecasts.map(f => {
                const info = STATUS_INFO[f.status] || STATUS_INFO['no-data']
                const subj = subjects.find(s => s.id === f.plan.subjectId)
                return (
                  <div className={`pf-forecast ${info.cls}`} key={f.plan.id}>
                    <div className="pf-forecast__head">
                      <span className="pf-forecast__name"><BookOpen size={16} /> {subj?.name || '科目'} · {f.plan.name}</span>
                      <span className="pf-forecast__status">{info.text}</span>
                    </div>
                    <div className="pf-forecast__body">
                      {f.status === 'done' ? (
                        <span className="pf-forecast__line">已完成 {fmtHours(f.doneHours)}/{fmtHours(f.plan.totalHours)} <PartyPopper size={16} style={{ color: 'var(--color-success)' }} /></span>
                      ) : f.status === 'no-data' ? (
                        <span className="pf-forecast__line muted">还没开始学,开始专注后才有预测</span>
                      ) : (
                        <>
                          <div className="pf-forecast__line">
                            <span>截止日</span><b>{f.deadline ? fmtDate(new Date(f.deadline)) : '未设'}</b>
                          </div>
                          {f.predictRecent && (
                            <div className="pf-forecast__line">
                              <span>按近7天({f.rateRecent.toFixed(2)}h/天)预测完成</span>
                              <b className={f.status === 'behind' ? 'pf-warn' : 'pf-ok'}>{fmtDate(f.predictRecent)}</b>
                            </div>
                          )}
                          {f.predictOverall && (
                            <div className="pf-forecast__line">
                              <span>按计划至今({f.rateOverall.toFixed(2)}h/天)预测完成</span>
                              <b>{fmtDate(f.predictOverall)}</b>
                            </div>
                          )}
                          <div className="pf-forecast__line muted">
                            剩余 {fmtHours(f.remainingHours)} / 已学 {fmtHours(f.doneHours)}
                          </div>
                        </>
                      )}
                    </div>
                    {/* 看燃尽图按钮 */}
                    <button className="pf-forecast__burn" onClick={() => setSelectedPlanId(f.plan.id)}>
                      <TrendingDown size={16} /> {selectedPlanId === f.plan.id ? '正在看' : '看燃尽图'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 燃尽图 */}
        {burn && burnPlan && (
          <div className="pf-section">
            <div className="pf-section__title">
              燃尽图 · {subjects.find(s => s.id === burnPlan.subjectId)?.name} · {burnPlan.name}
              {sharedSubjectIds.has(burnPlan.subjectId) && <span className="pf-burn-shared-tag">共享科目</span>}
            </div>
            <BurndownChart data={burn} />
            <div className="pf-burn-legend">
              <span className="pf-burn-legend__item"><i className="pf-burn-legend__line pf-burn-legend__line--ideal" />理想线(匀速完成)</span>
              <span className="pf-burn-legend__item"><i className="pf-burn-legend__line pf-burn-legend__line--actual" />该科目实际投入</span>
            </div>
            <p className="pf-burn-hint">实际线在理想线上方 = 落后;下方 = 领先。横轴时间,纵轴该科目剩余投入(h)。</p>
          </div>
        )}
      </div>
    </div>
  )
}

// 燃尽图(纯CSS SVG)。两条折线:理想(虚线)+实际(实线)。
function BurndownChart({ data }) {
  const { ideal, actual, totalHours } = data
  if (ideal.length === 0) return <p className="pf-empty">数据不足</p>

  // 所有点合并取日期范围,用 ideal 的点做 x 轴基准(ideal 跨全程)
  const W = 100, H = 100   // viewBox 百分比
  const maxH = totalHours || 1
  const n = ideal.length
  const toPath = (pts) => {
    if (pts.length === 0) return ''
    // pts: [{date, remaining}],x 按 ideal 的索引对齐(实际线点可能少于理想线)
    // 实际线按日期映射到理想线的 x 比例
    const idealDateIdx = new Map(ideal.map((p, i) => [p.date, i]))
    return pts.map((p, idx) => {
      // 找该日期在 ideal 里的索引,找不到就用 pts 自身索引线性插值
      let i = idealDateIdx.get(p.date)
      if (i === undefined) {
        // 按日期排序位置近似
        i = ideal.filter(ip => ip.date <= p.date).length - 1
        if (i < 0) i = 0
      }
      const x = n > 1 ? (i / (n - 1)) * W : 0
      const y = H - (p.remaining / maxH) * H
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
  }

  const idealPath = toPath(ideal)
  const actualPath = toPath(actual)

  return (
    <div className="pf-burn-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pf-burn-svg">
        {/* 理想线:虚线 */}
        <path d={idealPath} fill="none" className="pf-burn-ideal" />
        {/* 实际线:实线 */}
        {actualPath && <path d={actualPath} fill="none" className="pf-burn-actual" />}
      </svg>
      <div className="pf-burn-axis">
        <span>{ideal[0].date.slice(5)}</span>
        <span>{ideal[ideal.length - 1].date.slice(5)}</span>
      </div>
    </div>
  )
}
