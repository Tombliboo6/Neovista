@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\start-autodrama-web.mjs
if errorlevel 1 (
  echo.
  echo PRISM AutoDrama 启动失败，请查看 runtime-data\logs\web-dev.log
  pause
)
