import { describe, it, expect, vi, afterEach } from 'vitest'
import serviceModule from '../electron/ai-service.js'

const { createAiService } = serviceModule
const KEY = 'sk-test-12345678'
const messages = [{ role: 'system', content: '事实' }, { role: 'user', content: '你好' }]
const okBody = (content = '回答', extras = {}) => ({ choices: [{ finish_reason: 'stop', message: { content, ...extras } }] })
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) })
const setup = (fetchImpl, config = { apiKey: KEY, model: 'deepseek-chat' }, options = {}) => createAiService({ fetchImpl, getPrivateConfig: () => config, ...options })

afterEach(() => vi.useRealTimers())

describe('DeepSeek AI service', () => {
  it.each(['deepseek-chat', 'deepseek-reasoner'])('sends %s to the fixed endpoint with only required fields', async model => {
    const fetchImpl = vi.fn(async () => response(200, okBody()))
    const result = await setup(fetchImpl, { apiKey: KEY, model }).chat({ requestId: 'one', messages })
    expect(result).toEqual({ ok: true, data: { requestId: 'one', content: '回答', model } })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options.redirect).toBe('manual')
    expect(options.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(options.body)).toEqual({ model, messages, stream: false })
  })

  it('sends a minimal connection test without study data', async () => {
    const fetchImpl = vi.fn(async () => response(200, okBody()))
    const result = await setup(fetchImpl).testConnection({ requestId: 'test' })
    expect(result.data).toEqual({ requestId: 'test', model: 'deepseek-chat' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages).toEqual([{ role: 'user', content: '请只回复“连接成功”。' }])
  })

  it('makes zero network requests without a key', async () => {
    const fetchImpl = vi.fn()
    expect((await setup(fetchImpl, { apiKey: '', model: 'deepseek-chat' }).chat({ requestId: 'x', messages })).error.code).toBe('NOT_CONFIGURED')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses only final content from reasoner and rejects reasoning-only output', async () => {
    const fetchImpl = vi.fn(async () => response(200, okBody('最终答案', { reasoning_content: '私有推理' })))
    const service = setup(fetchImpl, { apiKey: KEY, model: 'deepseek-reasoner' })
    const result = await service.chat({ requestId: 'x', messages })
    expect(JSON.stringify(result)).not.toContain('私有推理')
    expect(result.data.content).toBe('最终答案')
    fetchImpl.mockImplementationOnce(async () => response(200, okBody('', { reasoning_content: '私有推理' })))
    expect((await service.chat({ requestId: 'y', messages })).error.code).toBe('EMPTY_RESPONSE')
  })

  it.each([
    [401, {}, 'AUTH_FAILED'], [402, {}, 'INSUFFICIENT_BALANCE'],
    [429, {}, 'RATE_LIMITED'], [503, {}, 'SERVICE_UNAVAILABLE'],
    [400, { error: { code: 'insufficient_balance' } }, 'INSUFFICIENT_BALANCE'],
  ])('maps HTTP %s to %s without leaking response body', async (status, body, code) => {
    const result = await setup(async () => response(status, { ...body, secret: KEY })).chat({ requestId: 'x', messages })
    expect(result.error.code).toBe(code)
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('maps a failed fetch to NETWORK_ERROR', async () => {
    const result = await setup(async () => { throw new Error(KEY) }).chat({ requestId: 'x', messages })
    expect(result.error.code).toBe('NETWORK_ERROR')
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('keeps authentication errors fixed even when the server sends non-JSON', async () => {
    const result = await setup(async () => ({ status: 401, ok: false, text: async () => `invalid ${KEY}` })).chat({ requestId: 'x', messages })
    expect(result.error.code).toBe('AUTH_FAILED')
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('times out fetch and clears the active slot', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const service = setup(fetchImpl, undefined, { chatTimeoutMs: 20 })
    const pending = service.chat({ requestId: 'x', messages })
    await vi.advanceTimersByTimeAsync(21)
    expect((await pending).error.code).toBe('TIMEOUT')
    const next = service.chat({ requestId: 'y', messages })
    await vi.advanceTimersByTimeAsync(21)
    expect((await next).error.code).toBe('TIMEOUT')
  })

  it('times out while reading the response body', async () => {
    vi.useFakeTimers()
    const service = setup(async (_url, options) => ({ status: 200, ok: true, text: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))) }), undefined, { chatTimeoutMs: 20 })
    const pending = service.chat({ requestId: 'x', messages })
    await vi.advanceTimersByTimeAsync(21)
    expect((await pending).error.code).toBe('TIMEOUT')
  })

  it('rejects malformed, empty, truncated and oversized answers', async () => {
    const malformed = await setup(async () => ({ status: 200, ok: true, text: async () => 'broken' })).chat({ requestId: 'x', messages })
    expect(malformed.error.code).toBe('INVALID_RESPONSE')
    const empty = await setup(async () => response(200, okBody('  '))).chat({ requestId: 'x', messages })
    expect(empty.error.code).toBe('EMPTY_RESPONSE')
    const truncated = await setup(async () => response(200, { choices: [{ finish_reason: 'length', message: { content: '一半' } }] })).chat({ requestId: 'x', messages })
    expect(truncated.error.code).toBe('INCOMPLETE_RESPONSE')
    const missingFinish = await setup(async () => response(200, { choices: [{ message: { content: '一半' } }] })).chat({ requestId: 'x', messages })
    expect(missingFinish.error.code).toBe('INCOMPLETE_RESPONSE')
    const huge = await setup(async () => ({ status: 200, ok: true, text: async () => 'x'.repeat(1024 * 1024 + 1) })).chat({ requestId: 'x', messages })
    expect(huge.error.code).toBe('RESPONSE_TOO_LARGE')
  })

  it('cancels an active request and rejects concurrent work', async () => {
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const service = setup(fetchImpl)
    const pending = service.chat({ requestId: 'one', messages })
    expect((await service.chat({ requestId: 'two', messages })).error.code).toBe('BUSY')
    expect(service.cancel('other')).toBe(false)
    expect(service.cancel('one')).toBe(true)
    expect((await pending).error.code).toBe('CANCELLED')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
