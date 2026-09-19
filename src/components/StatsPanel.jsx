import { useState, useMemo } from 'react'
import { dailyTrend, monthlyTrend, yearlyTrend, topTasks, summarizeToday } from '../features/stats.js'
import { fmtDuration as fmtMin } from '../features/format.js'   // 收口时长格式化
import { BarChart3 } from 'lucide-react'
import './StatsPanel.css'

const RANGES = [
  { key: 'week', label: '近7天', get: (s) => dailyTrend(s, 7), totalLabel: '本周累计' },
  { key: 'month', label: '本月', get: (s) => monthlyTrend(s), totalLabel: '本月累计' },
  { key: 'year', label: '本年', get: (s) => yearlyTrend(s), totalLabel: '本年累计' },
]

export default function StatsPanel({ sessions, tasks, onClose }) {
  const [range, setRange] = useState('week')
  const today = summarizeToday(sessions)
  const top = topTasks(sessions, tasks).slice(0, 8)
  const active = RANGES.find(r => r.key === range) || RANGES[0]
  const trend = useMemo(() => active.get(sessions), [active, sessions])
  const maxSec = Math.max(1, ...trend.map(d => d.totalSec))
  const rangeTotal = trend.reduce((s, d) => s + d.totalSec, 0)
  const rangeCount = trend.reduce((s, d) => s + d.count, 0)

  return (
    <div className="stats-overlay" onClick={onClose}>
      <div className="stats-panel" onClick={(e) => e.stopPropagation()}>
        <div className="stats-header">
          <h2><BarChart3 size={20} /> 数据统计</h2>
          <button className="stats-close" onClick={onClose}>×</button>
        </div>

        {/* 今日概览卡片 */}
        <div className="stats-cards">
          <div className="stat-card">
            <div className="stat-card__value">{fmtMin(today.totalSec)}</div>
            <div className="stat-card__label">今日专注</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__value">{today.count}</div>
            <div className="stat-card__label">今日番茄</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__value">{fmtMin(rangeTotal)}</div>
            <div className="stat-card__label">{active.totalLabel}</div>
          </div>
        </div>

        {/* 趋势图 + 时间范围切换 */}
        <div className="stats-section">
          <div className="stats-section__head">
            <div className="stats-section__title">专注趋势</div>
            <div className="range-tabs">
              {RANGES.map(r => (
                <button
                  key={r.key}
                  className={'range-tab' + (range === r.key ? ' range-tab--active' : '')}
                  onClick={() => setRange(r.key)}
                >{r.label}</button>
              ))}
            </div>
          </div>
          <div className={'chart' + (range === 'month' ? ' chart--dense' : '')}>
            {trend.map((d, i) => (
              <div className="chart__col" key={i}>
                <div className="chart__bar-wrap">
                  <div
                    className="chart__bar"
                    style={{ height: `${(d.totalSec / maxSec) * 100}%` }}
                    title={d.totalSec > 0 ? `${d.label}: ${fmtMin(d.totalSec)} (${d.count}个)` : `${d.label}: 无专注`}
                  >
                    {/* 只在周视图和非密集时显示数值标签,月/年柱子太细不显示 */}
                    {d.totalSec > 0 && range === 'week' && (
                      <span className="chart__bar-label">{Math.round(d.totalSec / 60)}</span>
                    )}
                  </div>
                </div>
                {/* 柱子多时(月)隔几个显示一个标签,避免重叠 */}
                <div className="chart__day">{
                  range === 'month'
                    ? (i % 5 === 0 || i === trend.length - 1 ? d.label : '')
                    : d.label
                }</div>
              </div>
            ))}
          </div>
          <div className="chart__summary">
            {active.totalLabel}: <strong>{fmtMin(rangeTotal)}</strong> · {rangeCount} 个番茄
          </div>
        </div>

        {/* 任务时间去向排行 */}
        <div className="stats-section">
          <div className="stats-section__title">任务时间去向(全部历史)</div>
          {top.length === 0 ? (
            <div className="stats-empty">还没有专注记录,完成一个番茄就能看到数据啦</div>
          ) : (
            <ul className="task-rank">
              {top.map((t, i) => {
                const maxTask = top[0].totalSec
                return (
                  <li className="task-rank__item" key={t.id}>
                    <span className="task-rank__no">{i + 1}</span>
                    <div className="task-rank__main">
                      <div className="task-rank__title">{t.title}</div>
                      <div className="task-rank__bar-bg">
                        <div
                          className="task-rank__bar"
                          style={{ width: `${(t.totalSec / maxTask) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="task-rank__time">{fmtMin(t.totalSec)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
