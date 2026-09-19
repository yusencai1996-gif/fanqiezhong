// 进度预测:纯函数(可单测)。
// 阶段4(v0.3.9):目标总进度 + 完成预测(双速率) + 燃尽图。
// 精度:科目级(session 无 planId,按 subjectId 归集,非计划级)。
// 依赖:date.js 的 isValidFocus / dateKey。

import { isValidFocus, dateKey } from './date.js'

const DAY_MS = 86400000

// 某科目的有效专注总秒数(去重:每个 session 只计一次,天然成立因按 subjectId 归集)。
// ⚠️ v0.4.0 语义说明:返回的是"该科目总投入",session 粒度=科目(无 planId)。
// 多计划共享同一科目时,每个计划都看到相同的科目总投入——设计边界,非 bug。
export function subjectDoneSec(sessions, subjectId) {
  let sec = 0
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (s.subjectId === subjectId) sec += s.durationSec
  }
  return sec
}

// 目标级进度汇总(防多计划算重:按 subject 聚合 done,分母用该目标下各 plan.totalHours 求和)。
// 返回 { doneHours, totalHours, pct, subjects: [{subject, doneHours, totalHours, pct}] }
//   - 分母 totalHours:该目标下所有「进行中且未归档」计划的 totalHours 之和
//   - 分子 doneHours:该目标下各 subject 的有效专注(按 subject 聚合,不重复)
export function goalProgress(sessions, subjects, plans, goalId, now = new Date()) {
  const goalSubjects = subjects.filter(s => s.goalId === goalId && !s.archived)
  const activePlans = (plans || []).filter(p =>
    p.subjectId && goalSubjects.some(s => s.id === p.subjectId)
    && p.status !== '已归档' && !p.archived
  )
  // 分母:各科目的计划总时长求和(同科目多计划会累加,符合"该科目总目标")
  const subjectTotals = new Map()   // subjectId → totalHours
  for (const p of activePlans) {
    subjectTotals.set(p.subjectId, (subjectTotals.get(p.subjectId) || 0) + p.totalHours)
  }
  // 科目行:只保留"有计划"的科目(totalHours>0)。
  // 小码审核H2:若把无计划科目也计入,其done会被加进分子但分母是0 → pct虚高 + UI显示X/0h(语义错)。
  // 无计划但学过的科目属于"还没规划",不计入目标完成度。
  const subjectRows = goalSubjects
    .filter(sub => (subjectTotals.get(sub.id) || 0) > 0)
    .map(sub => {
      const doneSec = subjectDoneSec(sessions, sub.id)
      const doneHours = doneSec / 3600
      const totalHours = subjectTotals.get(sub.id) || 0
      const pct = totalHours > 0 ? Math.min(100, Math.round(doneHours / totalHours * 100)) : 0
      return { subject: sub, doneHours, totalHours, pct }
    })
  const doneHours = subjectRows.reduce((s, r) => s + r.doneHours, 0)
  const totalHours = subjectRows.reduce((s, r) => s + r.totalHours, 0)
  const pct = totalHours > 0 ? Math.min(100, Math.round(doneHours / totalHours * 100)) : 0
  return { doneHours, totalHours, pct, subjects: subjectRows }
}

// 近 N 天日均专注小时数(滚动,只看该 subject)。
// 只统计"有记录"的天数均值?还是含0的日均?——这里用「含0的日均」(N天里有X天学,Y天没学,
//   速率 = 总学时 / N),更贴近"真实推进速度"(没学的天也占时间)。
// 若该 subject 近 N 天完全没学 → 返回 0。
export function recentRate(sessions, subjectId, days = 7, now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let totalSec = 0
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (s.subjectId !== subjectId) continue
    const d = new Date(s.startedAt)
    const diffDays = (todayStart - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY_MS
    if (diffDays >= 0 && diffDays < days) totalSec += s.durationSec
  }
  return totalSec / 3600 / days   // 小时/天
}

// 自某日期起的总平均日速率(计划至今)。
// sinceDate 之前的 session 不算。返回小时/天。若不足1天按1天算(防除0)。
// 若该 subject 自 since 起完全没学 → 返回 0。
export function overallRate(sessions, subjectId, sinceDate, now = new Date()) {
  if (!sinceDate) return 0
  const since = new Date(sinceDate)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sinceStart = new Date(since.getFullYear(), since.getMonth(), since.getDate())
  let days = Math.round((todayStart - sinceStart) / DAY_MS) + 1   // +1 含今天
  if (days < 1) days = 1
  let totalSec = 0
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (s.subjectId !== subjectId) continue
    if (new Date(s.startedAt) >= sinceStart) totalSec += s.durationSec
  }
  return totalSec / 3600 / days
}

// 预测完成日期:今天 + 剩余时长 / 速率。
// 速率≤0(没在学)或剩余≤0(已完成)→ 返回 null。
// now 可注入(便于单测);默认当前时间。
export function predictFinishDate(remainingHours, ratePerDay, now = new Date()) {
  if (!ratePerDay || ratePerDay <= 0) return null
  if (remainingHours <= 0) return null   // 已完成不应预测(小码审核H4)
  const daysNeeded = remainingHours / ratePerDay
  const finish = new Date(now.getTime() + Math.ceil(daysNeeded) * DAY_MS)   // 用注入的now(小码审核H1)
  return finish
}

