const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, globalShortcut, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { createStateGateway } = require('./ai-state')
const { createAiService } = require('./ai-service')
const { registerAiHandlers } = require('./ai-ipc')
const { createPersist } = require('./persist')

// ===== 单实例锁:只能开一个番茄钟 =====
// 关键:必须用 else 包裹所有后续初始化!
// app.quit() 是异步的,第二个实例退出前会继续执行下面的代码,
// 导致重复创建窗口、抢注全局快捷键、重复注册 IPC handler。
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // 第二个实例:直接退出(持锁实例会收到 second-instance 唤起窗口)
  app.quit()
} else {
  // ===== 以下是持锁实例(第一个)的所有初始化逻辑 =====

  // v0.4.1 修复通知静默丢失:Windows 要求应用必须设置 AppUserModelID 才能弹通知,
  // 否则 new Notification().show() 不报错但 Windows 静默吞掉(全屏听课场景暴露)。
  // 必须在 app.whenReady() 之前调用。值与 package.json 的 appId 一致。
  if (app.setAppUserModelId) {
    app.setAppUserModelId('com.xiaokong.pomodoro')
  }

  const isDev = !!process.env.VITE_DEV_SERVER_URL

  // 持久化:状态存到 userData/data.json
  function dataFile() {
    return path.join(app.getPath('userData'), 'data.json')
  }

  // v0.5.0:IO 移入 persist.js(损坏自愈 + 原子写,两审阻断项整改)
  const persist = createPersist({ getDataFile: dataFile })
  const readState = persist.readState
  const writeState = persist.writeState

  const gateway = createStateGateway({ readState, writeState })
  const aiService = createAiService({ getPrivateConfig: () => gateway.getPrivateAiConfig() })

  let win = null
  let widget = null        // 小插件窗口
  let tray = null
  let isQuiting = false    // 区分"真正退出"和"关闭最小化"
  let latestTimerState = { remainingSec: 0, mode: '专注', status: 'stopped', taskTitle: '' }

  function loadURL(target, isWidget) {
    if (isDev) {
      const base = process.env.VITE_DEV_SERVER_URL
      target.loadURL(isWidget ? `${base}?widget=1` : base)
    } else {
      const file = path.join(__dirname, '..', 'dist', 'index.html')
      target.loadFile(file, isWidget ? { query: { widget: '1' } } : undefined)
    }
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1200,   // v0.3.16:默认放大到1200×798,配合clamp缩放看着更舒服(森哥实测比例)
      height: 798,
      minWidth: 760,
      minHeight: 540,
      backgroundColor: '#1e1e2e',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,  // B保险:禁用后台节流,窗口最小化时定时器仍正常运行
      },
    })

    win.setMenuBarVisibility(false)
    loadURL(win, false)

    // v0.4.1:通知失败兜底后,窗口获得焦点时复位托盘 tooltip + 停止任务栏闪烁
    win.on('focus', () => {
      if (tray && !tray.isDestroyed()) tray.setToolTip('番茄钟')
      win.flashFrame(false)
    })

    // 关闭 = 最小化到托盘(除非是从托盘"退出"触发的)
    win.on('close', (e) => {
      if (!isQuiting) {
        e.preventDefault()
        win.hide()
      }
    })
    win.on('closed', () => { aiService.cancelAll(); win = null })
  }

  // 小插件窗口:极简,无边框,常驻置顶
  function createWidget() {
    widget = new BrowserWindow({
      width: 200,
      height: 110,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      x: 50, y: 50,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,  // B保险:禁用后台节流,窗口最小化时定时器仍正常运行
      },
    })
    widget.setMenuBarVisibility(false)
    loadURL(widget, true)

    widget.on('close', (e) => {
      if (!isQuiting) { e.preventDefault(); widget.hide() }
    })
  }

  // 广播计时状态给小插件
  function broadcastTimerState(state) {
    latestTimerState = { ...latestTimerState, ...state }
    if (widget && !widget.isDestroyed()) {
      widget.webContents.send('pomodoro:timerState', latestTimerState)
    }
  }

  // ===== A根治:主进程接管"计时结束检测" =====
  // 渲染层定时器在主窗口进后台时会被Chromium节流,导致计时到了也不提醒。
  // 主进程定时器不受窗口可见性影响,这里可靠地监控结束时刻,到点主动通知。
  let timerEndTs = null         // 本轮结束的时间戳(Date.now()),null=未计时
  let endMonitorId = null       // 结束监控定时器
  function startEndMonitor(endTs) {
    stopEndMonitor()
    timerEndTs = endTs
    endMonitorId = setInterval(() => {
      if (timerEndTs !== null && Date.now() >= timerEndTs) {
        // 时间到:通知主窗口执行"结束"流程(触发handleFinished)
        timerEndTs = null
        stopEndMonitor()
        if (win && win.webContents) win.webContents.send('pomodoro:timerFinished')
        // 同步广播小窗口为finished,避免小窗口卡在旧状态
        broadcastTimerState({ status: 'finished', remainingSec: 0 })
      }
    }, 500)
  }
  function stopEndMonitor() {
    timerEndTs = null
    if (endMonitorId) { clearInterval(endMonitorId); endMonitorId = null }
  }

  function createTray() {
    let iconPath
    if (isDev) {
      iconPath = path.join(__dirname, '..', 'build', 'tray.png')
    } else {
      iconPath = path.join(process.resourcesPath, 'tray.png')
    }
    const trayIcon = nativeImage.createFromPath(iconPath)
    tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon)

    const contextMenu = Menu.buildFromTemplate([
      { label: '显示番茄钟', click: () => { if (win) { win.show(); win.focus() } } },
      { label: '显示/隐藏 小插件', click: () => { if (widget) { widget.isVisible() ? widget.hide() : widget.show() } } },
      { type: 'separator' },
      { label: '退出', click: () => { isQuiting = true; app.quit() } },
    ])

    tray.setToolTip('番茄钟')
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => { if (win) { win.show(); win.focus() } })
  }

  // 全局快捷键:Ctrl+Shift+Space 切换开始/暂停
  function registerShortcuts() {
    const ret = globalShortcut.register('Control+Shift+Space', () => {
      if (win && win.webContents) {
        win.webContents.send('pomodoro:toggleStartPause')
      }
    })
    if (!ret) console.error('全局快捷键注册失败')
  }

  // ===== IPC handlers(只在持锁实例注册,避免重复) =====
  ipcMain.handle('pomodoro:loadState', () => gateway.loadForRenderer())
  ipcMain.handle('pomodoro:saveState', (_e, state) => gateway.saveFromRenderer(state))
  registerAiHandlers({ ipcMain, getMainWindow: () => win, gateway, service: aiService })

  ipcMain.handle('pomodoro:setLoginItem', (_e, openAtLogin) => {
    app.setLoginItemSettings({ openAtLogin: !!openAtLogin })
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('pomodoro:getLoginItem', () => app.getLoginItemSettings().openAtLogin)

  ipcMain.handle('pomodoro:notify', (_e, { title, body }) => {
    let notified = false
    if (Notification.isSupported()) {
      try {
        const n = new Notification({ title: title || '番茄钟', body: body || '', silent: false })
        n.on('failed', () => {
          // 通知系统拒绝:兜底用任务栏闪烁 + 托盘标题提示
          if (win && !win.isDestroyed()) win.flashFrame(true)
          if (tray && !tray.isDestroyed()) tray.setToolTip(`${title || '番茄钟'} — ${body || ''}`)
        })
        n.show()
        notified = true
      } catch (e) {
        console.error('Notification show failed', e)
      }
    }
    // 兜底:通知完全不可用时,至少任务栏闪烁提醒用户
    if (!notified && win && !win.isDestroyed()) {
      win.flashFrame(true)
    }
    return true
  })

  // v0.4.1:通知失败兜底后,窗口获得焦点时复位托盘 tooltip(见 createWindow 内 win.on('focus'))

  ipcMain.handle('pomodoro:reportTimerState', (_e, state) => { broadcastTimerState(state); return true })
  ipcMain.handle('pomodoro:getTimerState', () => latestTimerState)
  ipcMain.handle('pomodoro:widgetToggle', () => {
    if (win && win.webContents) win.webContents.send('pomodoro:toggleStartPause')
    return true
  })

  // A根治:渲染层上报/清除本轮结束时刻,主进程可靠监控
  ipcMain.handle('pomodoro:setTimerEnd', (_e, endTs) => {
    if (typeof endTs === 'number' && endTs > Date.now()) startEndMonitor(endTs)
    else stopEndMonitor()
    return true
  })
  ipcMain.handle('pomodoro:clearTimerEnd', () => { stopEndMonitor(); return true })

  // ===== 应用生命周期 =====
  app.whenReady().then(() => {
    createWindow()
    createTray()
    createWidget()
    registerShortcuts()
  })

  // 单实例:第二个实例启动时,把已有窗口唤起到前台
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
    if (widget && !widget.isVisible()) widget.show()  // 小插件也一并唤起
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (win) win.show()
  })

  app.on('window-all-closed', () => {
    // 不退出,留在托盘
  })

  app.on('before-quit', () => {
    isQuiting = true
    aiService.cancelAll()
    globalShortcut.unregisterAll()
    stopEndMonitor()
  })
}
