import { useEffect, useState, useRef } from 'react'
import { fmtClock } from '../features/format.js'
import { Coffee, Timer as TimerIcon, Pause, Play, Check, SkipForward, RotateCcw } from 'lucide-react'
import './Timer.css'

export default function Timer({ timer, mode, activeTask, onFinished, onSkip, onFinishEarly, onTimerChange, onStartPause, onReset }) {
  // 每 250ms 刷新一次显示(刷新显示频率,不影响计时精度)
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 250)
    return () => clearInterval(id)
  }, [])

  // 完成检测:每次渲染检查,finished 时回调一次。用 ref 记上次状态(语义比 useState 当 ref 用清晰)
  const lastStatus = useRef(timer.getStatus())
  const status = timer.getStatus()
  useEffect(() => {
    if (status === 'finished' && lastStatus.current !== 'finished') {
      lastStatus.current = 'finished'
      onFinished()
    } else if (status !== 'finished') {
      lastStatus.current = status
    }
  })

  const remaining = timer.getRemainingSec()
  const isBreak = mode === '休息'

  return (
    <section className="timer">
      <div className="timer__mode">{isBreak ? <><Coffee size={18} /> 休息时间</> : <><TimerIcon size={18} /> 专注时间</>}</div>
      <div className={'timer__clock' + (isBreak ? ' timer__clock--break' : '')}>
        {fmtClock(remaining)}
      </div>
      <div className="timer__task">
        {activeTask ? `当前任务：${activeTask.title}` : '（未选择任务，自由专注）'}
      </div>
      <div className="timer__controls">
        {status === 'running'
          ? <button className="btn btn--primary" onClick={onStartPause}><Pause size={16} /> 暂停</button>
          : <button className="btn btn--primary" onClick={onStartPause}><Play size={16} /> 开始</button>
        }
        {status === 'paused'
          && <button className="btn" onClick={onStartPause}><Play size={16} /> 继续</button>
        }
        {/* 结束本轮:按实际专注时间记为"提前结束"(区别于跳过) */}
        {(status === 'running' || status === 'paused')
          && <button className="btn btn--finish" onClick={onFinishEarly} title="按已专注的实际时长记为完成,并进入下一阶段"><Check size={16} /> 完成本轮</button>
        }
        <button className="btn" onClick={onSkip} disabled={status === 'stopped'} title="放弃剩余时间,记为跳过"><SkipForward size={16} /> 跳过</button>
        <button className="btn" onClick={onReset} disabled={status === 'stopped'}><RotateCcw size={16} /> 重置</button>
      </div>
    </section>
  )
}
