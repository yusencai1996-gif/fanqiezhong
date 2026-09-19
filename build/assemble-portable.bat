@echo off
chcp 65001 >nul
REM 手动组装番茄钟免安装版(electron-builder 卡住时的可靠替代方案)
REM 原理:electron 应用 = electron 运行时 + resources/app/ 里的应用代码

set SRC=%~dp0..
set DEST=%~dp0..\release\番茄钟

echo ====================================
echo  组装番茄钟免安装版
echo ====================================

REM 1. 清理旧的
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"

REM 2. 复制 electron 运行时(dist 目录的所有文件)
echo [1/4] 复制 electron 运行时...
xcopy "%SRC%\node_modules\electron\dist\*" "%DEST%\" /E /I /Q /Y >nul
if errorlevel 1 (echo 复制运行时失败 & pause & exit /b 1)
REM 把 electron.exe 改名为 番茄钟.exe
ren "%DEST%\electron.exe" "番茄钟.exe"

REM 3. 准备 resources\app (应用代码)
echo [2/4] 准备应用代码目录...
mkdir "%DEST%\resources\app"

REM 4. 复制 dist (前端构建产物)
echo [3/4] 复制前端构建产物...
xcopy "%SRC%\dist\*" "%DEST%\resources\app\dist\" /E /I /Q /Y >nul

REM 5. 复制 electron 主进程代码 + package.json
echo [4/4] 复制主进程代码...
xcopy "%SRC%\electron\*" "%DEST%\resources\app\electron\" /E /I /Q /Y >nul
copy "%SRC%\package.json" "%DEST%\resources\app\package.json" >nul

REM 6. 复制托盘图标到 resources 根(主进程从 process.resourcesPath 读)
copy "%SRC%\build\tray.png" "%DEST%\resources\tray.png" >nul
copy "%SRC%\build\icon.png" "%DEST%\resources\app\build\icon.png" >nul 2>nul

REM 7. 写一个精简的 package.json 到 app 目录(Electron 入口需要)
echo {> "%DEST%\resources\app\package.json.minimal"
echo   "name": "pomodoro",>> "%DEST%\resources\app\package.json.minimal"
echo   "version": "0.1.0",>> "%DEST%\resources\app\package.json.minimal"
echo   "main": "electron/main.js">> "%DEST%\resources\app\package.json.minimal"
echo }>> "%DEST%\resources\app\package.json.minimal"

echo.
echo ====================================
echo  组装完成!
echo  位置: %DEST%
echo  双击 番茄钟.exe 即可运行
echo ====================================
dir "%DEST%\番茄钟.exe" 2>nul && echo exe 存在 || echo 警告:exe 未找到
pause
