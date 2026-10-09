# NetSosyal - IIS/NSSM kurulumu icin TEK KOMUTLA GUNCELLEME.
#
# Mevcut yayin mimarisi: NSSM "NetSosyal" servisi bu proje klasorunden
# dogrudan `next start` calistirir (port 3000); IIS (netsosyal.sivas.bel.tr,
# HTTPS) buna ters proxy yapar. Kod her degistiginde YENIDEN DERLENMESI ve
# servisin bunu gormesi icin YENIDEN BASLATILMASI gerekir - IIS/sertifika/
# DNS/NSSM servis KAYDI tekrar kurulmaz, hepsi oldugu gibi kalir.
#
# 2026-09-12: Kullanici istegi - artik SADECE bu makineye (birincil) yayin
# yapiliyor. Eskiden burada 10.20.1.100'e (X:\ paylasimi) ikincil bir
# standalone paket de build edilip kopyalaniyor ve orada uzaktan servis
# yeniden baslatiliyordu - bu adim TAMAMEN KALDIRILDI (bkz.
# guncelle-yayinla.ps1.bak_20260912_before_secondary_removal - eski hali).
# 10.20.1.100'e artik hicbir sekilde otomatik gonderim YAPILMIYOR.
#
# Kullanim (yonetici PowerShell'den):
#   powershell -ExecutionPolicy Bypass -File scripts\guncelle-yayinla.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$serviceName = 'NetSosyal'
$nssm = if (Test-Path 'C:\nssm\nssm.exe') { 'C:\nssm\nssm.exe' } else { 'nssm' }
$node = (Get-Command node).Source
$maintScript = Join-Path $PSScriptRoot 'maintenance-server.js'
$maint = $null

Write-Host ''
Write-Host '=== [1/4] Servis durduruluyor ===' -ForegroundColor Cyan
& $nssm stop $serviceName | Out-Null
Start-Sleep -Seconds 2

# WhatsApp Web'in Chromium sureci build sirasinda .wwebjs_auth dosyalarini
# kilitli tutup "os error 32/33" ile derlemeyi patlatabiliyor (bkz.
# next.config.js yorumu) - build oncesi temizle.
$chrome = Get-Process chrome -ErrorAction SilentlyContinue
if ($chrome) {
  $chrome | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "  $($chrome.Count) adet chrome.exe kapatildi (WhatsApp oturumu)"
}
Start-Sleep -Seconds 1

