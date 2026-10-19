@echo off
title AI Schedule - Update
setlocal EnableExtensions

rem ============================================================
rem  AI Schedule - update the installed app in place
rem
rem  HOW TO USE
rem    1. Double click this file
rem    2. Click YES on the admin prompt
rem    3. Wait for "Update finished"
rem
rem  It closes the running app, copies release\win-unpacked over
rem  the install folder, then starts the app again.
rem  Your data in Documents\AI-Rili is NOT touched.
rem ============================================================

rem --- install folder (arg 1 can override it) ---
if "%~1"=="" (set "DST=C:\Program Files\AI-Schedule") else (set "DST=%~1")

rem --- where the new build is: release\win-unpacked next to this file ---
set "SRC=%~dp0release\win-unpacked"

if not exist "%SRC%\AI-Schedule.exe" (
    echo.
    echo [ERROR] Cannot find the new build:
    echo         %SRC%\AI-Schedule.exe
    echo.
    echo Make sure this file sits in the ai-schedule folder
    echo and that "release\win-unpacked" exists next to it.
    echo.
    pause
    exit /b 1
)

if not exist "%DST%\AI-Schedule.exe" (
    echo.
    echo [ERROR] Cannot find the installed app in:
    echo         %DST%
    echo.
    echo If you installed somewhere else, drag this file onto the
    echo install folder, or run:  ????.bat "D:\your\path"
    echo.
    pause
    exit /b 1
)

rem --- need admin to write into Program Files ---
if /I "%AI_SCHEDULE_NO_ELEVATE%"=="1" goto :run
fsutil dirty query %systemdrive% >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator rights, please click YES ...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:run
echo.
echo   New build : %SRC%
echo   Install to: %DST%
echo.

echo Closing the running app ...
taskkill /f /im AI-Schedule.exe >nul 2>&1
ping -n 2 127.0.0.1 >nul

echo Copying files ...
robocopy "%SRC%" "%DST%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
set "RC=%errorlevel%"
if %RC% geq 8 (
    echo.
    echo [ERROR] Copy failed, robocopy exit code %RC%.
    echo Close the app completely, then try again.
    pause
    exit /b 1
)

if not exist "%DST%\resources\app.asar" (
    echo.
    echo [ERROR] After copying, resources\app.asar is missing.
    pause
    exit /b 1
)

echo.
echo Update finished. Starting the app ...
start "" "%DST%\AI-Schedule.exe"
ping -n 3 127.0.0.1 >nul

echo.
echo Done. Your data is still in Documents\AI-Rili and untouched.
echo.
pause
exit /b 0
