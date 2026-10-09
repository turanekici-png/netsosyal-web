@echo off
title NextSosyal Print Agent
set SCRIPT_DIR=%~dp0
if not exist "%SCRIPT_DIR%nextsosyal-print-agent.ps1" (
  echo HATA: nextsosyal-print-agent.ps1 bulunamadi.
  echo.
  echo Bu bat dosyasi tek basina calismaz.
  echo start-nextsosyal-print-agent.bat ve nextsosyal-print-agent.ps1 ayni klasorde olmali.
  echo.
  echo Onerilen: scripts\install-nextsosyal-print-agent.bat dosyasini calistirin.
  pause
  exit /b 1
)
powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%nextsosyal-print-agent.ps1"
pause