Write-Host ''
Write-Host '=== [2/4] Bakim sayfasi devreye aliniyor (port 3000) ===' -ForegroundColor Cyan
# Derleme suresince hem dogrudan :3000 hem IIS proxy uzerinden gelen
# kullanicilar "Guncelleme yapiliyor, lutfen bekleyiniz" sayfasi gorur;
# sayfa 8 sn'de bir yenilenir -> uygulama gelince otomatik acilir.
if (Test-Path $maintScript) {
  try {
    $maint = Start-Process -FilePath $node -ArgumentList "`"$maintScript`"" -WorkingDirectory $root -WindowStyle Hidden -PassThru
    for ($i = 1; $i -le 15; $i++) {
      Start-Sleep -Milliseconds 400
      try { if ((Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/' -TimeoutSec 3).StatusCode) { break } } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 503) { break }
      }
    }
    Write-Host '  Bakim sayfasi aktif.'
  } catch {
    Write-Host "  UYARI: bakim sayfasi baslatilamadi ($($_.Exception.Message)) - devam ediliyor." -ForegroundColor Yellow
    $maint = $null
  }
}

Write-Host ''
Write-Host '=== [3/4] Build (bu makine icin, .next) ===' -ForegroundColor Cyan
Remove-Item Env:\BUILD_TARGET -ErrorAction SilentlyContinue
Remove-Item Env:\STANDALONE_DIST -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $root '.next')) { Remove-Item (Join-Path $root '.next') -Recurse -Force }
& npx next build
$buildExit = $LASTEXITCODE

Write-Host ''
Write-Host '=== [4/4] Bakim sayfasi kaldiriliyor + servis baslatiliyor ===' -ForegroundColor Cyan
if ($maint -and -not $maint.HasExited) {
  try { $maint.CloseMainWindow() | Out-Null } catch {}
  try { Stop-Process -Id $maint.Id -Force -ErrorAction SilentlyContinue } catch {}
}
# Port 3000 gercekten bosalsin (aksi halde nssm start EADDRINUSE ile patlar)
for ($i = 1; $i -le 20; $i++) {
  if (-not (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 300
}

if ($buildExit -ne 0) {
  Write-Host 'BUILD BASARISIZ - eski derleme silindigi icin servis simdi baslamayabilir!' -ForegroundColor Red
  Write-Host 'Once hatayi duzeltip scripti tekrar calistirin.' -ForegroundColor Red
  & $nssm start $serviceName
  exit 1
}

& $nssm start $serviceName

Write-Host ''
Write-Host '=== Nufus (KPS/NVI) servisleri kontrol ediliyor ===' -ForegroundColor Cyan
# Kullanici istegi (13 Eylul 2026): "nufus servisi calismiyor, NetSosyal ile
# birlikte KPS servisini de yayinlayip baslatsin" - NetSosyalKPSV2 (IIS
# Express uzerinden calisan gercek NVI koprusu, :3500) ve NetSosyalNviRelay
# (disaridan gelen sorgulari bu koprüye ileten Node servisi, :4000) artik
# NSSM AUTO_START servisleri (sunucu yeniden baslasa bile kendiliginden
# ayaga kalkarlar) - burada AYRICA her yayinda "calismiyorsa baslat" kontrolu
# yapiliyor, cunku bu ikisi NetSosyal'den BAGIMSIZ servislerdir, "nssm stop/
# start NetSosyal" onlara dokunmaz ama olasi bir cokme/manuel durdurma
# sonrasi deploy anini bir "hala ayakta mi" kontrol firsati olarak kullaniyoruz.
foreach ($svc in @('NetSosyalKPSV2', 'NetSosyalNviRelay')) {
  $status = (Get-Service -Name $svc -ErrorAction SilentlyContinue).Status
  if ($null -eq $status) {
    Write-Host "  UYARI: '$svc' servisi bu makinede kurulu degil." -ForegroundColor Yellow
    continue
  }
  if ($status -ne 'Running') {
    Write-Host "  '$svc' calismiyor ($status) - baslatiliyor..." -ForegroundColor Yellow
    & $nssm start $svc | Out-Null
    Start-Sleep -Seconds 2
  } else {
    Write-Host "  '$svc' zaten calisiyor."
  }
}

$kpsv2Ok = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:3500/master.asmx' -TimeoutSec 5
    if ($r.StatusCode -eq 200) { $kpsv2Ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if ($kpsv2Ok) {
  Write-Host '  KPSV2 (nufus sorgu koprusu) saglikli - http://localhost:3500/master.asmx' -ForegroundColor Green
} else {
  Write-Host '  UYARI: KPSV2 (:3500) yanit vermiyor - nufus sorgulama calismayabilir. Loglara bakin:' -ForegroundColor Red
  Write-Host "    Get-Content `"$root\logs\kpsv2-iisexpress.err.log`" -Tail 30"
}

Write-Host ''
Write-Host '=== Saglik kontrolu ===' -ForegroundColor Cyan
$appOk = $false
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/login' -TimeoutSec 5
    if ($r.StatusCode -eq 200) { $appOk = $true; break }
  } catch {}
}

Write-Host ''
if ($appOk) {
  Write-Host '  AYAKTA VE YAYINDA - https://netsosyal.sivas.bel.tr' -ForegroundColor Green
} else {
  Write-Host '  UYARI: 30 saniyede yanit vermedi - loglara bakin:' -ForegroundColor Red
  Write-Host "    Get-Content `"$root\logs\nssm-out.log`" -Tail 30"
}
if (-not $kpsv2Ok) {
  Write-Host '  UYARI: Nufus sorgulama (KPSV2) saglik kontrolunden GECEMEDI - yukarida detay var.' -ForegroundColor Red
}
Write-Host ''