// 单个计划的预测汇总(供 UI 直接渲染)。
// ⚠️ v0.4.0 语义说明:doneHours 基于 subjectDoneSec,是"该计划所属科目的总投入"(科目级),
// 非"该计划独占"。多计划共享科目时各计划 doneHours 相同——设计边界,UI 已标注"科目投入"。
// 返回 { plan, doneHours, remainingHours, deadline, predictRecent, predictOverall,
//        rateRecent, rateOverall, status }
//   status: 'on-track'(预测早于截止) | 'behind'(预测晚于截止) | 'no-data'(速率0无法预测) | 'done'(已完成) | 'no-deadline'(无截止日)
export function planForecast(sessions, plan, now = new Date()) {
  const doneHours = subjectDoneSec(sessions, plan.subjectId) / 3600
  const remainingHours = Math.max(0, plan.totalHours - doneHours)
  const rateRecent = recentRate(sessions, plan.subjectId, 7, now)
  const rateOverall = plan.createdAt ? overallRate(sessions, plan.subjectId, plan.createdAt, now) : 0
  const predictRecent = predictFinishDate(remainingHours, rateRecent, now)
  const predictOverall = plan.createdAt ? predictFinishDate(remainingHours, rateOverall, now) : null

  let status
  if (remainingHours <= 0) status = 'done'
  else if (!plan.deadline) status = 'no-deadline'
  else if (!predictRecent && !predictOverall) status = 'no-data'
  else {
    // 用近7天速率优先判断(更贴近现状);无近7天则用总平均
    const predict = predictRecent || predictOverall
    const dl = new Date(plan.deadline + 'T23:59:59')
    status = predict <= dl ? 'on-track' : 'behind'
  }

  return {
    plan, doneHours, remainingHours,
    deadline: plan.deadline,
    predictRecent, predictOverall,
    rateRecent, rateOverall,
    status,
  }
}

// 燃尽图数据(科目级,因 session 无 planId)。
// ⚠️ v0.4.0 语义说明:"实际线"反映的是该科目总投入的累计,非该计划独占。
// 多计划共享科目时,各计划燃尽图的实际线相同——设计边界,UI 已标注"该科目剩余投入"。
// 理想线:从(createdAt, totalHours)线性降到(deadline, 0)。无 createdAt 则从今天起。
// 实际线:剩余量按天累计 = totalHours - (截至该天的累计已完成小时)。
// 返回 { ideal: [{date, remaining}], actual: [{date, remaining}], startDate, endDate, totalHours }
//   采样:按天(跨度>60天则按周聚合,避免点太多)。date 为 'YYYY-MM-DD',remaining 为小时数。
export function burndownData(sessions, plan, now = new Date()) {
  const totalHours = plan.totalHours
  const start = plan.createdAt ? new Date(plan.createdAt) : new Date(now.getTime() - 30 * DAY_MS)
  const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const end = plan.deadline ? new Date(plan.deadline) : new Date(now.getTime() + 30 * DAY_MS)
  const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate())

  // 跨度>60天 → 按周采样
  const totalDays = Math.round((endDate - startDate) / DAY_MS) + 1
  const stepDays = totalDays > 60 ? 7 : 1

  // 实际线:先按天累计该 subject 的已完成小时,生成 dailyCumMap[dateKey]=累计小时
  const dailyCum = new Map()   // dateKey → 当天专注秒
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (s.subjectId !== plan.subjectId) continue
    const d = new Date(s.startedAt)
    const k = dateKey(d)
    dailyCum.set(k, (dailyCum.get(k) || 0) + s.durationSec)
  }
  // 排序日期键,算前缀和
  const sortedKeys = [...dailyCum.keys()].sort()
  const cumHoursByDate = new Map()   // dateKey → 截至该天累计小时
  let cumSec = 0
  for (const k of sortedKeys) {
    cumSec += dailyCum.get(k)
    cumHoursByDate.set(k, cumSec / 3600)
  }

  const ideal = []
  const actual = []
  // 理想线:线性下降。采样点包含 start/end。
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + stepDays)) {
    const k = dateKey(d)
    const elapsedDays = Math.round((d - startDate) / DAY_MS)
    const ratio = totalDays > 1 ? elapsedDays / (totalDays - 1) : 1
    ideal.push({ date: k, remaining: Math.max(0, totalHours * (1 - ratio)) })
  }
  // 实际线:遍历采样点,剩余 = total - 截至该天累计(只画到今天及之前,未来不画)
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayKey = dateKey(todayDate)
  for (let d = new Date(startDate); d <= todayDate; d.setDate(d.getDate() + stepDays)) {
    const k = dateKey(d)
    // 找截至该天最近的一个累计值(当天没学则用上一个已知累计)
    let cumH = 0
    for (const [dk, v] of cumHoursByDate) {
      if (dk <= k) cumH = v
    }
    actual.push({ date: k, remaining: Math.max(0, totalHours - cumH) })
  }
  // 小码审核H3:stepDays=7按周采样时,最后采样点最多落在今天前6天,实际线看着像"停了一周"。
  // 循环退出后补一个"今天点",确保实际线终点始终是今天。
  if (actual.length === 0 || actual[actual.length - 1].date !== todayKey) {
    let cumH = 0
    for (const [dk, v] of cumHoursByDate) {
      if (dk <= todayKey) cumH = v
    }
    actual.push({ date: todayKey, remaining: Math.max(0, totalHours - cumH) })
  }

  return { ideal, actual, startDate: dateKey(startDate), endDate: dateKey(endDate), totalHours, stepDays }
}
