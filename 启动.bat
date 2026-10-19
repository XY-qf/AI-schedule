@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 AI 日程……
if exist ".\node_modules\electron\dist\electron.exe" (
  start "" ".\node_modules\electron\dist\electron.exe" .
) else (
  echo 找不到 Electron 运行时，请先执行 pnpm install。
  pause
)
