import { daysUntil } from '../features/date.js'
import { CalendarClock } from 'lucide-react'
import './DeadlineCountdown.css'

// 倒计时行(轻量):显示距目标deadline还有多少天。
// 设计(v0.3.13):
//   - 只显示一个目标(最紧迫的有deadline的未归档目标,按deadline升序取第一个)
//   - 过期显示红字警示"已超期X天"
//   - 点击打开进度预测面板(看各计划详情)
//   - 无deadline目标→不渲染(不占位)
export default function DeadlineCountdown({ goals, onOpenProgress }) {
  const now = new Date()
  // 取最紧迫的有deadline的未归档目标(deadline最近的)
  const candidates = goals
    .filter(g => !g.archived && g.deadline)
    .map(g => ({ goal: g, days: daysUntil(g.deadline, now) }))
    .filter(x => x.days !== null)
    .sort((a, b) => new Date(a.goal.deadline) - new Date(b.goal.deadline))

  if (candidates.length === 0) return null   // 无deadline→不显示

  const { goal, days } = candidates[0]
  const isOverdue = days < 0
  const isToday = days === 1   // daysUntil对今天截止返回1(当天23:59-now向上取整)。0实际是"刚过期<24h"不算今天。

  return (
    <div
      className={'countdown' + (isOverdue ? ' countdown--overdue' : '') + (isToday ? ' countdown--today' : '')}
      onClick={onOpenProgress}
      title="点击查看进度详情"
    >
      <CalendarClock size={15} />
      {isOverdue ? (
        <span>🎯 {goal.name} <strong>已超期 {-days} 天</strong></span>
      ) : isToday ? (
        <span>🎯 {goal.name} <strong>今天截止</strong></span>
      ) : (
        <span>距 🎯{goal.name} 还有 <strong>{days} 天</strong></span>
      )}
    </div>
  )
}
