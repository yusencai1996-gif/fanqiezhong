import { useState, useMemo } from 'react'
import { evaluateDay, calendarMonth, checkinStreak } from '../features/checkin.js'
import { todayPlanSummary } from '../features/planning.js'
import { summarizeToday } from '../features/stats.js'
import { fmtDuration, fmtHours } from '../features/format.js'
import { dateKey } from '../features/date.js'
import { ListChecks, Flame, BookOpen } from 'lucide-react'
import './CheckinPanel.css'

// 日历热力图 + 今日打卡清单。
// 打卡判定:全局每日门槛(settings.dailyGoalMinutes),达标=成功✅。
// 计划应学:今日清单里的"应学"只做参考展示,不影响打卡判定。
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export default function CheckinPanel({ sessions, plans, subjects, dailyGoalMinutes, onClose }) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())   // 0-11

  const goalMin = dailyGoalMinutes ?? 30
  const goalSec = goalMin * 60

  // 月历数据(用 viewYear/viewMonth,不是当前月)
  const todayKey = dateKey(now)   // 用公共 dateKey,统一格式(小码审核 M1:避免手写第4套拼接)
  const cal = useMemo(
    () => calendarMonth(sessions, viewYear, viewMonth, goalMin, now),
    [sessions, viewYear, viewMonth, goalMin]
  )
  // 连续打卡(基于真实 today,不看视图月份)
  const streak = useMemo(() => checkinStreak(sessions, goalMin, now), [sessions, goalMin])
  // 今日打卡状态
  const todayEval = evaluateDay(sessions, now, goalMin, now)
  const todaySummary = summarizeToday(sessions, now)
  // 今日计划进度(参考)
  const planSummary = todayPlanSummary(sessions, plans, subjects, now)

  // 月份切换
  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth()

  // 今日打卡状态文案+色
  const todayStatusInfo = {
    done: { text: '✅ 今日打卡成功', cls: 'checkin-today--done' },
    partial: { text: '⚠ 还差一点就达标', cls: 'checkin-today--partial' },
    missed: { text: '❌ 今天还没开始', cls: 'checkin-today--missed' },
    future: { text: '今日打卡', cls: '' },
  }[todayEval.status] || { text: '今日打卡', cls: '' }

  // 日历格子状态→样式类
  const cellClass = (status) => ({
    done: 'cal-cell--done',
    partial: 'cal-cell--partial',
    missed: 'cal-cell--missed',
    future: 'cal-cell--future',
  }[status] || 'cal-cell--future')

  return (
    <div className="checkin-overlay" onClick={onClose}>
      <div className="checkin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="checkin-header">
          <h2><ListChecks size={20} /> 打卡表</h2>
          <button className="checkin-close" onClick={onClose}>×</button>
        </div>

        {/* 顶部:连续打卡 + 今日状态 */}
        <div className="checkin-topcards">
          <div className="checkin-streak-card">
            <div className="checkin-streak-card__value"><Flame size={20} style={{ color: 'var(--color-success)' }} /> {streak}</div>
            <div className="checkin-streak-card__label">连续打卡(天)</div>
          </div>
          <div className={`checkin-today-card ${todayStatusInfo.cls}`}>
            <div className="checkin-today-card__status">{todayStatusInfo.text}</div>
            <div className="checkin-today-card__detail">
              今日专注 {fmtDuration(todaySummary.totalSec)} / 门槛 {goalMin}分钟
            </div>
            {todayEval.status === 'partial' && (
              <div className="checkin-today-card__hint">
                再专注 {Math.ceil((goalSec - todayEval.totalSec) / 60)} 分钟即可达标
              </div>
            )}
          </div>
        </div>

        {/* 日历热力图 */}
        <div className="checkin-calendar">
          <div className="cal-nav">
            <button className="cal-nav__btn" onClick={prevMonth}>‹</button>
            <span className="cal-nav__label">{cal.monthLabel}</span>
            {!isCurrentMonth && (
              <button className="cal-nav__back" onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth()) }}>
                回到本月
              </button>
            )}
            <button className="cal-nav__btn" onClick={nextMonth}>›</button>
          </div>
          <div className="cal-weeklabels">
            {WEEK_LABELS.map(w => <div key={w} className="cal-weeklabel">{w}</div>)}
          </div>
          <div className="cal-grid">
            {cal.days.map((d, i) => {
              if (!d) return <div key={'blank' + i} className="cal-cell cal-cell--blank" />
              const isToday = d.key === todayKey
              return (
                <div
                  key={d.key}
                  className={`cal-cell ${cellClass(d.status)}${isToday ? ' cal-cell--today' : ''}`}
                  title={d.totalSec > 0 ? `${d.key} · 专注${fmtDuration(d.totalSec)}` : `${d.key} · 未专注`}
                >
                  <span className="cal-cell__day">{d.day}</span>
                  {d.totalSec > 0 && <span className="cal-cell__dot" />}
                </div>
              )
            })}
          </div>
          {/* 图例 */}
          <div className="cal-legend">
            <span className="cal-legend__item"><i className="cal-legend__box cal-cell--done" />达标</span>
            <span className="cal-legend__item"><i className="cal-legend__box cal-cell--partial" />部分</span>
            <span className="cal-legend__item"><i className="cal-legend__box cal-cell--missed" />缺勤</span>
            <span className="cal-legend__item"><i className="cal-legend__box cal-cell--future" />未到</span>
          </div>
          {/* 月统计 */}
          <div className="cal-monthstat">
            本月已打卡 <b>{cal.stats.doneCount}</b> 天 · 部分 <b>{cal.stats.partialCount}</b> 天 · 缺勤 <b>{cal.stats.missedCount}</b> 天
          </div>
        </div>

        {/* 今日计划参考(只读,展示进度,不参与打卡判定) */}
        {planSummary.length > 0 && (
          <div className="checkin-planref">
            <div className="checkin-planref__title">
              今日计划进度(参考) · 今日共专注 {fmtHours(todaySummary.totalSec / 3600)}
            </div>
            {planSummary.map((p, i) => {
              const subj = subjects.find(s => s.id === p.plan.subjectId)
              const pct = p.totalHours > 0 ? Math.min(100, Math.round(p.doneHours / p.totalHours * 100)) : 0
              return (
                <div key={p.plan.id || i} className="checkin-planref__item">
                  <div className="checkin-planref__head">
                    <span><BookOpen size={16} /> {subj?.name || '科目'} · {p.plan.name}</span>
                    {p.isOverdue ? <span className="checkin-planref__overdue">已超期</span>
                      : <span className="checkin-planref__today">今日应学 {fmtHours(p.todayHours)}</span>}
                  </div>
                  <div className="checkin-planref__bar">
                    <div className="checkin-planref__bar-fill" style={{ width: pct + '%' }} />
                  </div>
                  <div className="checkin-planref__meta">
                    本计划今日 {fmtHours(p.todayDoneHours)}{p.todayHours > 0 ? ` / 应学 ${fmtHours(p.todayHours)}` : ''}
                    {' · '}总共 {fmtHours(p.doneHours)}/{fmtHours(p.totalHours)} ({pct}%)
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
