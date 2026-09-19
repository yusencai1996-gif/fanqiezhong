// 时长格式化:统一收口(P1-6)。四个组件(Timer/Widget/StatsPanel/TodaySummary)共用。

// 时钟格式 MM:SS(用于倒计时显示)
export function fmtClock(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// 时长格式 X分 / X时X分(用于统计、概览显示)
export function fmtDuration(sec) {
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}分`
  return `${Math.floor(m / 60)}时${m % 60}分`
}

// 紧凑小时数:输入小时数(小数),输出"X分"(不足1h) 或 "X.Xh"(≥1h)。
// v0.3.9.2 小码审核#2:统一各面板的小时数显示(原来3套混用)。
// 用于今日应学/已学、计划时长等紧凑场景。整时去掉小数(2.0h→"2h")。
export function fmtHours(hours) {
  if (!hours || hours <= 0) return '0h'
  if (hours < 1) return `${Math.round(hours * 60)}分`
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
}
