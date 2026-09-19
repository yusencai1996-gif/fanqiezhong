// 公共日期/判定工具(单一真相源)。stats.js / planning.js / checkin.js 共用。
// 抽取自原 stats.js 和 planning.js 的私有副本(v0.3.8 收口,消除三套不一致实现)。

// 日期 key:YYYY-MM-DD。输入 Date 或可解析时间字符串。
export function dateKey(d) {
  if (!(d instanceof Date)) d = new Date(d)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 有效专注判定:专注且 status ∈ {完成, 提前结束, 异常中断} 都算(跳过/休息不算)。
// '异常中断'是 v0.3.7 闪退恢复产生的记录,按已专注时长计入(用户已实际投入时间)。
export function isValidFocus(s) {
  return s.type === '专注' && (s.status === '完成' || s.status === '提前结束' || s.status === '异常中断')
}

// 同一天判定(容忍 Date 或 ISO 字符串)。
export function isSameDay(a, b) {
  const d1 = new Date(a), d2 = new Date(b)
  return d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate()
}

// 距某 deadline 还剩多少天(v0.3.13 倒计时)。
// 算法:deadline 当天 23:59:59 - now,按天向上取整。
// 返回:正数=还剩N天;0=今天到期;负数=已超期N天。
// deadline 格式 'YYYY-MM-DD' 或 ISO 或 null。null→返回 null(无截止日)。
export function daysUntil(deadline, now = new Date()) {
  if (!deadline) return null
  const dl = new Date(deadline)
  if (isNaN(dl.getTime())) return null
  // deadline 当天 23:59:59
  const dlEnd = new Date(dl.getFullYear(), dl.getMonth(), dl.getDate(), 23, 59, 59)
  const diffMs = dlEnd - now
  // 向上取整(剩2.1天→3天;剩0.1天→1天=今天;已过→负数)
  return Math.ceil(diffMs / 86400000)
}
