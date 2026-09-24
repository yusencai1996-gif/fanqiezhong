import { useEffect, useReducer, useRef, useState } from 'react'
import { Bot, RotateCcw, Send, Sparkles, User } from 'lucide-react'
// 冻结契约(PLAN 第四节):会话纯函数与消息编排来自 src/features/ai.js。
import {
  buildChatMessages,
  buildStudySummary,
  initialAiSession,
  parseAiMarkdown,
  reduceAiSession,
} from '../features/ai.js'
import './AiAssistantPanel.css'

// v0.5.2:AI 回复的轻量 Markdown 渲染(解析在 ai.js 纯函数,已单测)。
// 只映射为 React 元素,不拼 HTML,无注入面。
function AiMarkdown({ content }) {
  const blocks = parseAiMarkdown(content)
  return (
    <div className="ai-md">
      {blocks.map((b, i) => {
        if (b.type === 'blank') return <div key={i} className="ai-md__blank" />
        if (b.type === 'heading') return <div key={i} className={`ai-md__h ai-md__h--${Math.min(b.level, 3)}`}>{renderSpans(b.spans, i)}</div>
        if (b.type === 'bullet') return <div key={i} className="ai-md__li"><span className="ai-md__dot" /><span>{renderSpans(b.spans, i)}</span></div>
        if (b.type === 'ordered') return <div key={i} className="ai-md__li"><span className="ai-md__num">{b.index}.</span><span>{renderSpans(b.spans, i)}</span></div>
        if (b.type === 'quote') return <div key={i} className="ai-md__quote">{renderSpans(b.spans, i)}</div>
        return <div key={i} className="ai-md__p">{renderSpans(b.spans, i)}</div>
      })}
    </div>
  )
}

function renderSpans(spans, keyBase) {
  return spans.map((s, j) => {
    if (s.bold) return <strong key={`${keyBase}-${j}`}>{s.text}</strong>
    if (s.italic) return <em key={`${keyBase}-${j}`}>{s.text}</em>
    if (s.code) return <code key={`${keyBase}-${j}`}>{s.text}</code>
    return <span key={`${keyBase}-${j}`}>{s.text}</span>
  })
}

// 错误码 → 固定中文文案(PLAN 第四节错误表;不透传 API 原文)
// AiSettingsSection 的连接测试也复用这份映射
export function aiErrorText(error) {
  const code = typeof error === 'string' ? error : error?.code
  switch (code) {
    case 'NOT_CONFIGURED': return '尚未配置 API 密钥,请先到「设置 → AI 助手」填写密钥'
    case 'INVALID_CONFIG': return '配置无效,请检查设置中的 AI 配置'
    case 'INVALID_ARGUMENT': return '请求参数有误,请修改后重试'
    case 'FORBIDDEN': return '当前窗口无权使用 AI 功能'
    case 'AUTH_FAILED': return '密钥验证失败,请检查 API 密钥是否正确'
    case 'INSUFFICIENT_BALANCE': return '账户余额不足,请到 DeepSeek 控制台检查账户状态'
    case 'RATE_LIMITED': return '请求太频繁,稍等片刻再试'
    case 'NETWORK_ERROR': return '网络连接失败,请检查网络后重试'
    case 'TIMEOUT': return '请求超时,请稍后重试'
    case 'SERVICE_UNAVAILABLE': return 'AI 服务暂时不可用,请稍后重试'
    case 'EMPTY_RESPONSE': return 'AI 没有返回内容,请换个问法重试'
    case 'INVALID_RESPONSE': return 'AI 返回内容异常,请重试'
    case 'RESPONSE_TOO_LARGE': return '回答内容过长,请缩小问题范围重试'
    case 'INCOMPLETE_RESPONSE': return '回答不完整,请重试'
    case 'BUSY': return '已有 AI 请求进行中,请稍候'
    case 'CANCELLED': return '已取消'
    case 'INPUT_TOO_LARGE': return '内容太长,请缩短后重试'
    case 'CONFIG_SAVE_FAILED': return '配置保存失败,请重试'
    default: return 'AI 请求失败,请稍后重试'
  }
}

// 不可自动/手动重试的错误码(PLAN 错误表:认证、余额、配置类不保留重试入口)
const NO_RETRY = new Set([
  'NOT_CONFIGURED', 'INVALID_CONFIG', 'INVALID_ARGUMENT', 'FORBIDDEN',
  'AUTH_FAILED', 'INSUFFICIENT_BALANCE', 'INPUT_TOO_LARGE', 'CANCELLED',
])
export function aiErrorRetryable(error) {
  const e = typeof error === 'string' ? { code: error } : error
  // v0.5.0 独立复审建议3:后端错误对象带 retryable 时优先采信(400/404/422 类不可重试)
  if (e && typeof e.retryable === 'boolean') return e.retryable
  return !NO_RETRY.has(e?.code)
}

function makeRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

