import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
// 设置面板:v0.3.9.2 起 overlay/panel/header 样式抽到独立 SettingsPanel.css(对齐其他弹层)
import './SettingsPanel.css'
import './Timer.css'
import AiSettingsSection from './AiSettingsSection.jsx'   // v0.5.0 F1:AI 助手配置区

export default function SettingsPanel({ settings, onChange, onClose, aiConfig, onAiSave, onAiTest, onAiCancelTest }) {
  // 开机自启:从主进程读当前状态,改动时写回
  const [autoStart, setAutoStart] = useState(false)
  useEffect(() => {
    if (window.pomodoroAPI?.getLoginItem) {
      window.pomodoroAPI.getLoginItem().then(setAutoStart)
    }
  }, [])
  function toggleAutoStart(e) {
    const v = e.target.checked
    setAutoStart(v)
    if (window.pomodoroAPI?.setLoginItem) window.pomodoroAPI.setLoginItem(v)
  }

  function num(key, label, min, max, unit = '分钟') {
    return (
      <label className="setting-row" key={key}>
        <span>{label}（{min}-{max} {unit}）</span>
        <input
          type="number" min={min} max={max}
          value={settings[key]}
          onChange={(e) => {
            const v = Math.max(min, Math.min(max, Number(e.target.value) || min))
            onChange({ [key]: v })
          }}
        />
      </label>
    )
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2><Settings size={20} /> 设置</h2>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>

        <div className="settings-group">
          <div className="settings-group__title">时长</div>
          {num('workMinutes', '专注时长', 1, 120)}
          {num('shortBreakMinutes', '短休息', 1, 60)}
          {num('longBreakMinutes', '长休息', 1, 60)}
          {num('longBreakInterval', '每几个番茄一次长休息', 2, 12, '个')}
          <p className="settings-hint">改动在下一轮生效。</p>
        </div>

        <div className="settings-group">
          <div className="settings-group__title">打卡</div>
          {num('dailyGoalMinutes', '每日专注门槛', 1, 480)}
          <p className="settings-hint">每天专注达到这个时长算"打卡成功"(打卡表里绿格子)。默认30分钟。</p>
        </div>

        <div className="settings-group">
          <div className="settings-group__title">通用</div>
          <label className="setting-row">
            <span>开机自动启动</span>
            <label className="switch">
              <input type="checkbox" checked={autoStart} onChange={toggleAutoStart} />
              <span className="switch__slider"></span>
            </label>
          </label>
          <p className="settings-hint">开启后,电脑开机时番茄钟自动启动并缩到后台。</p>
        </div>

        {/* v0.5.0 F1:AI 助手配置区(密钥草稿/掩码/清除/模型/连接测试;密钥不经 store) */}
        <AiSettingsSection
          config={aiConfig}
          onSave={onAiSave}
          onTest={onAiTest}
          onCancelTest={onAiCancelTest}
        />

        <button className="btn btn--primary" onClick={onClose}>完成</button>
      </div>
    </div>
  )
}
