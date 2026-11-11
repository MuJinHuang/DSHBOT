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

.EXAMPLE
  .\scripts\restart-dsh.ps1 -DryRun
  .\scripts\restart-dsh.ps1
#>
param(
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# 桌面端的可执行文件；换机器时改这一行
$exe = 'D:\应用\其他应用\DeepSeek_Harness\DeepSeek Harness.exe'
$processName = 'DeepSeek Harness'

if (-not (Test-Path $exe)) {
  Write-Error "找不到 DSH 可执行文件：$exe"
  return
}

$running = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
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