// AI 陪学助理面板。已配置期间保持挂载(open=false 不渲染弹层),
// 关闭再开会话历史保留;清除密钥后 App 卸载本组件,内存随之清空。
export default function AiAssistantPanel({ open, config, getStudyData, onClose }) {
  const [session, dispatch] = useReducer(reduceAiSession, initialAiSession)
  const [draft, setDraft] = useState('')
  const listRef = useRef(null)
  const stickBottomRef = useRef(true)   // 用户是否贴底(贴底或自己发送时才跟随滚动)
  const inputRef = useRef(null)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // 滚动跟随:仅贴底时跟随新内容;用户上翻阅读历史不强制滚底
  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight
  }, [session.history, session.pending, session.error, open])

  function handleScroll() {
    const el = listRef.current
    if (!el) return
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const pending = !!session.pending

  // text:用户气泡/历史里展示的文案;mode: chat | review | order(复盘/顺序建议时
  // buildChatMessages 会把 mode 展开成完整提问,历史里只留短文案)。
  async function send(text, mode = 'chat') {
    const api = window.pomodoroAPI
    if (!api?.aiChat || session.pending) return
    if (mode === 'chat' && !text.trim()) return
    const requestId = makeRequestId()
    // reduceAiSession 的 start:防重复点击;重试(同 text+mode 的 error 在册)不重复追加 user 消息
    dispatch({ type: 'start', requestId, text, mode })
    stickBottomRef.current = true   // 主动发送始终滚到底
    // 每次发送/重试都重新取最新快照(防跨午夜、刚完成专注后数据过期)
    const summary = buildStudySummary(getStudyData(), new Date())
    const messages = buildChatMessages({ summary, history: session.history, text, mode })
    let res
    try {
      res = await api.aiChat({ requestId, messages })
    } catch (e) {
      // 桥异常 reject 同样要落账,防 pending 悬空锁死面板(初审建议)
      res = { ok: false, error: { code: 'NETWORK_ERROR' } }
    }
    // reducer 按 requestId 匹配 pending,晚到/过期结果自动丢弃(模型切换等场景)
    if (res.ok) {
      dispatch({ type: 'success', requestId, content: res.data.content })
    } else if (res.error?.code === 'CANCELLED') {
      // v0.5.0 初审阻断修复:取消必须落账清 pending,否则切模型打断在途请求后面板永久锁死
      dispatch({ type: 'cancel', requestId })
    } else {
      // 失败:错误块挂在会话尾部,原问题保留在 error 里供重试;不当成功回答写入历史
      // 完整 error 对象(含 retryable)随消息存档,重试按钮按后端判定显隐
      dispatch({ type: 'failure', requestId, error: res.error })
    }
  }

  function handleSubmit() {
    const text = draft.trim()
    if (!text || pending) return
    setDraft('')
    send(text, 'chat')
  }

  function handleInputKeyDown(e) {
    // Enter 发送,Shift+Enter 换行;中文输入法组合态(isComposing)不触发发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!open) return null

  const empty = session.history.length === 0

  return (
    <div className="ai-overlay" onClick={onClose}>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI 陪学助理">
        <div className="ai-header">
          <h2><Sparkles size={20} /> AI 陪学助理</h2>
          <div className="ai-header__right">
            {config?.model && <span className="ai-model-tag">{config.model}</span>}
            <button className="ai-close" onClick={onClose} title="关闭">×</button>
          </div>
        </div>

        <div className="ai-quick">
          <button className="ai-quick__btn" disabled={pending} onClick={() => send('今日复盘', 'review')}>
            今日复盘
          </button>
          <button className="ai-quick__btn" disabled={pending} onClick={() => send('今日学习顺序建议', 'order')}>
            今日学习顺序建议
          </button>
        </div>

        <div className="ai-messages" ref={listRef} onScroll={handleScroll}>
          {empty && !session.error && (
            <div className="ai-empty">
              <Bot size={28} />
              <p className="ai-empty__title">我是你的 AI 陪学助理</p>
              <p className="ai-empty__desc">基于你的真实专注记录和计划回答问题、做今日复盘、排今日学习顺序。只读建议,不会改动你的任何数据。</p>
            </div>
          )}
          {session.history.map((m, i) => (
            <div key={i} className={`ai-msg ai-msg--${m.role}`}>
              <span className="ai-msg__avatar">{m.role === 'user' ? <User size={14} /> : <Bot size={14} />}</span>
              <div className="ai-msg__body">
                {m.role === 'assistant'
                  ? <AiMarkdown content={m.content} />
                  : <div className="ai-msg__content">{m.content}</div>}
              </div>
            </div>
          ))}
          {pending && (
            <div className="ai-msg ai-msg--assistant">
              <span className="ai-msg__avatar"><Bot size={14} /></span>
              <div className="ai-msg__body">
                <div className="ai-msg__content ai-typing" aria-label="AI 正在生成回答">
                  <i /><i /><i />
                </div>
              </div>
            </div>
          )}
          {session.error && (
            <div className="ai-msg__error" role="alert">
              <span>{aiErrorText(session.error.code)}</span>
              {aiErrorRetryable(session.error) && (
                <button
                  className="ai-msg__retry"
                  disabled={pending}
                  onClick={() => send(session.error.text, session.error.mode)}
                >
                  <RotateCcw size={13} /> 重试
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ai-input">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            placeholder="问点什么,比如:我今天学了多久?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button className="ai-send" disabled={pending || !draft.trim()} onClick={handleSubmit} title="发送">
            <Send size={16} />
          </button>
        </div>
        <p className="ai-hint">Enter 发送,Shift+Enter 换行 · AI 只读取学习数据,回答仅供参考</p>
      </div>
    </div>
  )
}
