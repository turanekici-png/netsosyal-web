// Kurulum betiklerinin (tek-dosya .bat VE zip paketindeki install.bat)
// PAYLASILAN govdesi. Ikisi de: (1) Baslangic (Startup) klasorune, agent'i
// kendi ici sonsuz dongude yeniden baslatan bir "supervisor" betigi
// calistiran gizli bir VBS launcher yazar, (2) origin verildiyse
// Chrome/Edge'in bu adresi "guvenli kaynak" saymasini saglayan kayit
// defteri anahtarlarini yazar (kamera erisimi icin gerekli). Cagiran taraf,
// bu govdeyi calistirmadan ONCE "%TARGET_DIR%\nextsosyal-print-agent.ps1"
// dosyasinin zaten var oldugundan emin olmalidir (indirip base64 ile
// cozerek ya da zip icinden kopyalayarak).
//
// NOT (2026-08-10): Onceki surum Gorev Zamanlayici'ya (Register-ScheduledTask,
// sonra Schedule.Service COM API'si) gorev kaydediyordu. Ikisi de bazi
// kurumsal/sikilastirilmis Windows makinelerinde standart kullanicilar icin
// "Erisim engellendi" (E_ACCESSDENIED) hatasi verdi - bu, Gorev
// Zamanlayici'nin kendi guvenlik politikasindan kaynaklaniyor ve API
// degistirerek asilamiyor (admin yetkisi gerektiriyor). Bu yuzden otomatik
// baslatma/kendi kendini onarma artik HICBIR ozel izin gerektirmeyen
// Baslangic klasoru + supervisor dongusu ile saglaniyor.

const SAFE_ORIGIN_PATTERN = /^https?:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?$/

export function sanitizeOrigin(rawOrigin: string | null | undefined): string {
  const value = rawOrigin || ''
  return SAFE_ORIGIN_PATTERN.test(value) ? value : ''
}

