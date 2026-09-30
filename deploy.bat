@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [deploy] Requesting admin elevation...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0' -ArgumentList '%*'"
    exit /b
)

echo.
echo [deploy] cwd: %cd%
node "%~dp0tools\deploy-release.js" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
    echo [deploy] FAILED exit=%EXIT_CODE%
) else (
    echo [deploy] OK
)
pause
exit /b %EXIT_CODE%
