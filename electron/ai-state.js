const MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro'])
const DEFAULT_MODEL = 'deepseek-flash'

function configFrom(state) {
  const raw = state?.settings?.aiConfig
  return {
    apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey : '',
    model: MODELS.has(raw?.model) ? raw.model : DEFAULT_MODEL,
  }
}

// v0.5.0:保留 aiConfig 中 apiKey/model 之外的额外字段(普通保存/配置更新不抹掉未来新增字段)
function rawAiConfigOf(state) {
  const raw = state?.settings?.aiConfig
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function publicConfig(config) {
  const key = config.apiKey
  // 掩码:密钥短于 12 位只显示圆点(防 5-7 位密钥露 4 位);≥12 位露尾四位(2026-09-24 后端专审)
  const maskedApiKey = !key ? '' : key.length >= 12 ? `••••${key.slice(-4)}` : '••••'
  return { hasApiKey: !!key, maskedApiKey, model: config.model }
}

function fail(code, message) {
  return { ok: false, error: { code, message, retryable: code === 'CONFIG_SAVE_FAILED' } }
}

function createStateGateway({ readState, writeState }) {
  function safeWrite(state) {
    try { return writeState(state) === true } catch (e) { return false }
  }
  function loadForRenderer() {
    // v0.5.0 复审 B1:读取异常必须向上传递(IPC reject → 渲染层按"读取失败"处理,
    // 本会话禁自动落盘),伪装成 null 会让空状态自动保存覆盖旧档
    const state = readState()
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null
    const settings = state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {}
    return { ...state, settings: { ...settings, aiConfig: { ...configFrom(state), apiKey: '' } } }
  }

  function saveFromRenderer(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false
    let latest
    try { latest = readState() } catch (e) { return false }
    const privateConfig = configFrom(latest)
    const settings = state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {}
    const next = { ...state, settings: { ...settings, aiConfig: { ...rawAiConfigOf(latest), ...privateConfig } } }
    return safeWrite(next)
  }

  function getPrivateAiConfig() {
    try { return configFrom(readState()) } catch (e) { return configFrom(null) }
  }
  function getPublicAiConfig() { return publicConfig(getPrivateAiConfig()) }

  function updateAiConfig(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('INVALID_CONFIG', 'AI 配置无效，请检查后重试。')
    if (Object.keys(patch).some(k => !['apiKey', 'clearApiKey', 'model'].includes(k)) ||
        (Object.hasOwn(patch, 'apiKey') && patch.clearApiKey === true) ||
        (Object.hasOwn(patch, 'clearApiKey') && patch.clearApiKey !== true) ||
        (Object.hasOwn(patch, 'model') && !MODELS.has(patch.model))) {
      return fail('INVALID_CONFIG', 'AI 配置无效，请检查后重试。')
    }
    if (Object.hasOwn(patch, 'apiKey') &&
        (typeof patch.apiKey !== 'string' || patch.apiKey.trim().length < 8 || patch.apiKey.length > 512 || /[\x00-\x1f\x7f]/.test(patch.apiKey) || patch.apiKey !== patch.apiKey.trim() || patch.apiKey.includes('•') || /^\*+/.test(patch.apiKey))) {
      return fail('INVALID_CONFIG', '密钥格式无效，请检查后重试。')
    }
    let state
    try { state = readState() } catch (e) { return fail('CONFIG_SAVE_FAILED', '配置保存失败，请重试。') }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return fail('CONFIG_SAVE_FAILED', '配置保存失败，请重试。')
    const previous = configFrom(state)
    const next = {
      ...rawAiConfigOf(state),
      apiKey: patch.clearApiKey ? '' : (Object.hasOwn(patch, 'apiKey') ? patch.apiKey : previous.apiKey),
      model: patch.model || previous.model,
    }
    const settings = state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) ? state.settings : {}
    if (!safeWrite({ ...state, settings: { ...settings, aiConfig: next } })) return fail('CONFIG_SAVE_FAILED', '配置保存失败，请重试。')
    return { ok: true, data: publicConfig(next) }
  }

  return { loadForRenderer, saveFromRenderer, getPrivateAiConfig, getPublicAiConfig, updateAiConfig }
}

module.exports = { createStateGateway }
