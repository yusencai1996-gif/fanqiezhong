// 计时核心:时间戳差值法。
// 关键:不靠 setInterval 累加,而是记录"开始时间戳",
// 每次查询用 now() - startTimestamp 算已用时间。
// 这样系统休眠唤醒后,时间依然准确(因为基准是真实时间戳)。
export function createTimer({ totalSec, now = () => Date.now() }) {
  let durationSec = totalSec           // 当前一轮总时长
  let status = 'stopped'               // stopped | running | paused | finished
  let runningStartTs = null            // 本轮 running 段的起始时间戳
  let accumulatedMs = 0                 // 已累计的真实运行毫秒(跨多次 pause/resume)

  function elapsedRunningMs() {
    if (status === 'running' && runningStartTs !== null) {
      return accumulatedMs + (now() - runningStartTs)
    }
    return accumulatedMs
  }

  function getRemainingSec() {
    const remain = durationSec - Math.floor(elapsedRunningMs() / 1000)
    return Math.max(0, remain)
  }

  function refreshStatus() {
    // 运行中若已到点,自动转 finished
    if (status === 'running' && getRemainingSec() === 0) {
      status = 'finished'
      accumulatedMs = durationSec * 1000
      runningStartTs = null
    }
  }

  return {
    getStatus: () => { refreshStatus(); return status },
    getRemainingSec: () => { refreshStatus(); return getRemainingSec() },
    // 已专注的实际秒数(给"提前结束按实际记录"用)。不改状态。
    getElapsedSec: () => { refreshStatus(); return Math.min(durationSec, Math.floor(elapsedRunningMs() / 1000)) },
    // v0.4.1:供 timer 重建判定用——比较实例实际时长与期望时长,而非外部标记(防标记预写导致重建条件失效)
    getTotalSec: () => durationSec,

    start: () => {
      if (status === 'running') return
      if (status === 'finished') return
      status = 'running'
      runningStartTs = now()
    },
    pause: () => {
      if (status !== 'running') return
      accumulatedMs += now() - runningStartTs
      runningStartTs = null
      status = 'paused'
    },
    resume: () => {
      if (status !== 'paused') return
      status = 'running'
      runningStartTs = now()
    },
    skip: () => {
      status = 'finished'
      runningStartTs = null
      accumulatedMs = 0   // 与 reset 对齐:终态必须清零累计,避免实例复用时污染下一轮
    },
    reset: () => {
      status = 'stopped'
      runningStartTs = null
      accumulatedMs = 0
    },
    setTotalSec: (sec) => {
      // 仅在停止态允许改,避免进行中改值导致混乱
      if (status === 'stopped') {
        durationSec = sec
        accumulatedMs = 0
      }
    },
  }
}
