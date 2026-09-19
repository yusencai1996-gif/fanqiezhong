import { describe, it, expect } from 'vitest'
import { createTimer } from '../src/features/timer.js'

// 注:now() 返回毫秒(与 Date.now() 语义一致),"过了N秒"= N*1000
describe('timer', () => {
  it('初始状态为停止,剩余=总时长', () => {
    const t = createTimer({ totalSec: 1500, now: () => 1000000 })
    expect(t.getStatus()).toBe('stopped')
    expect(t.getRemainingSec()).toBe(1500)
  })

  it('启动后随时间推进,剩余减少', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })
    t.start()
    clock = 1000000 + 30000   // 过了 30 秒
    expect(t.getRemainingSec()).toBe(1470)
  })

  it('暂停时剩余冻结', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })
    t.start()
    clock = 1000000 + 300000   // 过了 300 秒=5分钟,剩 1200
    t.pause()
    clock = 9999999   // 暂停期间时间流逝
    expect(t.getRemainingSec()).toBe(1200)
  })

  it('恢复后继续从冻结点走', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })
    t.start()
    clock = 1000000 + 300000
    t.pause()                  // 冻结在剩 1200
    clock = 5000000
    t.resume()
    clock = 5000000 + 60000    // 恢复后过 60 秒
    expect(t.getRemainingSec()).toBe(1140)  // 1200 - 60
  })

  it('剩余到 0 时状态为完成,且不为负', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 100, now: () => clock })
    t.start()
    clock = 1000000 + 4000000   // 过了 4000 秒,远超
    expect(t.getStatus()).toBe('finished')
    expect(t.getRemainingSec()).toBe(0)
  })

  it('跳过直接结束', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })
    t.start()
    t.skip()
    expect(t.getStatus()).toBe('finished')
  })

  it('重置回到 stopped,剩余=总时长', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })
    t.start()
    clock = 1000000 + 300000
    t.reset()
    expect(t.getStatus()).toBe('stopped')
    expect(t.getRemainingSec()).toBe(1500)
  })

  it('改总时长在停止态生效', () => {
    const t = createTimer({ totalSec: 1500, now: () => 1000000 })
    t.setTotalSec(2700)
    expect(t.getRemainingSec()).toBe(2700)
  })

  // === 回归测试:审核发现的 skip 态清理一致性 ===
  it('skip 后 reset 能回到 stopped,允许重新 start', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })
    t.start()
    clock += 100000   // 过了 100 秒
    t.skip()
    expect(t.getStatus()).toBe('finished')
    // 卡死 bug 修复:skip 后能 reset 解锁
    t.reset()
    expect(t.getStatus()).toBe('stopped')
    expect(t.getRemainingSec()).toBe(1500)
    // 解锁后能正常重新开始
    t.start()
    clock += 30000    // 再过 30 秒
    expect(t.getRemainingSec()).toBe(1470)
  })

  it('skip 清零 accumulatedMs,不污染实例复用', () => {
    // 模拟第一轮 skip 后,实例若被复用(未重建),剩余时间应正确
    let clock = 1000000
    const t = createTimer({ totalSec: 100, now: () => clock })
    t.start()
    clock += 40000    // 过 40 秒
    t.skip()
    // skip 清零后,即便实例直接复用,setTotalSec 后从干净态开始
    t.reset()
    t.setTotalSec(200)
    t.start()
    clock += 20000    // 过 20 秒
    expect(t.getRemainingSec()).toBe(180)  // 200-20,不应残留旧值
  })

  // === 建议2:中途结束按实际时间记录,getElapsedSec 返回已专注秒数 ===
  it('getElapsedSec 返回已专注的实际秒数(供中途结束记录用)', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 1500, now: () => clock })  // 25分钟
    expect(t.getElapsedSec()).toBe(0)   // 没开始
    t.start()
    clock += 1200000   // 过了 20 分钟(1200秒)
    expect(t.getElapsedSec()).toBe(1200)   // 已专注20分钟
    expect(t.getRemainingSec()).toBe(300)  // 还剩5分钟
  })

  it('getElapsedSec 不超过总时长(到点后等于总时长)', () => {
    let clock = 1000000
    const t = createTimer({ totalSec: 60, now: () => clock })
    t.start()
    clock += 999999   // 远超
    expect(t.getElapsedSec()).toBe(60)   // 封顶为总时长,不溢出
  })

  it('v0.4.1: getTotalSec 返回实例总时长(reset后不变,供重建判定用)', () => {
    const t = createTimer({ totalSec: 1500 })
    expect(t.getTotalSec()).toBe(1500)
    t.start()
    t.reset()
    expect(t.getTotalSec()).toBe(1500)   // reset 不改 durationSec
  })
})
