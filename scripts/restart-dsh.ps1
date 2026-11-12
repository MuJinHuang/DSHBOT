<#
.SYNOPSIS
  重启桌面端 DSH，让插件的新代码生效。

.DESCRIPTION
  DSH 只在启动时组合插件树，所以改了插件必须重启。
  这个脚本只做三件事：找到进程 → 停掉 → 重新启动。

  注意：它会结束当前所有 DSH 会话（会话数据是持久化的，重启后还能看到）。
  如果你正和某个 Agent 对话，重启会中断那一轮。

.PARAMETER Force
  不询问，直接执行。

.PARAMETER DryRun
  只打印将要做什么，不真的动手。

.PARAMETER Exe
  DSH 可执行文件路径。默认依次尝试：正在运行的进程、$env:DSHBOT_DSH_EXE、常见安装目录。

.EXAMPLE
  .\scripts\restart-dsh.ps1 -DryRun
  .\scripts\restart-dsh.ps1
  .\scripts\restart-dsh.ps1 -Exe 'D:\Apps\DeepSeek Harness\DeepSeek Harness.exe'
#>
param(
  [switch]$Force,
  [switch]$DryRun,
  [string]$Exe
)

$ErrorActionPreference = 'Stop'
$processName = 'DeepSeek Harness'
$running = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)

# 找可执行文件：参数 > 环境变量 > 正在运行的进程 > 常见安装位置
$exe = $Exe
if (-not $exe) { $exe = $env:DSHBOT_DSH_EXE }
if (-not $exe -and $running.Count -gt 0) { $exe = $running[0].Path }
if (-not $exe) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\DeepSeek Harness.exe')
  )
  $exe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

if (-not $exe -or -not (Test-Path $exe)) {
  Write-Error '找不到 DSH 可执行文件。请用 -Exe 或环境变量 DSHBOT_DSH_EXE 指定。'
  exit 1
}

Write-Host "当前 $processName 进程数：$($running.Count)"

if ($running.Count -eq 0) {
  Write-Host 'DSH 没在运行，直接启动。'
} else {
  Write-Host '将结束这些进程（会话数据已持久化，重启不丢）：'
  $running | ForEach-Object { Write-Host ("  PID {0}  内存 {1:N0} MB" -f $_.Id, ($_.WorkingSet64 / 1MB)) }

  if ($DryRun) {
    Write-Host '[DryRun] 到此为止，没有真的结束进程。'
    return
  }

  if (-not $Force) {
    $answer = Read-Host '确认重启？(y/N)'
    if ($answer -notin @('y', 'Y', 'yes')) {
      Write-Host '已取消。'
      return
    }
  }

  $running | Stop-Process -Force
  # 等它真正退出，否则新实例可能和旧实例抢同一个端口
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (@(Get-Process -Name $processName -ErrorAction SilentlyContinue).Count -eq 0) { break }
  }
  Write-Host '已结束。'
}

if ($DryRun) {
  Write-Host "[DryRun] 将启动：$exe"
  return
}

Start-Process -FilePath $exe
Write-Host '已启动，等几秒让界面出来。'
Write-Host '插件是否加载：看日志里有没有 [dshbot] host side loaded'
