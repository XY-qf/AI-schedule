# AI日程 就地更新脚本
# 作用：把新版本文件覆盖到已安装目录。不重新安装、不动任何数据。
# 用法：双击同目录下的 update.bat（它会请求管理员权限）

param(
    # 手动指定安装目录（默认自动探测）
    [string]$TargetDir = '',
    # 只更新、不自动启动（用于验证）
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------- 找到新版本文件 ----------
$sourceCandidates = @(
    (Join-Path $scriptRoot 'release\win-unpacked'),
    (Join-Path $scriptRoot '..\release\win-unpacked'),
    'C:\Users\王一钧\Desktop\AI日程APP制作\ai-schedule\release\win-unpacked'
)
$source = $null
foreach ($candidate in $sourceCandidates) {
    if (Test-Path (Join-Path $candidate 'AI-Schedule.exe')) { $source = (Resolve-Path $candidate).Path; break }
}
if (-not $source) {
    Write-Host ''
    Write-Host '找不到新版本文件 release\win-unpacked\AI-Schedule.exe' -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}

# ---------- 找到已安装的位置 ----------
$installCandidates = @(
    'C:\Program Files\AI-Schedule',
    'C:\Program Files (x86)\AI-Schedule',
    (Join-Path $env:LOCALAPPDATA 'Programs\AI-Schedule'),
    'C:\AI-Schedule'
)
$installDir = $null
foreach ($dir in $installCandidates) {
    if (Test-Path (Join-Path $dir 'AI-Schedule.exe')) { $installDir = $dir; break }
}
if (-not $installDir) {
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($key in $keys) {
        $entry = Get-ItemProperty $key -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like 'AI-Schedule*' -and $_.InstallLocation } |
            Select-Object -First 1
        if ($entry -and (Test-Path (Join-Path $entry.InstallLocation 'AI-Schedule.exe'))) {
            $installDir = $entry.InstallLocation
            break
        }
    }
}
if ($TargetDir) {
    if (-not (Test-Path (Join-Path $TargetDir 'AI-Schedule.exe'))) {
        Write-Host "指定的目录里没有 AI-Schedule.exe：$TargetDir" -ForegroundColor Red
        exit 1
    }
    $installDir = (Resolve-Path $TargetDir).Path
}

if (-not $installDir) {
    Write-Host '没有找到已安装的 AI 日程。' -ForegroundColor Yellow
    Write-Host '如果想用免安装版：把 release\win-unpacked 整个文件夹复制到 C:\AI-Schedule 即可。'
    Read-Host '按回车关闭'
    exit 1
}

Write-Host ''
Write-Host "新版本：  $source"
Write-Host "安装目录：$installDir"
Write-Host ''

# ---------- 关掉正在运行的实例 ----------
Get-Process -Name 'AI-Schedule' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700

# ---------- 覆盖复制（保留卸载程序等原有文件） ----------
Write-Host '正在复制新文件…'
robocopy $source $installDir /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) {
    Write-Host "复制失败（robocopy 返回 $code）" -ForegroundColor Red
    Write-Host '常见原因：程序还在运行，或该目录被安全软件占用。'
    Read-Host '按回车关闭'
    exit 1
}

# ---------- 校验 ----------
$srcAsar = (Get-FileHash (Join-Path $source 'resources\app.asar') -Algorithm SHA256).Hash
$dstAsar = (Get-FileHash (Join-Path $installDir 'resources\app.asar') -Algorithm SHA256).Hash
if ($srcAsar -ne $dstAsar) {
    Write-Host '复制后校验不一致，请确认没有其它程序占用文件后重试。' -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}

if ($NoStart) {
    Write-Host '更新完成（按 -NoStart 未自动启动）。' -ForegroundColor Green
    exit 0
}
Write-Host '更新完成，正在启动…' -ForegroundColor Green
Start-Process -FilePath (Join-Path $installDir 'AI-Schedule.exe')
Start-Sleep -Seconds 2
Write-Host ''
Write-Host '你的数据仍在「文档\AI日程」，没有被动过。' -ForegroundColor Green
Read-Host '按回车关闭本窗口'
