const { contextBridge, ipcRenderer } = require('electron')

// 安全暴露给渲染层:主窗口和小插件窗口共用同一套 preload
contextBridge.exposeInMainWorld('pomodoroAPI', {
  // 状态读写
  loadState: () => ipcRenderer.invoke('pomodoro:loadState'),
  saveState: (state) => ipcRenderer.invoke('pomodoro:saveState', state),
  // AI 配置与对话只能经具名主进程通道;主进程还会验证主窗口主 frame。
  aiGetConfig: () => ipcRenderer.invoke('pomodoro:aiGetConfig'),
  aiUpdateConfig: (patch) => ipcRenderer.invoke('pomodoro:aiUpdateConfig', patch),
  aiTestConnection: (input) => ipcRenderer.invoke('pomodoro:aiTestConnection', input),
  aiChat: (input) => ipcRenderer.invoke('pomodoro:aiChat', input),
  aiCancel: (input) => ipcRenderer.invoke('pomodoro:aiCancel', input),
  // 开机自启
  setLoginItem: (open) => ipcRenderer.invoke('pomodoro:setLoginItem', open),
  getLoginItem: () => ipcRenderer.invoke('pomodoro:getLoginItem'),
  // 系统通知
  notify: (title, body) => ipcRenderer.invoke('pomodoro:notify', { title, body }),

  // ===== 计时控制(全局快捷键 + 小插件共用) =====
  // 主窗口:监听"开始/暂停"指令(来自快捷键或小插件)
  onToggleStartPause: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('pomodoro:toggleStartPause', handler)
    return () => ipcRenderer.removeListener('pomodoro:toggleStartPause', handler)
  },

  // ===== 小插件状态同步 =====
  // 主窗口:上报计时状态给小插件
  reportTimerState: (state) => ipcRenderer.invoke('pomodoro:reportTimerState', state),
  // 小插件:监听状态更新
  onTimerState: (cb) => {
    const handler = (_e, state) => cb(state)
    ipcRenderer.on('pomodoro:timerState', handler)
    return () => ipcRenderer.removeListener('pomodoro:timerState', handler)
  },
  // 小插件:获取当前状态(初始化同步)
  getTimerState: () => ipcRenderer.invoke('pomodoro:getTimerState'),
  // 小插件:点开始/暂停
  widgetToggle: () => ipcRenderer.invoke('pomodoro:widgetToggle'),

  // ===== A根治:主进程接管结束检测 =====
  // 主窗口:上报本轮结束时刻(主进程可靠监控,不受窗口后台节流影响)
  setTimerEnd: (endTs) => ipcRenderer.invoke('pomodoro:setTimerEnd', endTs),
  clearTimerEnd: () => ipcRenderer.invoke('pomodoro:clearTimerEnd'),
  // 主窗口:监听主进程的"时间到"通知(主进程检测到点后触发handleFinished)
  onTimerFinished: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('pomodoro:timerFinished', handler)
    return () => ipcRenderer.removeListener('pomodoro:timerFinished', handler)
  },
})
