@echo off
title NextSosyal Print Agent Kaldirma
set TARGET_DIR=%USERPROFILE%\Desktop\NextSosyalPrintAgent
set STARTUP_FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NextSosyal Print Agent.vbs

if exist "%STARTUP_FILE%" del /F /Q "%STARTUP_FILE%"

echo Windows baslangic kaydi kaldirildi.
echo.
echo Agent o anda calisiyorsa bilgisayari yeniden baslatinca tekrar acilmayacak.
echo Klasoru silmek isterseniz:
echo %TARGET_DIR%
echo.
pause
