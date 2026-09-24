import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import persistModule from '../electron/persist.js'

const { createPersist } = persistModule

// v0.5.0 两审阻断项整改配套:损坏自愈 + 原子写
describe('persist: 损坏自愈与原子写', () => {
  let dir, file, io
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-persist-'))
    file = path.join(dir, 'data.json')
    io = createPersist({ getDataFile: () => file })
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('正常读写往返', () => {
    expect(io.writeState({ a: 1 })).toBe(true)
    expect(io.readState()).toEqual({ a: 1 })
  })

  it('文件不存在:返回 null(新用户首次启动)', () => {
    expect(io.readState()).toBeNull()
  })

  it('损坏文件:返回 null 且原文件改名备份(自愈,不再静默拒绝一切写入)', () => {
    fs.writeFileSync(file, '{ 截断的垃圾', 'utf-8')
    expect(io.readState()).toBeNull()
    const backups = fs.readdirSync(dir).filter(n => n.startsWith('data.json.corrupt-'))
    expect(backups).toHaveLength(1)
  })

  it('v0.5.0 复审B1:普通 IO 错误(非损坏)必须抛错,不得伪装成"无数据"', () => {
    // 用目录路径当数据文件:existsSync 为真、readFileSync 抛 EISDIR(模拟占用/权限类临时故障)
    fs.mkdirSync(file)
    expect(() => io.readState()).toThrow()
  })

  it('0 字节文件(掉电场景)自愈后可重新写入', () => {
    fs.writeFileSync(file, '', 'utf-8')
    expect(io.readState()).toBeNull()
    expect(io.writeState({ fresh: true })).toBe(true)
    expect(io.readState()).toEqual({ fresh: true })
  })

  it('原子写:写入后目录里只有 data.json,无临时文件残留', () => {
    io.writeState({ a: 1 })
    expect(fs.readdirSync(dir)).toEqual(['data.json'])
  })
})
