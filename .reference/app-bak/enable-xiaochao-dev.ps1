$ErrorActionPreference = 'Stop'
$currentAppDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$resourcesDirectory = Split-Path -Parent $currentAppDirectory
$appDirectory = Join-Path $resourcesDirectory 'app'
$backupDirectory = Join-Path $resourcesDirectory 'app.bak'

if (Get-Process -Name 'SGSOL' -ErrorAction SilentlyContinue) {
    Write-Host '请先完全退出 SGSOL，再重新运行本脚本。' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $appDirectory)) {
    Rename-Item -LiteralPath $backupDirectory -NewName 'app'
}

Write-Host '小抄开发模式已启用。' -ForegroundColor Green
Write-Host "开发目录：$(Join-Path $appDirectory 'xiaochao-dev')"
Write-Host '把完整解混淆脚本保存为 xiaochao-dev\xiaochao.js，保存后游戏页会自动刷新。'

$executablePath = Join-Path (Split-Path -Parent $resourcesDirectory) 'SGSOL.exe'
if (Test-Path -LiteralPath $executablePath) {
    Start-Process -FilePath $executablePath
}
