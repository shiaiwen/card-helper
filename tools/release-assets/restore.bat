@echo off
setlocal enabledelayedexpansion

REM Xiaochao micro-client restore script (restore official app.asar)
REM See the manual install document in this folder for non-batch steps.

set "CURRENT_DIR=%~dp0"
set "LOG_FILE=%CURRENT_DIR%restore.log"
echo [%date% %time%] Start restore > "%LOG_FILE%"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [%date% %time%] Error: no admin rights >> "%LOG_FILE%"
    echo.
    echo Error: please run this script as administrator.
    echo Right-click restore.bat and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)

set "ASAR_FILE=%CURRENT_DIR%app.asar"
set "ASAR_BAK=%CURRENT_DIR%app.asar.bak"
set "APP_DIR=%CURRENT_DIR%app"

tasklist /FI "IMAGENAME eq SGSOL.exe" 2>nul | find /I "SGSOL.exe" >nul
if %errorlevel% equ 0 (
    echo [%date% %time%] Error: SGSOL.exe is running >> "%LOG_FILE%"
    echo.
    echo Error: SGSOL.exe is running. Please close it completely.
    echo.
    pause
    exit /b 1
)

echo [%date% %time%] Remove app directory >> "%LOG_FILE%"
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
if exist "%APP_DIR%" (
    echo [%date% %time%] Error: cannot remove app directory >> "%LOG_FILE%"
    echo.
    echo Error: cannot remove the app directory. It may be in use.
    echo.
    pause
    exit /b 1
)

if exist "%ASAR_BAK%" (
    echo [%date% %time%] Restore app.asar >> "%LOG_FILE%"
    move /y "%ASAR_BAK%" "%ASAR_FILE%" >nul
    if errorlevel 1 (
        echo [%date% %time%] Error: cannot restore app.asar >> "%LOG_FILE%"
        echo.
        echo Error: cannot restore app.asar.
        echo.
        pause
        exit /b 1
    )
)

echo [%date% %time%] Restore success >> "%LOG_FILE%"
echo.
echo Original app.asar restored.
echo Please restart SGSOL.
echo.
pause
