import { describe, it, expect, vi } from 'vitest'
import stateModule from '../electron/ai-state.js'

const { createStateGateway } = stateModule
const KEY = 'sk-test-12345678'

function fixture(initial = { schemaVersion: 10, settings: { workMinutes: 25, aiConfig: { apiKey: KEY, model: 'deepseek-flash' } }, sessions: [] }) {
  let disk = initial
  let writes = 0
  let failWrite = false
  // structuredClone:模拟"每次读取都是独立快照",让"旧快照不覆盖新配置"类断言真正生效(v0.5.0 初审)
  const gateway = createStateGateway({ readState: () => structuredClone(disk), writeState: value => { writes++; if (failWrite) return false; disk = value; return true } })
  return { gateway, get disk() { return disk }, get writes() { return writes }, set failWrite(value) { failWrite = value } }
}

describe('AI state gateway', () => {
  it('redacts renderer load without mutating disk data', () => {
    const f = fixture()
    const loaded = f.gateway.loadForRenderer()
    expect(loaded.settings.aiConfig.apiKey).toBe('')
    expect(f.disk.settings.aiConfig.apiKey).toBe(KEY)
    expect(loaded.settings.aiConfig).not.toBe(f.disk.settings.aiConfig)
  })

  it('returns only a masked config, including for short keys', () => {
    const f = fixture()
    expect(f.gateway.getPublicAiConfig()).toEqual({ hasApiKey: true, maskedApiKey: '••••5678', model: 'deepseek-flash' })
    const short = fixture({ settings: { aiConfig: { apiKey: 'abc', model: 'deepseek-flash' } } })
    expect(short.gateway.getPublicAiConfig().maskedApiKey).toBe('••••')
    expect(JSON.stringify(short.gateway.getPublicAiConfig())).not.toContain('abc')
  })

  it('v0.5.0:5/8/11 位密钥只显示圆点,12 位起才露尾四(掩码边界)', () => {
    const mask = key => fixture({ settings: { aiConfig: { apiKey: key, model: 'deepseek-flash' } } }).gateway.getPublicAiConfig().maskedApiKey
    expect(mask('a'.repeat(5))).toBe('••••')
    expect(mask('b'.repeat(8))).toBe('••••')
    expect(mask('c'.repeat(11))).toBe('••••')
    expect(mask('d'.repeat(12))).toBe('••••dddd')
  })

  it('v0.5.0:普通保存与配置更新都保留 aiConfig 额外字段(未来新增字段不被抹掉)', () => {
    const f = fixture({ schemaVersion: 10, settings: { aiConfig: { apiKey: KEY, model: 'deepseek-flash', futureFlag: true } }, sessions: [] })
    const stale = f.gateway.loadForRenderer()
    expect(f.gateway.saveFromRenderer(stale)).toBe(true)
    expect(f.disk.settings.aiConfig.futureFlag).toBe(true)
    f.gateway.updateAiConfig({ model: 'deepseek-v4-pro' })
    expect(f.disk.settings.aiConfig.futureFlag).toBe(true)
    expect(f.disk.settings.aiConfig.model).toBe('deepseek-v4-pro')
    expect(f.disk.settings.aiConfig.apiKey).toBe(KEY)
  })

  it('ordinary save preserves the latest private key and model', () => {
    const f = fixture()
    f.gateway.updateAiConfig({ model: 'deepseek-v4-pro' })
    const stale = f.gateway.loadForRenderer()
    stale.settings.aiConfig = { apiKey: 'masked', model: 'deepseek-flash' }
    stale.sessions.push({ id: 'new' })
    expect(f.gateway.saveFromRenderer(stale)).toBe(true)
    expect(f.disk.settings.aiConfig).toEqual({ apiKey: KEY, model: 'deepseek-v4-pro' })
    expect(f.disk.sessions).toEqual([{ id: 'new' }])
  })

  it('explicit clear cannot be undone by an old renderer snapshot', () => {
    const f = fixture()
    const stale = f.gateway.loadForRenderer()
    stale.settings.aiConfig.apiKey = KEY
    expect(f.gateway.updateAiConfig({ clearApiKey: true }).ok).toBe(true)
    f.gateway.saveFromRenderer(stale)
    expect(f.disk.settings.aiConfig.apiKey).toBe('')
  })

  it('mask is rejected as a replacement key', () => {
    const f = fixture()
    expect(f.gateway.updateAiConfig({ apiKey: '••••5678' }).error.code).toBe('INVALID_CONFIG')
    expect(f.disk.settings.aiConfig.apiKey).toBe(KEY)
  })

  it('blank draft does not clear the key', () => {
    const f = fixture()
    expect(f.gateway.updateAiConfig({ apiKey: '  ' }).error.code).toBe('INVALID_CONFIG')
    expect(f.disk.settings.aiConfig.apiKey).toBe(KEY)
  })

  it('a config update preserves sessions written immediately before it', () => {
    const f = fixture()
    const next = f.gateway.loadForRenderer()
    next.sessions = [{ id: 's1' }]
    f.gateway.saveFromRenderer(next)
    f.gateway.updateAiConfig({ model: 'deepseek-v4-pro' })
    expect(f.disk.sessions).toEqual([{ id: 's1' }])
  })

  it('reports failed writes instead of success', () => {
    const f = fixture()
    f.failWrite = true
    expect(f.gateway.updateAiConfig({ model: 'deepseek-v4-pro' }).error.code).toBe('CONFIG_SAVE_FAILED')
    expect(f.gateway.saveFromRenderer(f.gateway.loadForRenderer())).toBe(false)
    expect(f.disk.settings.aiConfig.model).toBe('deepseek-flash')
  })

  it('does not create a partial file before state initialization', () => {
    const f = fixture(null)
    expect(f.gateway.updateAiConfig({ apiKey: KEY }).error.code).toBe('CONFIG_SAVE_FAILED')
    expect(f.writes).toBe(0)
  })

  it('does not overwrite an unreadable state file', () => {
    const writeState = vi.fn(() => true)
    const gateway = createStateGateway({ readState: () => { throw new Error('unreadable') }, writeState })
    // v0.5.0 复审B1:读取失败必须向上传递(IPC reject → 渲染层停用自动落盘),
    // 伪装成 null 会让空状态自动保存覆盖旧档
    expect(() => gateway.loadForRenderer()).toThrow('unreadable')
    expect(gateway.saveFromRenderer({ settings: {} })).toBe(false)
    expect(gateway.updateAiConfig({ model: 'deepseek-flash' }).error.code).toBe('CONFIG_SAVE_FAILED')
    expect(writeState).not.toHaveBeenCalled()
  })

  it('never adds chat history to disk through the config API', () => {
    const f = fixture()
    f.gateway.updateAiConfig({ model: 'deepseek-v4-pro' })
    expect(f.disk).not.toHaveProperty('chatHistory')
    expect(f.disk.settings).not.toHaveProperty('chatHistory')
  })
})
