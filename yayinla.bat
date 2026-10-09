@echo off
REM NetSosyal - tek adimda yayin: NVI koprusu + build + production sunucusu
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\yayinla.ps1" %*
echo.
pause
