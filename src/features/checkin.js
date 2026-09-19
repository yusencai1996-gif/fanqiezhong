// 打卡判定:纯函数(可单测)。
// 打卡标准:全局每日最低门槛(默认30分钟,在设置里改)。
//   某天有效专注 ≥ 门槛 → 'done'(成功✅)
//   有效专注 = 0       → 'missed'(缺勤❌)
//   0 < 专注 < 门槛     → 'partial'(部分⚠)
//   未来日期            → 'future'(未到,不判定)
// 注:打卡只用全局门槛,不绑计划目标(简单清晰)。计划应学在 UI 侧另算,只做参考展示。
// 依赖:date.js 的 isValidFocus / dateKey。

import { isValidFocus, dateKey } from './date.js'

// 默认每日门槛(分钟)。可被 settings.dailyGoalMinutes 覆盖。
export const DEFAULT_DAILY_GOAL_MINUTES = 30

// 计算某一天的专注总秒数(只算有效专注)。
function dayFocusSec(sessions, date) {
  const k = dateKey(date)
  let sec = 0
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (dateKey(s.startedAt) === k) sec += s.durationSec
  }
  return sec
}

// 评估某天的打卡状态。
// 返回 { status: 'done'|'partial'|'missed'|'future', totalSec, goalSec }
//   status 语义见文件头注释。totalSec=当天有效专注秒数;goalSec=门槛秒数。
export function evaluateDay(sessions, date, dailyGoalMinutes = DEFAULT_DAILY_GOAL_MINUTES, now = new Date()) {
  const goalSec = Math.max(0, Number(dailyGoalMinutes) || 0) * 60
  const dk = dateKey(date)
  const todayK = dateKey(now)
  // 未来日期:不判定(返回 future,UI 显示为空/不可点)
  if (dk > todayK) {
    return { status: 'future', totalSec: 0, goalSec }
  }
  const totalSec = dayFocusSec(sessions, date)
  let status
  if (totalSec <= 0) status = 'missed'        // 没学→缺勤
  else if (totalSec >= goalSec) status = 'done' // 达标→成功
  else status = 'partial'                       // 学了但不够→部分
  return { status, totalSec, goalSec }
}

// 生成某月的打卡日历数据(供日历热力图用)。
// 返回 { days: [{date: Date, key, day, status, totalSec}], monthLabel, stats }
//   days 含本月1号到月末每一天(补齐周一起始的空白前置);status 含 future(未到日期)。
//   stats 汇总:doneCount(成功天数)/partialCount/streak(截至今天/月末的连续)
// 周一起始(周一=0,周日=6),与国人对"一周"的直觉一致。
export function calendarMonth(sessions, year, month, dailyGoalMinutes = DEFAULT_DAILY_GOAL_MINUTES, now = new Date()) {
  const days = []
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)   // 月末(0号=上月最后一天)
  const daysInMonth = lastDay.getDate()
  // 前置空白:本月1号是周几(周一起始)。getDay() 周日=0..周六=6,转成周一=0..周日=6
  const leadBlanks = (firstDay.getDay() + 6) % 7
  for (let i = 0; i < leadBlanks; i++) days.push(null)   // null=占位空格
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day)
    const ev = evaluateDay(sessions, d, dailyGoalMinutes, now)
    days.push({ date: d, key: dateKey(d), day, status: ev.status, totalSec: ev.totalSec })
  }
  // 月统计(只统计已过去的日期,future 不算)
  const pastDays = days.filter(d => d && d.status !== 'future')
  const doneCount = pastDays.filter(d => d.status === 'done').length
  const partialCount = pastDays.filter(d => d.status === 'partial').length
  return {
    days,
    monthLabel: `${year}年${month + 1}月`,
    stats: { doneCount, partialCount, missedCount: pastDays.length - doneCount - partialCount },
  }
}

// 计算连续打卡天数(截至 now 当天,含当天若达标)。
// 规则:从今天往回数,遇到 'done' 连续+1,遇到非 done(未来/部分/缺勤)即停。
//   注:今天还没结束,若未达标不算中断(今天还没过完不算缺勤)。
//   具体处理:今天若 future 或部分/缺勤,不影响"已连续的"统计(从昨天起算)。
export function checkinStreak(sessions, dailyGoalMinutes = DEFAULT_DAILY_GOAL_MINUTES, now = new Date()) {
  let streak = 0
  // 从今天往回数。今天:若达标则计入并继续;若未达标,今天不算中断,从昨天起算。
  // 用一个 flag 标记是否已经"开始计数"(遇到第一个非未来日期后就开始)
  const todayK = dateKey(now)
  let started = false
  for (let i = 0; i < 366; i++) {   // 最多回溯一年
    const d = new Date(now.getTime() - i * 86400000)
    const k = dateKey(d)
    if (k > todayK) continue   // 理论不会出现,防御
    const ev = evaluateDay(sessions, d, dailyGoalMinutes, now)
    if (ev.status === 'future') continue   // 未来日期跳过(理论上 i=0 时今天不是 future)
    if (ev.status === 'done') {
      streak += 1
      started = true
    } else {
      // 今天(i=0)未达标:不算中断,继续看昨天(今天还没过完)
      if (i === 0) continue
      // 其余任何非 done(含 future 理论不出现):立即中断连续。
      // (2026-06-25 小码审核修正:原逻辑"还没开始计数就继续往前找done"会导致
      //  今天缺勤+昨天缺勤+前天达标 错误返回2,应返回0。)
      break
    }
  }
  return streak
}
