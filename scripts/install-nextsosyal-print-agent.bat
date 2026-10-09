@echo off
title NextSosyal Print Agent Kurulum
set SCRIPT_DIR=%~dp0
set TARGET_DIR=%USERPROFILE%\Desktop\NextSosyalPrintAgent
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set STARTUP_FILE=%STARTUP_DIR%\NextSosyal Print Agent.vbs

if not exist "%SCRIPT_DIR%nextsosyal-print-agent.ps1" (
  echo HATA: Kaynak dosya bulunamadi:
  echo %SCRIPT_DIR%nextsosyal-print-agent.ps1
  pause
  exit /b 1
)

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

copy /Y "%SCRIPT_DIR%nextsosyal-print-agent.ps1" "%TARGET_DIR%\nextsosyal-print-agent.ps1" >nul
copy /Y "%SCRIPT_DIR%start-nextsosyal-print-agent.bat" "%TARGET_DIR%\start-nextsosyal-print-agent.bat" >nul

(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.Run "powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%TARGET_DIR%\nextsosyal-print-agent.ps1""", 0, False
) > "%TARGET_DIR%\start-nextsosyal-print-agent-hidden.vbs"

copy /Y "%TARGET_DIR%\start-nextsosyal-print-agent-hidden.vbs" "%STARTUP_FILE%" >nul
wscript.exe "%TARGET_DIR%\start-nextsosyal-print-agent-hidden.vbs"

echo Kurulum tamamlandi.
echo.
echo Agent klasoru:
echo %TARGET_DIR%
echo.
echo Agent arka planda baslatildi.
echo Bilgisayar acildiginda otomatik ve gizli calismasi icin Windows baslangicina eklendi:
echo %STARTUP_FILE%
echo.
echo Gorunur pencereyle manuel baslatmak icin:
echo %TARGET_DIR%\start-nextsosyal-print-agent.bat
echo.
pause
