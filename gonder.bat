@echo off
REM NetSosyal - tek tikla GUNCELLEME + IIS'e GONDERME.
REM NSSM servisini durdurur, yeniden derler, servisi baslatir, saglik
REM kontrolu yapar. IIS/sertifika/DNS/servis KAYDINA dokunmaz - onlar
REM kalicidir, sadece uygulama kodu/derlemesi guncellenir.
REM (bkz. scripts\guncelle-yayinla.ps1)
REM
REM Cift tiklayip calistirin ("gonder" komutuyla kastedilen dosya budur) -
REM UAC izniyle bir kere onay verin, gerisi otomatik.

REM NSSM servis komutlari yonetici yetkisi ister - degilsek kendimizi
REM yukselterek (UAC onayiyla) yeniden baslatiyoruz.
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Yonetici yetkisi gerekiyor, yukseltiliyor...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\guncelle-yayinla.ps1"
echo.
pause
