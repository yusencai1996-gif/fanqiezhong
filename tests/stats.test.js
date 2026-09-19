import { describe, it, expect } from 'vitest'
import { summarizeToday, topTasks, dailyTrend, monthlyTrend, yearlyTrend } from '../src/features/stats.js'

describe('stats', () => {
  const today = new Date(); today.setHours(10, 0, 0, 0)
  const yesterday = new Date(Date.now() - 86400000); yesterday.setHours(10,0,0,0)
  const sessions = [
    { type: '专注', durationSec: 1500, status: '完成', startedAt: today.toISOString(), taskId: 't1' },
    { type: '专注', durationSec: 900, status: '完成', startedAt: today.toISOString(), taskId: 't2' },
    { type: '专注', durationSec: 1500, status: '完成', startedAt: yesterday.toISOString(), taskId: 't1' },
    { type: '休息', durationSec: 300, status: '完成', startedAt: today.toISOString(), taskId: null },
  ]

  it('今日概览只统计今天的专注', () => {
    const s = summarizeToday(sessions)
    expect(s.totalSec).toBe(2400)
    expect(s.count).toBe(2)
  })

  it('topTasks 按任务聚合时长并排序', () => {
    const top = topTasks(sessions, [{ id: 't1', title: '写报告' }, { id: 't2', title: '回邮件' }])
    expect(top[0]).toEqual({ id: 't1', title: '写报告', totalSec: 3000 })
    expect(top[1]).toEqual({ id: 't2', title: '回邮件', totalSec: 900 })
  })

  it('topTasks 用 session 的 taskName 快照:任务删除后显示原名不显示"已删除"', () => {
    // session 带 taskName 快照,但 tasks 列表已不含该任务(已删)
    const sess = [
      { type: '专注', durationSec: 1500, status: '完成', startedAt: new Date().toISOString(), taskId: 'old1', taskName: '高数第三章' },
      { type: '专注', durationSec: 900, status: '完成', startedAt: new Date().toISOString(), taskId: 'old1', taskName: '高数第三章' },
    ]
    const top = topTasks(sess, [])   // tasks 空(都删了)
    expect(top[0].title).toBe('高数第三章')   // 显示快照原名,不是"(已删除)"
    expect(top[0].totalSec).toBe(2400)
  })

  it('dailyTrend 返回近7天,今天和昨天有数据', () => {
    const trend = dailyTrend(sessions, 7)
    expect(trend).toHaveLength(7)
    expect(trend[6].totalSec).toBe(2400)
    expect(trend[5].totalSec).toBe(1500)
    expect(trend[0].totalSec).toBe(0)
    expect(trend[0].label).toBeTruthy()
    expect(trend[0].key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('dailyTrend 不统计休息', () => {
    const trend = dailyTrend(sessions, 7)
    expect(trend[6].totalSec).toBe(2400)  // 不含 300 秒休息
  })
})

// 提前结束 也应算有效专注(v0.2.3 新增口径)
describe('stats: 提前结束口径', () => {
  it('summarizeToday 把提前结束也计入', () => {
    const today = new Date(); today.setHours(10,0,0,0)
    const s = [{ type: '专注', durationSec: 1200, status: '提前结束', startedAt: today.toISOString(), taskId: 't1' }]
    const r = summarizeToday(s)
    expect(r.totalSec).toBe(1200)
    expect(r.count).toBe(1)
  })

  it('topTasks 把提前结束也计入', () => {
    const s = [{ type: '专注', durationSec: 1200, status: '提前结束', startedAt: new Date().toISOString(), taskId: 't1' }]
    const top = topTasks(s, [{ id: 't1', title: 'A' }])
    expect(top[0].totalSec).toBe(1200)
  })

  it('跳过 不计入', () => {
    const s = [{ type: '专注', durationSec: 600, status: '跳过', startedAt: new Date().toISOString(), taskId: 't1' }]
    expect(summarizeToday(s).totalSec).toBe(0)
    expect(topTasks(s, [{ id: 't1', title: 'A' }])).toHaveLength(0)
  })
})

// 月/年趋势
describe('stats: 月/年趋势', () => {
  it('monthlyTrend 返回当月1号到今天,每天一桶', () => {
    const now = new Date()
    const trend = monthlyTrend([])
    expect(trend.length).toBe(now.getDate())   // 今天是几号就有几桶
    expect(trend[0].label).toBe('1')           // 第一桶是1号
    expect(trend[trend.length - 1].label).toBe(String(now.getDate()))
    expect(trend[0].key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('monthlyTrend 聚合每天的专注', () => {
    const now = new Date()
    const s = [
      { type: '专注', durationSec: 1500, status: '完成', startedAt: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), taskId: 't1' },
      { type: '专注', durationSec: 900, status: '完成', startedAt: new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString(), taskId: 't1' },
    ]
    const trend = monthlyTrend(s)
    expect(trend[0].totalSec).toBe(2400)   // 1号:1500+900
    expect(trend[0].count).toBe(2)
  })

  it('yearlyTrend 返回12个月桶,只统计本年', () => {
    const now = new Date()
    const thisYear = now.getFullYear()
    const s = [
      { type: '专注', durationSec: 1500, status: '完成', startedAt: new Date(thisYear, 0, 15).toISOString(), taskId: 't1' },  // 今年1月
      { type: '专注', durationSec: 900, status: '完成', startedAt: new Date(thisYear - 1, 0, 15).toISOString(), taskId: 't1' }, // 去年1月(不算)
    ]
    const trend = yearlyTrend(s)
    expect(trend).toHaveLength(12)
    expect(trend[0].label).toBe('1月')
    expect(trend[0].totalSec).toBe(1500)   // 只有今年1月
    expect(trend[0].count).toBe(1)
    // 去年的不被统计(其他月都是0)
    const totalYear = trend.reduce((sum, b) => sum + b.totalSec, 0)
    expect(totalYear).toBe(1500)
  })
})
