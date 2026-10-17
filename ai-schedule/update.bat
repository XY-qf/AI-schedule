@echo off
title AI Schedule - Update to latest
setlocal

rem Writing into Program Files needs admin rights; re-launch elevated if needed.
fsutil dirty query %systemdrive% >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator rights, please click Yes...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
exit /b
