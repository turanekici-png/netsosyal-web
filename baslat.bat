@echo off
title NetSosyal Baslatici

echo [0/4] Port 3000 kontrol ediliyor ve temizleniyor...
powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }" >nul 2>&1

:: Cakisan ve gereksiz dosyalari temizle
if exist "modules.ts" del /f /q "modules.ts"
if exist "route.ts" del /f /q "route.ts"
if exist "app\route.ts" del /f /q "app\route.ts"
if exist "app\route.js" del /f /q "app\route.js"
if exist "app\(modules)\reports\route.ts" del /f /q "app\(modules)\reports\route.ts"
if exist "app\(modules)\reports\route.js" del /f /q "app\(modules)\reports\route.js"
:: SQL Monitor hatalı klasör temizliği
if exist "app\(modules)\sql-monitor\route.ts" del /f /q "app\(modules)\sql-monitor\route.ts"
if exist "app\sql-monitor\route.ts" del /f /q "app\sql-monitor\route.ts"
if exist "app\(modules)\settings\form-designer\route.ts" del /f /q "app\(modules)\settings\form-designer\route.ts"
:: Proje ana dizinindeki yanlis olusan sayfalari temizle
if exist "page.tsx" del /f /q "page.tsx"
if exist "route.ts" del /f /q "route.ts"
if exist "lib\services\page.tsx" del /f /q "lib\services\page.tsx"

:: Next.js onbellegini (cache) temizle
if exist ".next" rmdir /s /q ".next"

echo [1/4] Prisma istemcisi olusturuluyor...
call npx prisma generate >nul 2>&1

echo [2/4] Veritabani kontrolu...
:: Veritabani yoksa bu adim hata verebilir, bu yuzden artik 'call' ile zorunlu tutmuyoruz.
echo (Test modu: Veritabani baglantisi aranmiyor.)

echo [3/4] KPSV2 NVI servisi kontrol ediliyor...
set KPSV2_PORT=3500
:: KPSV2 koprusu bu makinede IIS Express ile localhost'ta calisir.
set KPSV2_HOST=localhost
call powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-kpsv2.ps1"
if errorlevel 1 (
    echo KPSV2 NVI servisi baslatilamadi. Uygulama NVI sorgusu yapamayacagi icin baslatma durduruldu.
    echo Detay icin logs\kpsv2-iisexpress.err.log ve logs\kpsv2-iisexpress.out.log dosyalarina bakin.
    pause
    exit /b 1
)

echo [4/4] Uygulama IP uzerinden baslatiliyor...
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$line = ipconfig | Select-String 'IPv4.*10\.20\.|IPv4.*192\.168\.' | Select-Object -First 1; if ($line) { ($line.ToString().Split(':')[-1]).Trim() }"`) do (
    set LAN_IP=%%A
)
set LAN_IP=%LAN_IP: =%
if "%LAN_IP%"=="" set LAN_IP=10.20.1.100

echo Ag uzerinden erisim icin: http://%LAN_IP%:3000
echo Yerel erisim icin: http://localhost:3000
echo KPSV2 NVI servisi: http://%KPSV2_HOST%:%KPSV2_PORT%/master.asmx

:: HMR (WebSocket) hatalarini engellemek ve degisiklikleri aninda gormek icin
set WATCHPACK_POLLING=true

:: Next.js'i tum ag arayuzlerine baglayarak baslat
call npx next dev -H 0.0.0.0 -p 3000
pause
