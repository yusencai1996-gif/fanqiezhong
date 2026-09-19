// 计划与每日分配:纯函数(可单测)。
// 核心算法:今天应学 = (总时长 - 已完成) ÷ 剩余天数(含今天);手动覆盖优先;超期/已完成返回0。
// 注:v0.3.7 起'异常中断'(闪退恢复)也计入已完成专注。判定函数已收口到 date.js(v0.3.8)。

import { isValidFocus, dateKey } from './date.js'

// 计划已完成时长(小时) = 该计划归属科目的 session 专注秒数之和 / 3600
// session 经 subjectId 归属科目(快照),plan.subjectId 指向科目。
//
// ⚠️ v0.4.0 语义说明(科目级粒度,非计划级):
// session 只记录 subjectId(科目),不记录 planId(计划)。因此本函数返回的是
// "该计划所属科目的总投入时长",而非"该计划独占的时长"。当同一科目被多个计划共享时,
// 每个计划都会拿到相同的科目总投入——这是设计边界(session 粒度=科目),不是重复计算 bug。
// 目标总进度(goalProgress)已按 subject 去重,不受此边界影响;仅"单计划进度条/预测/燃尽图"
// 会显示科目级数据,UI 已(v0.4.0)标注"科目投入"以澄清语义。
export function planDoneHours(sessions, plan) {
  let sec = 0
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (s.subjectId === plan.subjectId) sec += s.durationSec
  }
  return sec / 3600
}

// 某科目"今天"已学时长(小时)。v0.3.9.1:供今日计划面板显示"今日已学"。
// 按 subjectId + 今天日期过滤有效专注。同科目多计划会显示相同的今日已学(符合"科目今日投入"语义)。
export function subjectTodayHours(sessions, subjectId, now = new Date()) {
  const today = dateKey(now)
  let sec = 0
  for (const s of sessions) {
    if (!isValidFocus(s)) continue
    if (s.subjectId !== subjectId) continue
    if (dateKey(s.startedAt) === today) sec += s.durationSec
  }
  return sec / 3600
}

// 计划今天应学(小时)
// v0.4.0 修复:终态(已完成/超期)优先于手动覆盖——计划已结束就不应再"应学",
// 即使当天有手动覆盖值也返回 0(防"完成/超期的计划仍显示应学"的语义错乱)。
// 注意:"无截止日"不是终态(计划仍在进行),用户可设手动覆盖,故无截止日判断在手动覆盖之后。
export function planTodayHours(sessions, plan, now = new Date()) {
  const today = dateKey(now)
  const done = planDoneHours(sessions, plan)
  // 1. 已完成 >= 总 → 0(终态优先,即使有手动覆盖也返回0)
  if (done >= plan.totalHours) return 0
  // 2. 超期(deadline 早于今天) → 0(终态优先,即使有手动覆盖也返回0)
  //    无截止日计划不进此分支(deadline 为空字符串/null 时跳过)
  if (plan.deadline) {
    const deadlineDate = new Date(plan.deadline + 'T23:59:59')
    if (now > deadlineDate) return 0
  }
  // 3. 手动覆盖优先(未到终态时生效;无截止日计划也走这里——用户想手动设今天就学多少)
  if (plan.manualDaily && Object.prototype.hasOwnProperty.call(plan.manualDaily, today)) {
    return plan.manualDaily[today]
  }
  // 4. 无截止日 → 0(没手动覆盖就无法自动分配)
  if (!plan.deadline) return 0
  // 5. 自动分配:(总-已完成) ÷ 剩余天数(含今天)
  const deadlineDate = new Date(plan.deadline + 'T23:59:59')
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const deadlineStart = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate())
  const remainDays = Math.round((deadlineStart - todayStart) / 86400000) + 1   // +1 含今天
  if (remainDays <= 0) return 0
  return (plan.totalHours - done) / remainDays
}

// 今日所有进行中计划汇总
// 返回 [{ plan, todayHours, doneHours, totalHours, isOverdue }]
// v0.4.2:新增 subjects 参数——排除已归档科目下的计划(归档目标会级联归档科目但不动计划,
// 计划自身 archived 保持 false,必须在这里按科目过滤;科目找不到=已彻底删除,同样排除)。
// 不传 subjects(老调用)不过滤,保持向后兼容。注意第 3 参历史上曾是 now——用
// Array.isArray 判断(而非真值),老式 3 参调用传 Date 进来时走不过滤分支而非崩溃。
export function todayPlanSummary(sessions, plans, subjects = null, now = new Date()) {
  const result = []
  for (const plan of plans) {
    if (plan.status !== '进行中' || plan.archived) continue
    if (Array.isArray(subjects)) {
      const subj = subjects.find(s => s.id === plan.subjectId)
      if (!subj || subj.archived) continue
    }
    const todayHours = planTodayHours(sessions, plan, now)
    const doneHours = planDoneHours(sessions, plan)
    const todayDoneHours = subjectTodayHours(sessions, plan.subjectId, now)   // v0.3.9.1:今日该科目已学
    const deadlineDate = plan.deadline ? new Date(plan.deadline + 'T23:59:59') : null
    const isOverdue = deadlineDate && now > deadlineDate
    // 剩余天数(供UI显示)
    let remainDays = null
    if (deadlineDate) {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const deadlineStart = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate())
      remainDays = Math.round((deadlineStart - todayStart) / 86400000) + 1
    }
    result.push({ plan, todayHours, doneHours, todayDoneHours, totalHours: plan.totalHours, isOverdue, remainDays })
  }
  return result
}
