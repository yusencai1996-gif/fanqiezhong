import { describe, it, expect, vi } from 'vitest'
import ipcModule from '../electron/ai-ipc.js'

const { registerAiHandlers } = ipcModule
const messages = [{ role: 'system', content: '事实' }, { role: 'user', content: '问题' }]

function setup() {
  const handlers = new Map()
  const ipcMain = { handle: vi.fn((name, fn) => handlers.set(name, fn)), removeHandler: vi.fn(name => handlers.delete(name)) }
  const mainFrame = {}
  const webContents = { mainFrame }
  const win = { webContents, isDestroyed: () => false }
  const event = { sender: webContents, senderFrame: mainFrame }
  const gateway = {
    getPublicAiConfig: vi.fn(() => ({ hasApiKey: true, maskedApiKey: '••••5678', model: 'deepseek-flash' })),
    updateAiConfig: vi.fn(() => ({ ok: true, data: { hasApiKey: true, maskedApiKey: '••••5678', model: 'deepseek-flash' } })),
  }
  const service = {
    chat: vi.fn(async input => ({ ok: true, data: { requestId: input.requestId, content: '回答', model: 'deepseek-flash' } })),
    testConnection: vi.fn(async input => ({ ok: true, data: { requestId: input.requestId, model: 'deepseek-flash' } })),
    cancel: vi.fn(() => true), cancelAll: vi.fn(),
  }
  const dispose = registerAiHandlers({ ipcMain, getMainWindow: () => win, gateway, service })
  const call = (name, source = event, ...args) => handlers.get(`pomodoro:${name}`)(source, ...args)
  return { handlers, ipcMain, gateway, service, event, webContents, mainFrame, dispose, call }
}

describe('AI IPC boundary', () => {
  it('allows the main frame and returns the public config only', async () => {
    const f = setup()
    expect(await f.call('aiGetConfig')).toEqual({ ok: true, data: { hasApiKey: true, maskedApiKey: '••••5678', model: 'deepseek-flash' } })
    expect((await f.call('aiChat', f.event, { requestId: 'one', messages })).data.content).toBe('回答')
  })

  it('rejects widget, unrelated web contents, and child frame', async () => {
    const f = setup()
    for (const source of [{ sender: {}, senderFrame: {} }, { sender: f.webContents, senderFrame: {} }, { sender: null, senderFrame: f.mainFrame }]) {
      expect((await f.call('aiChat', source, { requestId: 'one', messages })).error.code).toBe('FORBIDDEN')
    }
    expect(f.service.chat).not.toHaveBeenCalled()
  })

  it('rejects extra message fields, tool roles and invalid order without network', async () => {
    const f = setup()
    const invalid = [
      [{ role: 'system', content: 'a', tool_calls: [] }, { role: 'user', content: 'b' }],
      [{ role: 'system', content: 'a' }, { role: 'tool', content: 'b' }],
      [{ role: 'user', content: 'b' }],
      [{ role: 'system', content: 'a' }, { role: 'assistant', content: 'b' }],
    ]
    for (const bad of invalid) expect((await f.call('aiChat', f.event, { requestId: 'one', messages: bad })).error.code).toBe('INVALID_ARGUMENT')
    expect(f.service.chat).not.toHaveBeenCalled()
  })

  it('enforces byte limit and argument shape before calling service', async () => {
    const f = setup()
    expect((await f.call('aiChat', f.event, { requestId: 'x', messages: [{ role: 'system', content: 's' }, { role: 'user', content: '中'.repeat(90000) }] })).error.code).toBe('INPUT_TOO_LARGE')
    expect((await f.call('aiChat', f.event, { requestId: '../bad', messages })).error.code).toBe('INVALID_ARGUMENT')
    expect((await f.call('aiTestConnection', f.event, { requestId: 'x', messages })).error.code).toBe('INVALID_ARGUMENT')
    expect(f.service.chat).not.toHaveBeenCalled()
  })

  it('only cancels a request owned by this window and cancels on config change', async () => {
    const f = setup()
    let complete
    f.service.chat.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const pending = f.call('aiChat', f.event, { requestId: 'one', messages })
    expect((await f.call('aiCancel', f.event, { requestId: 'other' })).data.cancelled).toBe(false)
    expect((await f.call('aiCancel', f.event, { requestId: 'one' })).data.cancelled).toBe(true)
    expect((await f.call('aiChat', f.event, { requestId: 'two', messages })).error.code).toBe('BUSY')
    await f.call('aiUpdateConfig', f.event, { model: 'deepseek-v4-pro' })
    expect(f.service.cancelAll).toHaveBeenCalled()
    complete({ ok: false, error: { code: 'CANCELLED', message: '请求已取消。', retryable: false } })
    await pending
  })

  it('dispose removes all five handlers and supports clean re-registration', () => {
    const f = setup()
    expect(f.handlers.size).toBe(5)
    f.dispose()
    expect(f.handlers.size).toBe(0)
    expect(f.ipcMain.removeHandler).toHaveBeenCalledTimes(5)
    const disposeAgain = registerAiHandlers({ ipcMain: f.ipcMain, getMainWindow: () => null, gateway: f.gateway, service: f.service })
    expect(f.handlers.size).toBe(5)
    disposeAgain()
  })
})
