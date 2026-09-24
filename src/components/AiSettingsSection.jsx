import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Trash2, Zap } from 'lucide-react'
import { aiErrorText } from './AiAssistantPanel.jsx'
// AI 设置区样式与助手面板同文件(任务书约定),显式引入防"清理未用导入"时静默掉样式(初审建议)
import './AiAssistantPanel.css'

const MODELS = [
  { value: 'deepseek-flash', label: 'deepseek-flash' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
]

// 设置面板「AI 助手」区(F1)。
// 只管输入草稿、显示隐藏和操作状态;密钥不走 store.updateSettings,
// 保存/清除/切换模型都经 onSave 走专用桥(aiUpdateConfig)。
//   config: PublicAiConfig | null(null = 配置加载中)
//   onSave(patch) → Promise<Result<PublicAiConfig>>
//   onTest() → Promise<Result>;onCancelTest() → void
export default function AiSettingsSection({ config, onSave, onTest, onCancelTest }) {
  const [draft, setDraft] = useState('')        // 密钥草稿(仅本次输入,保存成功/关闭设置后清空)
  const [showKey, setShowKey] = useState(false) // 显示/隐藏只作用于草稿
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')        // 保存/清除失败(保留草稿)
  const [testResult, setTestResult] = useState(null) // { ok, text }

  const hasKey = !!config?.hasApiKey
  const busy = saving || testing
  const draftClean = draft.trim()

  async function runSave(patch, { clearDraftOnOk = false } = {}) {
    if (saving) return
    setSaving(true)
    setError('')
    setTestResult(null)
    try {
      const res = await onSave(patch)
      if (res.ok) {
        if (clearDraftOnOk) { setDraft(''); setShowKey(false) }
      } else {
        setError(aiErrorText(res.error))
      }
    } catch (e) {
      // 桥异常 reject 也要可见,不能静默当作保存成功(初审建议)
      setError(aiErrorText('NETWORK_ERROR'))
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    if (testing) return
    setTesting(true)
    setError('')
    setTestResult(null)
    try {
      const res = await onTest()
      if (!res.ok && res.error?.code === 'CANCELLED') {
        // 用户主动取消:安静清空,不显示红字(PLAN 定调"安静取消")
        setTestResult(null)
        return
      }
      setTestResult(res.ok
        ? { ok: true, text: `连接成功,当前模型 ${res.data?.model || config?.model || ''}` }
        : { ok: false, text: aiErrorText(res.error) })
    } catch (e) {
      setTestResult({ ok: false, text: aiErrorText('NETWORK_ERROR') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-group">
      <div className="settings-group__title">AI 助手</div>

      {/* 配置状态 */}
      <div className="ai-set-status">
        <span className={'ai-set-dot' + (hasKey ? ' ai-set-dot--on' : '')} />
        {config === null ? '正在读取配置…' : hasKey
          ? <>已配置密钥 <span className="ai-set-masked">{config.maskedApiKey}</span></>
          : '未配置密钥(配置后顶栏出现 AI 助手入口)'}
      </div>

      {/* 密钥草稿:默认隐藏,可粘贴;只作用于本次输入,已保存密钥只显示掩码 */}
      <div className="ai-set-keyrow">
        <KeyRound size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <input
          type={showKey ? 'text' : 'password'}
          value={draft}
          placeholder={hasKey ? '输入新密钥以替换' : '粘贴 DeepSeek API 密钥'}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); setError('') }}
        />
        <button
          type="button"
          className="ai-set-eye"
          title={showKey ? '隐藏' : '显示'}
          onClick={() => setShowKey(v => !v)}
        >
          {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      {/* 模型选择:点击即保存,保存成功后下一次请求生效 */}
      <div className="setting-row">
        <span>模型</span>
        <div className="ai-set-models">
          {MODELS.map(m => (
            <button
              key={m.value}
              type="button"
              className={'ai-set-model' + (config?.model === m.value ? ' ai-set-model--active' : '')}
              disabled={busy || config === null}
              onClick={() => { if (config?.model !== m.value) runSave({ model: m.value }) }}
            >{m.label}</button>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="ai-set-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !draftClean}
          onClick={() => runSave({ apiKey: draftClean }, { clearDraftOnOk: true })}
        >
          {saving ? <Loader2 size={14} className="ai-spin" /> : null} 保存密钥
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !hasKey || !!draftClean}
          title={draftClean ? '有未保存的密钥草稿,请先保存' : '测试已保存的配置'}
          onClick={runTest}
        >
          {testing ? <Loader2 size={14} className="ai-spin" /> : <Zap size={14} />} 测试连接
        </button>
        {testing && (
          <button type="button" className="btn" onClick={onCancelTest}>取消</button>
        )}
        {hasKey && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => runSave({ clearApiKey: true })}
          >
            <Trash2 size={14} /> 清除密钥
          </button>
        )}
      </div>

      {draftClean && !error && (
        <p className="settings-hint">密钥尚未保存,测试连接用的是已保存的配置,请先保存。</p>
      )}
      {error && <p className="ai-set-result ai-set-result--err">{error}</p>}
      {testResult && (
        <p className={'ai-set-result ' + (testResult.ok ? 'ai-set-result--ok' : 'ai-set-result--err')}>
          {testResult.text}
        </p>
      )}
      <p className="settings-hint">
        密钥只保存在本机数据文件中;使用 AI 助手时会把你的问题和学习摘要发送给 DeepSeek。
      </p>
    </div>
  )
}