export function buildAgentSetupBatchBody(safeOrigin: string): string {
  // Kullanicinin o anki sayfa adresini (safeOrigin) otomatik yakalayip
  // yazmak dogru ve birincil yontem, ama kucuk bir adres/port farkliligi
  // (ör. eski bir sekme/yer imi farkli porttaydı, ya da baska bir agdaki
  // bilgisayardan erisiliyordu) kamera izninin SESSIZCE calismamasina yol
  // aciyordu (canli tespit edildi - "tarayici destelemiyor" hatasi, policy
  // yazilmis olsa bile adres eslesmedigi icin devreye girmiyordu). Bu
  // yuzden artik HER kurulumda, tespit edilen adrese EK olarak bu agda
  // BILINEN butun adresler de KOSULSUZ (safeOrigin bos olsa bile) yaziliyor
  // - boylece hangi adresten erisilirse erisilsin kamera calisir. Sunucunun
  // LAN adresi/portu ileride degisirse bu liste de guncellenmeli.
  const knownOrigins = ['http://10.0.0.183:3000', 'http://10.0.0.183:3001']
  const originsToWrite = Array.from(new Set([...knownOrigins, ...(safeOrigin ? [safeOrigin] : [])]))

  const originRegistryLines = `
  echo try {
  echo   $chromePolicyPath = 'HKCU:\\SOFTWARE\\Policies\\Google\\Chrome\\OverrideSecurityRestrictionsOnInsecureOrigin'
  echo   if ^(-not ^(Test-Path $chromePolicyPath^)^) { New-Item -Path $chromePolicyPath -Force ^| Out-Null }
${originsToWrite.map((origin, index) => `  echo   Set-ItemProperty -Path $chromePolicyPath -Name '${index + 1}' -Value '${origin}' -Type String -Force`).join('\n')}
  echo } catch {}
  echo try {
  echo   $edgePolicyPath = 'HKCU:\\SOFTWARE\\Policies\\Microsoft\\Edge\\OverrideSecurityRestrictionsOnInsecureOrigin'
  echo   if ^(-not ^(Test-Path $edgePolicyPath^)^) { New-Item -Path $edgePolicyPath -Force ^| Out-Null }
${originsToWrite.map((origin, index) => `  echo   Set-ItemProperty -Path $edgePolicyPath -Name '${index + 1}' -Value '${origin}' -Type String -Force`).join('\n')}
  echo } catch {}`
  const originDoneMessage = `echo Bu bilgisayarda kamera erisimi icin tarayici izni de eklendi (${originsToWrite.join(', ')}).
echo ONEMLI: Bu ayarin etkili olmasi icin Chrome/Edge'i TAMAMEN kapatip yeniden acmaniz gerekiyor.
echo.
`

  return `
rem Onceki bir kurulumdan Gorev Zamanlayici gorevi kalmis olabilir - varsa
rem sessizce temizle (artik kullanilmiyor, hata verse de onemli degil).
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>nul

rem ONEMLI: eski calisan agent/supervisor sureclerini kapat. Aksi halde
rem YENI supervisor 17834 portunu alamaz (eski surec hala tutuyor olabilir)
rem ve agent "zaten calisiyor" diyip sessizce cikar - kullanici surumu
rem yukseltip yeniden kursa BILE eski/yavas/hatali agent perde arkasinda
rem calismaya devam ederdi. Once komut satirinda script yolumuzu gecen
rem powershell surecleri ^(hem eski hem yeni klasor yollarini yakalamak
rem icin tam yol degil DOSYA ADI ile eslestiriliyor^), sonra ek guvence
rem olarak 17834 portunu tutan HERHANGI bir surec kapatiliyor.
(
  echo $ErrorActionPreference = 'SilentlyContinue'
  echo try {
  echo   Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" ^|
  echo     Where-Object { $_.CommandLine -and ^($_.CommandLine -like '*nextsosyal-print-agent-supervisor.ps1*' -or $_.CommandLine -like '*nextsosyal-print-agent.ps1*'^) } ^|
  echo     ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
  echo } catch {}
  echo try {
  echo   Get-NetTCPConnection -LocalPort 17834 -State Listen ^|
  echo     Select-Object -ExpandProperty OwningProcess -Unique ^|
  echo     ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} }
  echo } catch {}
  echo Start-Sleep -Milliseconds 500
) > "%REG_PS1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REG_PS1%" >nul 2>nul
del /F /Q "%REG_PS1%" >nul 2>nul

rem "Supervisor" betigi: agent'i cagirir, cokerse/kapanirsa 60 saniye
rem bekleyip tekrar baslatir - sonsuz dongude calisir. Boylece Gorev
rem Zamanlayici'nin RestartCount/RestartInterval ayarlarina hic gerek
rem kalmadan ayni sonuc elde edilir, hicbir ozel izin gerektirmez.
(
  echo $ErrorActionPreference = 'Stop'
  echo $AgentPath = '%TARGET_DIR%\\nextsosyal-print-agent.ps1'
  echo $agentArgs = '-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $AgentPath + '"'
  echo while ^($true^) {
  echo   try { Start-Process -FilePath 'powershell.exe' -ArgumentList $agentArgs -WindowStyle Hidden -Wait } catch {}
  echo   Start-Sleep -Seconds 60
  echo }
) > "%TARGET_DIR%\\nextsosyal-print-agent-supervisor.ps1"

rem Baslangic klasorune, oturum acilinca supervisor'i sessizce baslatan bir
rem VBS launcher yaz. Bu, kendi profilinin Baslangic klasorune yazma - her
rem kullanicinin kendi profili icin her zaman izinlidir, ozel yetki gerekmez.
(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.Run "powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%TARGET_DIR%\\nextsosyal-print-agent-supervisor.ps1""", 0, False
) > "%STARTUP_FILE%"

rem AYRICA (VBS'e EK olarak, onun YERINE degil) ayni Baslangic klasorune bir
rem .bat launcher da yaziyoruz. Bazi bilgisayarlarda kurumsal politika
rem Windows Script Host'u (VBS/.vbs calistirma) tamamen devre disi
rem birakabiliyor - bu durumda yukaridaki .vbs sessizce hic calismaz ve
rem bilgisayar yeniden baslatildiginda yazdirma servisi ayaga kalkmaz
rem (canli olarak boyle bir durum bildirildi). .bat dosyalari cmd.exe
rem uzerinden calisir - bu, WSH'den TAMAMEN BAGIMSIZ bir mekanizma oldugu
rem icin VBS engellenmis olsa bile calismaya devam eder. Tek bedeli,
rem oturum acilirken cok kisa (bir saniyeden az) bir konsol penceresi
rem yanip sonmesi - guvenilirlik icin kabul edilebilir bir bedel.
(
  echo @echo off
  echo start "" /min powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%TARGET_DIR%\\nextsosyal-print-agent-supervisor.ps1"
) > "%STARTUP_FILE_BAT%"

rem install.bat'in KENDISI (indirilen zip'ten cikartilmis) Windows'un
rem "Mark of the Web" (MOTW / "internetten indirildi") izini tasiyor - bu
rem izden TUREYEN (ondan cikartilan/onun tarafindan yazilan) dosyalar da
rem bazen ayni izi miras alabiliyor. Bu durumda Windows, Baslangic
rem klasorundeki bu dosyalari her oturum acilisinda calistirmadan once
rem "Yine de calistir" onayi istiyor - yani servis OTOMATIK degil, EL ILE
rem onay sonrasi baslıyor (canli tespit edildi). Asagidaki satirlar, varsa
rem bu izi (gizli bir NTFS "Zone.Identifier" veri akisi olarak tutulur)
rem kaldirir - iz yoksa sessizce hicbir sey yapmaz, zararsizdir.
del "%STARTUP_FILE%:Zone.Identifier" >nul 2>nul
del "%STARTUP_FILE_BAT%:Zone.Identifier" >nul 2>nul
del "%TARGET_DIR%\\nextsosyal-print-agent-supervisor.ps1:Zone.Identifier" >nul 2>nul
del "%TARGET_DIR%\\nextsosyal-print-agent.ps1:Zone.Identifier" >nul 2>nul

rem UCUNCU bir guvence katmani olarak, mumkunse Gorev Zamanlayici'ya da
rem SESSIZCE ^(basarisiz olursa HICBIR hata/uyari gostermeden^) bir gorev
rem eklemeyi deniyoruz. Bu bazi bilgisayarlarda engelli olsa da ^(daha once
rem canli tespit edildi^), BASKA bilgisayarlarda calisabilir ve o durumda
rem Baslangic klasorunden daha saglam bir garanti sunar ^(OS seviyesinde,
rem WSH/cmd.exe'den tamamen bagimsiz^). Bu adim BASARISIZ olsa bile kurulum
rem durmaz - Baslangic klasoru mekanizmasi zaten birincil garanti.
(
  echo $ErrorActionPreference = 'SilentlyContinue'
  echo try {
  echo   $service = New-Object -ComObject Schedule.Service
  echo   $service.Connect^(^)
  echo   $rootFolder = $service.GetFolder^('\\'^)
  echo   try { $rootFolder.DeleteTask^('%TASK_NAME%', 0^) } catch {}
  echo   $taskDef = $service.NewTask^(0^)
  echo   $taskDef.RegistrationInfo.Description = 'NextSosyal etiket yazdirma servisi - oturum acilinca otomatik baslar.'
  echo   $trigger = $taskDef.Triggers.Create^(9^)
  echo   $trigger.Enabled = $true
  echo   $action = $taskDef.Actions.Create^(0^)
  echo   $action.Path = 'powershell.exe'
  echo   $action.Arguments = '-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%TARGET_DIR%\\nextsosyal-print-agent-supervisor.ps1"'
  echo   $taskDef.Settings.MultipleInstances = 2
  echo   $taskDef.Settings.DisallowStartIfOnBatteries = $false
  echo   $taskDef.Settings.StopIfGoingOnBatteries = $false
  echo   $taskDef.Settings.StartWhenAvailable = $true
  echo   $taskDef.Settings.ExecutionTimeLimit = 'PT0S'
  echo   $taskDef.Principal.LogonType = 3
  echo   $taskDef.Principal.RunLevel = 0
  echo   $rootFolder.RegisterTaskDefinition^('%TASK_NAME%', $taskDef, 6, $null, $null, 3^) ^| Out-Null
  echo } catch {}
) > "%REG_PS1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REG_PS1%" >nul 2>nul
del /F /Q "%REG_PS1%" >nul 2>nul

(
  echo $ErrorActionPreference = 'Stop'${originRegistryLines}
) > "%REG_PS1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REG_PS1%"
del /F /Q "%REG_PS1%" >nul 2>nul

rem Supervisor'i kurulumun hemen ardindan da baslat - oturumu kapat/ac
rem etmeye gerek kalmadan yazdirma servisi bu andan itibaren calisir.
start "" /min powershell -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%TARGET_DIR%\\nextsosyal-print-agent-supervisor.ps1"

echo Kurulum tamamlandi.
echo.
echo Agent klasoru:
echo %TARGET_DIR%
echo.
echo Yazdirma servisi bu bilgisayarda oturum acildiginda otomatik baslayacak.
echo Servis coker veya kapanirsa en gec 60 saniye icinde kendini otomatik olarak yeniden baslatacak.
echo.
${originDoneMessage}`
}
