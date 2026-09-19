import { useEffect, useState } from 'react'
import { fmtClock } from '../features/format.js'
import { Coffee, Timer as TimerIcon, Play, Pause } from 'lucide-react'
import './Widget.css'

export default function Widget() {
  const [state, setState] = useState({ remainingSec: 0, mode: '专注', status: 'stopped', taskTitle: '' })

  useEffect(() => {
    const api = window.pomodoroAPI
    if (!api) return
    // 初始化同步当前状态
    api.getTimerState().then(s => { if (s) setState(s) })
    // 监听更新
    return api.onTimerState(s => setState(s))
  }, [])

  function toggle() {
    window.pomodoroAPI?.widgetToggle()
  }

  const isBreak = state.mode === '休息'
  const isRunning = state.status === 'running'

  return (
    <div className={'widget' + (isBreak ? ' widget--break' : '')}>
      <div className="widget__mode">{isBreak ? <><Coffee size={16} /> 休息</> : <><TimerIcon size={16} /> 专注</>}</div>
      <div className="widget__clock">{fmtClock(state.remainingSec)}</div>
      <button
        className={'widget__btn' + (isRunning ? ' widget__btn--pause' : ' widget__btn--start')}
        onClick={toggle}
        title={isRunning ? '暂停' : '开始'}
      >
        {isRunning ? <Pause size={18} /> : <Play size={18} />}
      </button>
    </div>
  )
}
