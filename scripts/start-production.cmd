@echo off
REM NetSosyal - production sunucusunu baslatir (npm run start).
REM Windows Gorev Zamanlayici / NSSM / elle calistirma icin sarmalayici.
REM prestart otomatik olarak KPSV2 (NVI) servisini de kontrol eder.
setlocal
cd /d "%~dp0.."
set NODE_ENV=production
call npm run start
