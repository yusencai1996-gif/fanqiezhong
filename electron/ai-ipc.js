const MAX_INPUT_BYTES = 256 * 1024
const CHANNELS = ['aiGetConfig', 'aiUpdateConfig', 'aiTestConnection', 'aiChat', 'aiCancel']

function failure(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } }
}

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > 42) return false
  if (messages[0]?.role !== 'system') return false
  for (let i = 0; i < messages.length; i++) {
    const item = messages[i]
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).length !== 2 || !Object.hasOwn(item, 'role') || !Object.hasOwn(item, 'content') ||
        typeof item.content !== 'string' || !item.content.trim()) return false
    const expected = i === 0 ? 'system' : i % 2 ? 'user' : 'assistant'
    if (item.role !== expected) return false
  }
  return messages[messages.length - 1].role === 'user'
}

function registerAiHandlers({ ipcMain, getMainWindow, gateway, service }) {
  let ownedRequest = null
  const guard = (event) => {
    const win = getMainWindow()
    return !!win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
  }
  const register = (name, handler) => ipcMain.handle(`pomodoro:${name}`, (event, ...args) => {
    if (!guard(event)) return failure('FORBIDDEN', '当前窗口无法使用 AI 功能。')
    return handler(...args)
  })

  register('aiGetConfig', () => ({ ok: true, data: gateway.getPublicAiConfig() }))
  register('aiUpdateConfig', (patch) => {
    const result = gateway.updateAiConfig(patch)
    if (result.ok) { service.cancelAll(); ownedRequest = null }
    return result
  })
  const run = async (input, testing) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !validId(input.requestId) ||
        Object.keys(input).some(k => !['requestId', ...(testing ? [] : ['messages'])].includes(k))) {
      return failure('INVALID_ARGUMENT', '请求参数无效。')
    }
    if (!testing) {
      if (!validMessages(input.messages)) return failure('INVALID_ARGUMENT', '对话内容无效。')
      let encoded
      try { encoded = JSON.stringify(input.messages) } catch (e) { return failure('INVALID_ARGUMENT', '对话内容无效。') }
      if (Buffer.byteLength(encoded, 'utf8') > MAX_INPUT_BYTES) return failure('INPUT_TOO_LARGE', '内容过长，请缩短后重试。')
    }
    if (ownedRequest) return failure('BUSY', '已有 AI 请求正在进行，请稍后再试。')
    const ownership = { requestId: input.requestId }
    ownedRequest = ownership
    try { return testing ? await service.testConnection({ requestId: input.requestId }) : await service.chat({ requestId: input.requestId, messages: input.messages }) }
    finally { if (ownedRequest === ownership) ownedRequest = null }
  }
  register('aiTestConnection', input => run(input, true))
  register('aiChat', input => run(input, false))
  register('aiCancel', input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !validId(input.requestId)) return failure('INVALID_ARGUMENT', '请求参数无效。')
    return { ok: true, data: { cancelled: ownedRequest?.requestId === input.requestId && service.cancel(input.requestId) } }
  })

  return () => { service.cancelAll(); ownedRequest = null; for (const name of CHANNELS) ipcMain.removeHandler(`pomodoro:${name}`) }
}

module.exports = { registerAiHandlers }
