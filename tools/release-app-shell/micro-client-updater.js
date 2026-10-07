/** 用 PowerShell 拉起微端更新进程。 */
const path = require('path');

function quotePowerShellLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function withUtf8Bom(source) {
    return `\uFEFF${source}`;
}

function buildWindowsMicroClientUpdater(options) {
    const {
        parentPid,
        archivePath,
        resourcesPath,
        executablePath,
        updaterPath,
        launcherPath,
        statusPath
    } = options;
    const updateDirectory = path.dirname(archivePath);
    const logPath = path.join(updateDirectory, 'update-error.log');
    const quote = quotePowerShellLiteral;

    const updaterSource = `$ErrorActionPreference = 'Stop'
$ParentPid = ${Number(parentPid)}
$Archive = ${quote(archivePath)}
$Resources = ${quote(resourcesPath)}
$Executable = ${quote(executablePath)}
$Updater = ${quote(updaterPath)}
$Launcher = ${quote(launcherPath)}
$StatusFile = ${quote(statusPath)}
$UpdateRoot = ${quote(updateDirectory)}
$StageRoot = Join-Path $UpdateRoot 'stage'
$NewApp = Join-Path $StageRoot 'app'
$CurrentApp = Join-Path $Resources 'app'
$BackupApp = Join-Path $Resources 'app.xiaochao-backup'
$LogFile = ${quote(logPath)}
$readyForQuit = $false
$backupCreated = $false

function Set-UpdateStatus([string]$Value) {
  Set-Content -LiteralPath $StatusFile -Value $Value -Encoding UTF8 -NoNewline
}

function Write-UpdateLog([string]$Value) {
  Add-Content -LiteralPath $LogFile -Value $Value -Encoding UTF8
}

function Start-MicroClient {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "微端程序不存在: $Executable"
  }
  $ExecutableDirectory = Split-Path -Parent $Executable
  if (-not (Test-Path -LiteralPath $ExecutableDirectory -PathType Container)) {
    throw "微端程序目录不存在: $ExecutableDirectory"
  }
  $Process = Start-Process -FilePath $Executable -WorkingDirectory $ExecutableDirectory -PassThru
  if (-not $Process) { throw "微端程序启动失败: $Executable" }
}

function Restore-BackupApp {
  if (Test-Path -LiteralPath $BackupApp -PathType Container) {
    if (Test-Path -LiteralPath $CurrentApp) {
      Remove-Item -LiteralPath $CurrentApp -Recurse -Force -ErrorAction SilentlyContinue
    }
    Move-Item -LiteralPath $BackupApp -Destination $CurrentApp -Force
  }
}

try {
  Set-UpdateStatus 'started'
  Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue
  Write-UpdateLog "started=$(Get-Date -Format o)"
  Write-UpdateLog "archive=$Archive"
  Write-UpdateLog "resources=$Resources"
  Write-UpdateLog "executable=$Executable"

  if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "更新包不存在: $Archive" }
  if (-not (Test-Path -LiteralPath $Resources -PathType Container)) { throw "微端资源目录不存在: $Resources" }
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "微端程序不存在: $Executable" }
  if (-not (Test-Path -LiteralPath $CurrentApp -PathType Container)) { throw "当前微端 app 目录不存在: $CurrentApp" }

  Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
  Expand-Archive -LiteralPath $Archive -DestinationPath $StageRoot -Force
  if (-not (Test-Path -LiteralPath (Join-Path $NewApp 'package.json') -PathType Leaf)) {
    throw '更新包缺少 app/package.json'
  }

  Set-UpdateStatus 'ready'
  $readyForQuit = $true
  Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2

  Remove-Item -LiteralPath $BackupApp -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $CurrentApp -Destination $BackupApp -Force
  $backupCreated = $true
  Move-Item -LiteralPath $NewApp -Destination $CurrentApp -Force

  Start-MicroClient
  Set-UpdateStatus 'success'
  Start-Sleep -Seconds 2

  Remove-Item -LiteralPath $BackupApp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Updater -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Launcher -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  $Failure = $_ | Out-String
  try {
    Write-UpdateLog "failed=$(Get-Date -Format o)"
    Write-UpdateLog $Failure
  } catch {}
  try { Set-UpdateStatus 'failed' } catch {}

  if ($backupCreated) {
    try {
      Restore-BackupApp
      Write-UpdateLog 'restored previous app directory'
    } catch {
      Write-UpdateLog "restore failed: $($_ | Out-String)"
    }
  }

  if ($readyForQuit) {
    try {
      Start-MicroClient
      Write-UpdateLog 'restarted previous micro-client after failure'
    } catch {
      Write-UpdateLog "restart after failure failed: $($_ | Out-String)"
    }
  }
  exit 1
}
`;

    // Pass the complete updater as an encoded command. The elevated account may
    // not be able to read a script stored in the original user's AppData folder.
    const encodedUpdater = Buffer.from(updaterSource, 'utf16le').toString('base64');

    const launcherSource = `$ErrorActionPreference = 'Stop'
$StatusFile = ${quote(statusPath)}
$LogFile = ${quote(logPath)}
Remove-Item -LiteralPath $StatusFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LogFile -Force -ErrorAction SilentlyContinue

try {
  $EncodedCommand = ${quote(encodedUpdater)}
  $Process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', $EncodedCommand
  ) -WindowStyle Hidden -PassThru
} catch {
  $_ | Out-File -FilePath $LogFile -Encoding UTF8
  Set-Content -LiteralPath $StatusFile -Value 'failed' -Encoding UTF8 -NoNewline
  exit 1
}

if (-not $Process) {
  Set-Content -LiteralPath $StatusFile -Value 'failed' -Encoding UTF8 -NoNewline
  exit 1
}

$Deadline = (Get-Date).AddSeconds(120)
$InspectionErrorLogged = $false
while ((Get-Date) -lt $Deadline) {
  if (Test-Path -LiteralPath $StatusFile) {
    $Status = (Get-Content -LiteralPath $StatusFile -Raw).Trim()
    if ($Status -eq 'ready') { exit 0 }
    if ($Status -eq 'failed') { exit 1 }
  }
  $ProcessExited = $false
  $ExitCode = $null
  try {
    $ProcessExited = $Process.HasExited
    if ($ProcessExited) { $ExitCode = $Process.ExitCode }
  } catch {
    if (-not $InspectionErrorLogged) {
      try { Add-Content -LiteralPath $LogFile -Value "failed to inspect elevated updater: $($_ | Out-String)" -Encoding UTF8 } catch {}
      $InspectionErrorLogged = $true
    }
  }
  if ($ProcessExited) {
    try { Add-Content -LiteralPath $LogFile -Value "elevated updater exited before reporting status (code=$ExitCode)" -Encoding UTF8 } catch {}
    try { Set-Content -LiteralPath $StatusFile -Value 'failed' -Encoding UTF8 -NoNewline } catch {}
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

Add-Content -LiteralPath $LogFile -Value 'timed out waiting for elevated updater preparation' -Encoding UTF8
exit 1
`;

    return {
        updaterSource: withUtf8Bom(updaterSource),
        launcherSource: withUtf8Bom(launcherSource),
        logPath
    };
}

module.exports = {
    buildWindowsMicroClientUpdater,
    quotePowerShellLiteral,
    withUtf8Bom
};
