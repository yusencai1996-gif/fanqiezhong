// 统计聚合:纯函数,输入 sessions/tasks,输出报表数据。
// 统计口径:专注且 status ∈ {完成, 提前结束, 异常中断} 都算有效专注(跳过不算)。
// 注:判定函数已收口到 date.js(v0.3.8 抽取,消除重复副本)。

import { isValidFocus, isSameDay, dateKey } from './date.js'

export function summarizeToday(sessions, now = new Date()) {
  const todaySessions = sessions.filter(
    s => isValidFocus(s) && isSameDay(s.startedAt, now)
  )
  const totalSec = todaySessions.reduce((sum, s) => sum + s.durationSec, 0)
  return { totalSec, count: todaySessions.length }
}

export function topTasks(sessions, tasks) {
  // 聚合每个 taskId 的专注总时长。title 优先用 session 自带的 taskName 快照(防任务删除后显示"已删除")
  const totalMap = new Map()    // taskId → 总时长
  const nameMap = new Map()     // taskId → taskName 快照(取第一个非空)
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (!s.taskId) continue
    totalMap.set(s.taskId, (totalMap.get(s.taskId) || 0) + s.durationSec)
    if (!nameMap.has(s.taskId) && s.taskName) nameMap.set(s.taskId, s.taskName)
  }
  const result = []
  for (const [id, totalSec] of totalMap.entries()) {
    // title 取值优先级:session 快照名 > 当前任务名 > 兜底
    const title = nameMap.get(id)
      || (tasks.find(t => t.id === id)?.title)
      || '(已删除)'
    result.push({ id, title, totalSec })
  }
  return result.sort((a, b) => b.totalSec - a.totalSec)
}

// 近 N 天每日专注时长趋势(供统计图表用)
// 返回 [{key:'YYYY-MM-DD', label:'周一', totalSec, count}],按日期升序
export function dailyTrend(sessions, days = 7, now = new Date()) {
  const buckets = []
  const dayMs = 86400000
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * dayMs)
    buckets.push({
      key: dateKey(d), label: weekdayLabel(d), totalSec: 0, count: 0,
    })
  }
  const bucketMap = new Map(buckets.map(b => [b.key, b]))
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    const k = dateKey(new Date(s.startedAt))
    const b = bucketMap.get(k)
    if (b) { b.totalSec += s.durationSec; b.count += 1 }
  }
  return buckets
}

// 本月每日专注趋势(当月1号到今天,每天一桶)
// 返回 [{key, label:'几号', totalSec, count}]
export function monthlyTrend(sessions, now = new Date()) {
  const year = now.getFullYear(), month = now.getMonth()
  const today = now.getDate()
  const buckets = []
  for (let day = 1; day <= today; day++) {
    const d = new Date(year, month, day)
    buckets.push({
      key: dateKey(d), label: String(day), totalSec: 0, count: 0,
    })
  }
  const bucketMap = new Map(buckets.map(b => [b.key, b]))
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    const k = dateKey(new Date(s.startedAt))
    const b = bucketMap.get(k)
    if (b) { b.totalSec += s.durationSec; b.count += 1 }
  }
  return buckets
}

// 本年每月专注趋势(1-12月,每月一桶)
// 返回 [{key:'YYYY-MM', label:'几月', totalSec, count}]
export function yearlyTrend(sessions, now = new Date()) {
  const year = now.getFullYear()
  const buckets = []
  for (let m = 0; m < 12; m++) {
    buckets.push({
      key: `${year}-${String(m + 1).padStart(2, '0')}`,
      label: `${m + 1}月`,
      totalSec: 0, count: 0,
    })
  }
  const bucketMap = new Map(buckets.map(b => [b.key, b]))
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    const d = new Date(s.startedAt)
    if (d.getFullYear() !== year) continue   // 只统计本年
    const k = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const b = bucketMap.get(k)
    if (b) { b.totalSec += s.durationSec; b.count += 1 }
  }
  return buckets
}

// dateKey 已收口到 date.js(顶部 import)

function weekdayLabel(d) {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[d.getDay()]
}

