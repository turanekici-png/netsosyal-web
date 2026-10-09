// NFC kart okuyucu ajani (nextsosyal-card-reader-agent.exe, orijinal adiyla
// "NFC_Kart_Oku.exe") icin kurulum govdesi - printAgentInstallerScript.ts
// ile AYNI "Baslangic klasoru + kendi kendini onaran supervisor + best-effort
// Gorev Zamanlayici" ucgen garantisini uygular. TEK FARK: orada bir
// PowerShell betigi (.ps1) "powershell -File" ile baslatiliyordu, burada ise
// kaynagi ELİMİZDE OLMAYAN, kapali-kutu, hazir bir .exe DOGRUDAN
// baslatiliyor - degistirilemez, sadece SESSIZCE her zaman calisir durumda
// tutulur. Bu .exe kendi basina PC/SC ile karti okuyup odaktaki alana
// klavye giriyormus gibi yaziyor; tarayiciyla/HTTP ile hic konusmuyor, bu
// yuzden burada bir "health check" ucu YOK - "calisiyor mu" bilgisi, ayni
// bilgisayarda zaten acik olan Print Agent'in surec listesinden sorulup
// donduruluyor (bkz. nextsosyal-print-agent.ps1 - /card-reader-status).
//
// Bu govde, app/api/print-agent/package/route.ts icindeki install.bat'a,
// print agent kurulumundan HEMEN SONRA (ayni tek tiklamada) eklenir - o
// dosyada zaten tanimli olan %SCRIPT_DIR% ve %REG_PS1% degiskenlerini
// PAYLASIR, kendi hedef klasoru/gorev adi/baslangic dosyalari icin AYRI
// degiskenler (%CARD_READER_...%) kullanir.
//
// NOT (2026-08-17): Ilk surumde kopyalama/baslatma adimlari ">nul 2>nul" ile
// SESSIZE alinmisti (print agent'in kendi adimlarindaki gibi) - canlida
// "yazicilar goruldu ama kart okuyucu gorulmedi" diye bildirildi ve, exe
// bu sunucuda degil kullanicinin KENDI bilgisayarinda oldugu icin, buradan
// uzaktan teshis edilemedi. En olasi sebep: 150MB'lik imzasiz bir exe'nin
// (üstelik sistem geneline klavye enjekte eden bir davranisi oldugu icin)
// kurumsal antivirus tarafindan cikartma sirasinda sessizce karantinaya
// alinmasi/silinmesi - ama kopyalama adimlari sessiz oldugu icin kullanici
// bunu GOREMEDI. Artik her kritik adim (kopyalama, baslatma) SONUCUNU
// ACIKCA yazdiriyor ve en sonda calisip calismadigini tasklist ile
// DOGRUDAN konsola basiyor - boylece bir sonraki denemede sorunun TAM
// olarak neresi oldugu ekran goruntusunden anlasilabilir.
export function buildCardReaderSetupBatchBody(): string {
  return `
echo.
echo === NFC Kart Okuyucu Ajani Kurulumu ===
rem Kaynak exe zip'ten cikartilmamissa (ör. kullanici zip'i tam ayiklamadan
rem calistirdiysa) bu adimi atla - yazici/kamera kurulumunu engellememeli,
rem kart okuyucu opsiyonel bir ek. Bu ACIKCA gorunur bir mesaj - kullanici
rem gozden kacirmasin diye kisa bir bekleme de var.
if not exist "%SCRIPT_DIR%nextsosyal-card-reader-agent.exe" (
  echo NOT: Kart okuyucu ajani dosyasi zip icinde bulunamadi ^("%SCRIPT_DIR%nextsosyal-card-reader-agent.exe"^), bu adim atlandi.
  echo Zip'i TAMAMEN cikardiginizdan emin olun ^(dosya 150MB civarindadir, cikartma biraz surebilir^).
  timeout /t 5 >nul
  goto :card_reader_done
)

if not exist "%CARD_READER_TARGET_DIR%" mkdir "%CARD_READER_TARGET_DIR%" 2>nul
echo Kart okuyucu dosyasi kopyalaniyor ^(150MB civarinda, biraz surebilir^)...
copy /Y "%SCRIPT_DIR%nextsosyal-card-reader-agent.exe" "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe"
rem ONEMLI: "%CARD_READER_TARGET_DIR%" bir sonraki "set" ile degistirilse
rem bile, AYNI parantezli ( ) blok icinde okunan %VAR% degerleri cmd.exe
rem tarafindan blok BASLARKEN (tek seferde) coziliyor - blok icinde
rem "set" ile degistirilmis olsa da o blok icindeki sonraki satirlar ESKI
rem degeri gorur (delayed expansion olmadan). Bu yuzden burada
rem LOCALAPPDATA yolunu degiskene atamak YERINE, dogrudan sabit metin
rem olarak kullaniyoruz - boylece bu tuzaga dusmuyoruz.
if not exist "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe" (
  echo Birincil konuma kopyalama basarisiz oldu, yedek konuma deneniyor: "%LOCALAPPDATA%\\NextSosyalCardReader"
  if not exist "%LOCALAPPDATA%\\NextSosyalCardReader" mkdir "%LOCALAPPDATA%\\NextSosyalCardReader" 2>nul
  copy /Y "%SCRIPT_DIR%nextsosyal-card-reader-agent.exe" "%LOCALAPPDATA%\\NextSosyalCardReader\\nextsosyal-card-reader-agent.exe"
  set "CARD_READER_TARGET_DIR=%LOCALAPPDATA%\\NextSosyalCardReader"
)
if not exist "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe" (
  echo.
  echo UYARI: Kart okuyucu ajani kopyalanamadi ^(hedef: "%CARD_READER_TARGET_DIR%"^), bu adim atlandi.
  echo Yukaridaki satirlarda Windows'un/antivirus yaziliminin gosterdigi hata mesajina bakin -
  echo TREND MICRO veya baska bir antivirus, 150MB'lik bu dosyayi supheli gorup SESSIZCE
  echo karantinaya alabilir/silebilir - oyleyse bilgi islemden bu dosya icin istisna isteyin.
  timeout /t 8 >nul
  goto :card_reader_done
)
echo Kart okuyucu dosyasi kopyalandi: "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe"

schtasks /delete /tn "%CARD_READER_TASK_NAME%" /f >nul 2>nul

rem Eski calisan kart okuyucu sureclerini kapat - yeni supervisor ile
rem CAKISMASIN (iki kopya birden ayni karti klavyeye iki kez yazmasin).
(
  echo $ErrorActionPreference = 'SilentlyContinue'
  echo try {
  echo   Get-Process -Name 'nextsosyal-card-reader-agent' ^| ForEach-Object { try { Stop-Process -Id $_.Id -Force } catch {} }
  echo } catch {}
  echo Start-Sleep -Milliseconds 500
) > "%REG_PS1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REG_PS1%" >nul 2>nul
del /F /Q "%REG_PS1%" >nul 2>nul

rem "Supervisor" betigi: exe'yi baslatir, kapanirsa/cokerse 60 saniye
rem bekleyip tekrar baslatir - sonsuz dongude calisir (print agent
rem supervisor'iyle AYNI mantik, bkz. printAgentInstallerScript.ts).
(
  echo $ErrorActionPreference = 'Stop'
  echo $ExePath = '%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe'
  echo while ^($true^) {
  echo   try { Start-Process -FilePath $ExePath -WindowStyle Hidden -Wait } catch {}
  echo   Start-Sleep -Seconds 60
  echo }
) > "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1"

rem Baslangic klasorune, oturum acilinca supervisor'i sessizce baslatan VBS
rem launcher (birincil mekanizma - ozel izin gerektirmez).
(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.Run "powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1""", 0, False
) > "%CARD_READER_STARTUP_FILE%"

rem AYRICA (VBS'e EK olarak) ayni Baslangic klasorune bir .bat launcher da
rem yaziyoruz - kurumsal politika Windows Script Host'u kapatmis olsa bile
rem (VBS engellenmis olsa bile) calismaya devam etsin diye.
(
  echo @echo off
  echo start "" /min powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1"
) > "%CARD_READER_STARTUP_FILE_BAT%"

rem Indirilen zip'ten miras kalan "internetten indirildi" izini (Zone.Identifier)
rem temizle - yoksa Baslangic klasorundeki dosyalar her oturum acilisinda
rem "Yine de calistir" onayi isteyip OTOMATIK baslamayabiliyor, VE (asil
rem onemlisi) SmartScreen tam da bu izi tasiyan .exe dosyalarinin
rem CALISTIRILMASINI "Windows kisisel bilgisayarinizi korudu" penceresiyle
rem engelleyebiliyor - canlida tam bu sekilde gozlemlendi (kopyalama
rem basarili, ama exe hem elle hem supervisor'dan baslatilamiyor). "del
rem :Zone.Identifier" ile AYNI izi kaldiran, PowerShell'in kendi resmi
rem yontemi olan Unblock-File'i da EK bir guvence katmani olarak
rem calistiriyoruz - ikisi de basarisiz olursa (ör. Windows 11'in daha
rem sert "Akilli Uygulama Denetimi" ozelligi devredeyse) exe yine de
rem calismayabilir, bu durumda kullanicinin IT ile konusmasi gerekir.
del "%CARD_READER_STARTUP_FILE%:Zone.Identifier" >nul 2>nul
del "%CARD_READER_STARTUP_FILE_BAT%:Zone.Identifier" >nul 2>nul
del "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1:Zone.Identifier" >nul 2>nul
del "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe:Zone.Identifier" >nul 2>nul
(
  echo $ErrorActionPreference = 'SilentlyContinue'
  echo Unblock-File -Path '%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe'
  echo Unblock-File -Path '%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1'
  echo Unblock-File -Path '%CARD_READER_STARTUP_FILE%'
  echo Unblock-File -Path '%CARD_READER_STARTUP_FILE_BAT%'
) > "%REG_PS1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REG_PS1%" >nul 2>nul
del /F /Q "%REG_PS1%" >nul 2>nul

rem UCUNCU guvence katmani: mumkunse Gorev Zamanlayici'ya da SESSIZCE bir
rem gorev eklemeyi dene - bazi bilgisayarlarda engelli olabilir, bu adim
rem basarisiz olsa bile kurulum durmaz (Baslangic klasoru zaten birincil
rem garanti).
(
  echo $ErrorActionPreference = 'SilentlyContinue'
  echo try {
  echo   $service = New-Object -ComObject Schedule.Service
  echo   $service.Connect^(^)
  echo   $rootFolder = $service.GetFolder^('\\'^)
  echo   try { $rootFolder.DeleteTask^('%CARD_READER_TASK_NAME%', 0^) } catch {}
  echo   $taskDef = $service.NewTask^(0^)
  echo   $taskDef.RegistrationInfo.Description = 'NextSosyal NFC kart okuyucu ajani - oturum acilinca otomatik baslar.'
  echo   $trigger = $taskDef.Triggers.Create^(9^)
  echo   $trigger.Enabled = $true
  echo   $action = $taskDef.Actions.Create^(0^)
  echo   $action.Path = 'powershell.exe'
  echo   $action.Arguments = '-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1"'
  echo   $taskDef.Settings.MultipleInstances = 2
  echo   $taskDef.Settings.DisallowStartIfOnBatteries = $false
  echo   $taskDef.Settings.StopIfGoingOnBatteries = $false
  echo   $taskDef.Settings.StartWhenAvailable = $true
  echo   $taskDef.Settings.ExecutionTimeLimit = 'PT0S'
  echo   $taskDef.Principal.LogonType = 3
  echo   $taskDef.Principal.RunLevel = 0
  echo   $rootFolder.RegisterTaskDefinition^('%CARD_READER_TASK_NAME%', $taskDef, 6, $null, $null, 3^) ^| Out-Null
  echo } catch {}
) > "%REG_PS1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REG_PS1%" >nul 2>nul
del /F /Q "%REG_PS1%" >nul 2>nul

rem Supervisor'i kurulumun hemen ardindan da baslat - oturumu kapat/ac
rem etmeye gerek kalmadan kart okuyucu bu andan itibaren calisir.
start "" /min powershell -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent-supervisor.ps1"

rem Birkac saniye bekleyip GERCEKTEN calisip calismadigini DOGRUDAN bu
rem konsola yazdir - kullanici web panelini acmaya bile gerek kalmadan,
rem kurulumun sonunda net bir BASARILI/BASARISIZ gorsun.
echo Kart okuyucu servisinin baslamasi bekleniyor...
timeout /t 5 >nul
tasklist /FI "IMAGENAME eq nextsosyal-card-reader-agent.exe" | find /I "nextsosyal-card-reader-agent.exe" >nul
if errorlevel 1 (
  echo.
  echo UYARI: Kart okuyucu servisi kurulumdan sonra 5 saniye icinde baslamadi.
  echo Olasi sebepler: antivirus dosyayi/calismasini engelliyor olabilir, ya da bu
  echo bilgisayarda kart okuyucu SDK/surucusu eksik olabilir. "%CARD_READER_TARGET_DIR%\\nextsosyal-card-reader-agent.exe"
  echo dosyasina elle cift tiklayip ne oldugunu ^(hata penceresi var mi^) kontrol edin.
) else (
  echo.
  echo NFC kart okuyucu servisi CALISIYOR. Bu bilgisayarda oturum acildiginda otomatik baslayacak.
  echo Artik herhangi bir "Kart No" alanina tiklayip karti okuyucuya okutmaniz yeterli.
)
:card_reader_done
`
}
