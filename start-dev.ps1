$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronPath = 'C:\Program Files\SGSOL\resources\xiaochao-electron-runtime\electron.exe'

if (-not (Test-Path -LiteralPath $electronPath)) {
    throw "找不到开发版 Electron：$electronPath"
}

$env:ELECTRON_ENABLE_LOGGING = '1'
Set-Location $projectDirectory
npm run dev
