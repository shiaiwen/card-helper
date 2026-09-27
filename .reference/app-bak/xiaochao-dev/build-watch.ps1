$ErrorActionPreference = 'Stop'
$devDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$entryPath = Join-Path $devDirectory 'src\index.js'
$outputPath = Join-Path $devDirectory 'xiaochao.js'

if (-not (Test-Path -LiteralPath $entryPath)) {
    throw "开发入口不存在：$entryPath"
}

Write-Host "正在监听小抄源码：$entryPath"
Write-Host "构建输出：$outputPath"
npx --yes esbuild $entryPath --bundle --format=iife --platform=browser --target=chrome80 --sourcemap=inline --outfile=$outputPath --watch
