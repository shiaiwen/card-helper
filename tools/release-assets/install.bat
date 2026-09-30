@echo off
setlocal enabledelayedexpansion

REM Xiaochao micro-client install script
REM See the manual install document in this folder for non-batch steps.

set "CURRENT_DIR=%~dp0"
set "LOG_FILE=%CURRENT_DIR%install.log"
echo [%date% %time%] Start install > "%LOG_FILE%"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [%date% %time%] Error: no admin rights >> "%LOG_FILE%"
    echo.
    echo Error: please run this script as administrator.
    echo Right-click install.bat and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)

set "ASAR_FILE=%CURRENT_DIR%app.asar"
set "ASAR_BAK=%CURRENT_DIR%app.asar.bak"
set "ZIP_FILE=%CURRENT_DIR%app.zip"
set "APP_DIR=%CURRENT_DIR%app"

if not exist "%ZIP_FILE%" (
    echo [%date% %time%] Error: app.zip not found >> "%LOG_FILE%"
    echo.
    echo Error: app.zip is missing in the current folder.
    echo Make sure app.zip and install.bat are in the same folder.
    echo.
    pause
    exit /b 1
)

tasklist /FI "IMAGENAME eq SGSOL.exe" 2>nul | find /I "SGSOL.exe" >nul
if %errorlevel% equ 0 (
    echo [%date% %time%] Error: SGSOL.exe is running >> "%LOG_FILE%"
    echo.
    echo Error: SGSOL.exe is running. Please close it completely.
    echo.
    pause
    exit /b 1
)

echo [%date% %time%] Remove old app directory >> "%LOG_FILE%"
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
if exist "%APP_DIR%" (
    echo [%date% %time%] Error: cannot remove old app directory >> "%LOG_FILE%"
    echo.
    echo Error: cannot remove the old app directory. It may be in use.
    echo Make sure SGSOL.exe is closed and try again.
    echo.
    pause
    exit /b 1
)

echo [%date% %time%] Extract app.zip >> "%LOG_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP_FILE%' -DestinationPath '%CURRENT_DIR%' -Force" >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Error: failed to extract app.zip >> "%LOG_FILE%"
    echo.
    echo Error: failed to extract app.zip.
    echo Possible causes: PowerShell is too old or app.zip is broken.
    echo.
    pause
    exit /b 1
)

if not exist "%APP_DIR%\package.json" (
    echo [%date% %time%] Error: package.json missing after extraction >> "%LOG_FILE%"
    echo.
    echo Error: app\package.json is missing after extraction.
    echo.
    pause
    exit /b 1
)

if exist "%ASAR_FILE%" (
    echo [%date% %time%] Rename app.asar >> "%LOG_FILE%"
    if exist "%ASAR_BAK%" del /f /q "%ASAR_BAK%"
    move /y "%ASAR_FILE%" "%ASAR_BAK%" >nul
    if errorlevel 1 (
        echo [%date% %time%] Error: cannot rename app.asar >> "%LOG_FILE%"
        echo.
        echo Error: cannot rename app.asar. It may be in use.
        echo.
        pause
        exit /b 1
    )
)

echo [%date% %time%] Install success >> "%LOG_FILE%"
echo.
echo Micro-client installed successfully.
echo Please restart SGSOL.
echo.
pause
exit /b 0
