import { useMemo } from 'react'
import { todayPlanSummary } from '../features/planning.js'
import { summarizeToday } from '../features/stats.js'
import { fmtHours } from '../features/format.js'
import { ListChecks, Target, BookOpen } from 'lucide-react'
import './TodayPlanPanel.css'

export default function TodayPlanPanel({ sessions, plans, subjects, onOpenGoalManager }) {
  const summary = useMemo(() => todayPlanSummary(sessions, plans), [sessions, plans])
  const totalToday = summary.reduce((s, x) => s + x.todayHours, 0)
  // 今日总专注(含自由专注,不按科目过滤)——防止"按科目的todayDoneHours"漏算自由专注造成困惑
  const totalDoneSec = useMemo(() => summarizeToday(sessions).totalSec, [sessions])
  const totalDoneHours = totalDoneSec / 3600

  if (summary.length === 0) {
    return (
      <div className="today-plan today-plan--empty">
        <ListChecks size={16} /> 今日计划：<a className="today-plan__link" onClick={onOpenGoalManager}>还没有计划，去 <Target size={14} /> 设置</a>
      </div>
    )
  }

  return (
    <div className="today-plan">
      <div className="today-plan__head"><ListChecks size={16} /> 今日计划 · 已学 <strong>{fmtHours(totalDoneHours)}</strong> / 应学 {fmtHours(totalToday)}</div>
      <ul className="today-plan__list">
        {summary.map(({ plan, todayHours, doneHours, todayDoneHours, totalHours, isOverdue, remainDays }) => {
          const subject = subjects.find(s => s.id === plan.subjectId)
          const subjectName = subject ? subject.name : '?'
          const pct = totalHours > 0 ? Math.min(100, Math.round((doneHours / totalHours) * 100)) : 0
          // 今日完成度(今日已学/今日应学)。
          // 注意:todayDoneHours是科目级(该科目今日总投入),todayHours是计划级。
          // 同科目多计划时百分比会虚高(分母是单计划应学),故多计划时不显示百分比只显示绝对值。
          const sameSubjectCount = summary.filter(x => x.plan.subjectId === plan.subjectId).length
          const todayPct = (todayHours > 0 && sameSubjectCount === 1)
            ? Math.min(100, Math.round((todayDoneHours / todayHours) * 100))
            : null
          return (
            <li className={'today-plan__item' + (isOverdue ? ' today-plan__item--overdue' : '')} key={plan.id}>
              <div className="today-plan__main">
                <div className="today-plan__name">
                  <BookOpen size={16} /> {subjectName} · {plan.name}
                  {isOverdue && <span className="today-plan__overdue">已超期</span>}
                </div>
                <div className="today-plan__bar-bg">
                  <div className="today-plan__bar" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="today-plan__meta">
                {/* v0.3.13.1 修bug:删掉每项里重复的"今日总计"(全局值,所有项都显示同一个数误导)。
                    今日总计只在标题显示一次;每项只显示自己的"本计划今日"。 */}
                <div>应学 <strong>{fmtHours(todayHours)}</strong></div>
                <div className="today-plan__sub">今日已学 <strong>{fmtHours(todayDoneHours)}</strong>{todayPct !== null ? ` (${todayPct}%)` : ''} · 总 {fmtHours(doneHours)}/{fmtHours(totalHours)}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
