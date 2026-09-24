const URL = 'https://api.deepseek.com/chat/completions'
const MAX_RESPONSE_BYTES = 1024 * 1024
const CHAT_TIMEOUT_MS = 120000
const TEST_TIMEOUT_MS = 30000

const ERRORS = {
  NOT_CONFIGURED: ['请先在设置中配置 API 密钥。', false],
  BUSY: ['已有 AI 请求正在进行，请稍后再试。', false],
  AUTH_FAILED: ['认证失败，请检查 API 密钥。', false],
  INSUFFICIENT_BALANCE: ['账户余额不足，请检查账户状态。', false],
  RATE_LIMITED: ['请求过于频繁，请稍后手动重试。', true],
  SERVICE_UNAVAILABLE: ['AI 服务暂时不可用，请稍后手动重试。', true],
  NETWORK_ERROR: ['网络连接失败，请检查网络后重试。', true],
  TIMEOUT: ['AI 请求超时，请手动重试。', true],
  CANCELLED: ['请求已取消。', false],
  EMPTY_RESPONSE: ['AI 没有返回回答，请重试。', true],
  INVALID_RESPONSE: ['AI 返回内容无法读取，请重试。', true],
  RESPONSE_TOO_LARGE: ['AI 回答过长，请缩短问题后重试。', true],
  INCOMPLETE_RESPONSE: ['AI 回答未完成，请重试。', true],
}

function error(code, retryOverride) {
  const [message, retryable] = ERRORS[code]
  return { ok: false, error: { code, message, retryable: retryOverride !== undefined ? retryOverride : retryable } }
}

function responseError(status, body) {
  if (status === 401 || status === 403) return error('AUTH_FAILED')
  if (status === 402 || body?.error?.code === 'insufficient_balance') return error('INSUFFICIENT_BALANCE')
  if (status === 429) return error('RATE_LIMITED')
  if (status >= 500) return error('SERVICE_UNAVAILABLE')
  // 400/404/422 = 请求本身被拒,重试必然同样失败(2026-09-24 后端专审建议)
  if (status === 400 || status === 404 || status === 422) return error('INVALID_RESPONSE', false)
  return error('INVALID_RESPONSE')
}

function createAiService({ fetchImpl = fetch, getPrivateConfig, chatTimeoutMs = CHAT_TIMEOUT_MS, testTimeoutMs = TEST_TIMEOUT_MS }) {
  let active = null

  async function run({ requestId, messages }, testing) {
    const config = getPrivateConfig()
    if (!config?.apiKey) return error('NOT_CONFIGURED')
    if (active) return error('BUSY')
    const controller = new AbortController()
    const request = { requestId, controller, reason: null }
    active = request
    const timeoutId = setTimeout(() => { request.reason = 'TIMEOUT'; controller.abort() }, testing ? testTimeoutMs : chatTimeoutMs)
    try {
      const payload = { model: config.model, messages: testing ? [{ role: 'user', content: '请只回复“连接成功”。' }] : messages, stream: false }
      const response = await fetchImpl(URL, {
        method: 'POST', redirect: 'manual',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      })
      if (request.reason) return error(request.reason)
      if (response.status >= 300 && response.status < 400) return error('INVALID_RESPONSE')
      // v0.5.0:content-length 先行拒收——不把超大响应体读进内存再判(后端专审:事后校验防不了 OOM)。
      // 防御式访问:headers 缺失(mock/异常实现)时跳过预检,读后校验仍兜底。
      const declaredLen = Number(response.headers?.get?.('content-length'))
      if (Number.isFinite(declaredLen) && declaredLen > MAX_RESPONSE_BYTES) return error('RESPONSE_TOO_LARGE')
      let bodyText
      try { bodyText = await response.text() } catch (e) { if (request.reason) return error(request.reason); return error('NETWORK_ERROR') }
      if (request.reason) return error(request.reason)
      if (Buffer.byteLength(bodyText, 'utf8') > MAX_RESPONSE_BYTES) return error('RESPONSE_TOO_LARGE')
      let body
      try { body = JSON.parse(bodyText) } catch (e) { return response.ok ? error('INVALID_RESPONSE') : responseError(response.status, null) }
      if (!response.ok) return responseError(response.status, body)
      if (!body || typeof body !== 'object' || !Array.isArray(body.choices)) return error('INVALID_RESPONSE')
      const choice = body.choices[0]
      if (!choice || typeof choice !== 'object' || !choice.message || typeof choice.message !== 'object') return error('INVALID_RESPONSE')
      if (choice.finish_reason !== 'stop') return error('INCOMPLETE_RESPONSE')
      const content = choice.message.content
      if (typeof content !== 'string') return error('INVALID_RESPONSE')
      if (!content.trim()) return error('EMPTY_RESPONSE')
      return { ok: true, data: testing ? { requestId, model: config.model } : { requestId, content, model: config.model } }
    } catch (e) {
      if (request.reason) return error(request.reason)
      return error('NETWORK_ERROR')
    } finally {
      clearTimeout(timeoutId)
      if (active === request) active = null
    }
  }

  return {
    chat: ({ requestId, messages }) => run({ requestId, messages }, false),
    testConnection: ({ requestId }) => run({ requestId }, true),
    cancel: (requestId) => {
      if (!active || active.requestId !== requestId) return false
      active.reason = 'CANCELLED'
      active.controller.abort()
      active = null   // v0.5.0:立即清引用,取消后马上发新请求不再撞假 BUSY(finally 是身份比较,不会误清新请求)
      return true
    },
    cancelAll: () => {
      if (active) { active.reason = 'CANCELLED'; active.controller.abort(); active = null }
    },
  }
}

module.exports = { createAiService }
