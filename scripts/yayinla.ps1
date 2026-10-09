# NetSosyal - tek adimda YAYIN:
#   1) KPSV2 (NVI nufus sorgulama) koprusunu baslatir
#   2) .next onbellegini temizler ve production build alir
#   3) Next.js production sunucusunu arka planda (gizli) baslatir
#   4) Her ikisinin sagligini kontrol eder
#
# Kullanim:  scripts\yayinla.bat   (cift tikla)  ya da  powershell -File scripts\yayinla.ps1
#   -SkipBuild  : build almadan sadece servisleri baslatir

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$root      = Split-Path -Parent $PSScriptRoot
$port      = 3000
$logDir    = Join-Path $root 'logs'
$outLog    = Join-Path $root 'server-out.log'
$errLog    = Join-Path $root 'server-err.log'
$nextBin   = Join-Path $root 'node_modules\next\dist\bin\next'
$nodeExe   = (Get-Command node -ErrorAction SilentlyContinue).Source

Set-Location $root
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Log dosyasi belirtilen boyutu asmissa .1 uzantiyla arsivler ve yerine bos
# dosya birakir (tek nesil rotasyon). Boylece server-out/err.log sinirsiz
# buyuyup diski doldurmaz (WhatsApp her baslangicta cok satir basiyor).
function Rotate-Log($path, $maxMB = 5) {
  if (-not (Test-Path $path)) { return }
  $sizeMB = (Get-Item $path).Length / 1MB
  if ($sizeMB -lt $maxMB) { return }
  $archive = "$path.1"
  if (Test-Path $archive) { Remove-Item $archive -Force -ErrorAction SilentlyContinue }
  Move-Item $path $archive -Force -ErrorAction SilentlyContinue
  Write-Host ("  Log arsivlendi ({0:N1} MB): {1} -> {1}.1" -f $sizeMB, (Split-Path $path -Leaf)) -ForegroundColor DarkGray
}

function Kill-Port($p) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $procId = $_.OwningProcess
    try {
      Invoke-CimMethod -Query "SELECT * FROM Win32_Process WHERE ProcessId=$procId" -MethodName Terminate | Out-Null
    } catch {
      try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch {}
    }
  }
}

Write-Host ''
Write-Host '=== [1/4] KPSV2 (NVI) koprusu ===' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'start-kpsv2.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host 'UYARI: KPSV2 koprusu baslatilamadi. Nufus sorgulama calismayabilir.' -ForegroundColor Yellow
  Write-Host 'Detay: logs\kpsv2-iisexpress.err.log' -ForegroundColor Yellow
}

if (-not $SkipBuild) {
  Write-Host ''
  Write-Host '=== [2/4] Build (.next temizleniyor) ===' -ForegroundColor Cyan
  # Calisan eski sunucu (ve onun WhatsApp Chromium'u) .wwebjs_auth altindaki
  # dosyalari kilitli tutuyor; Next 16.3 dosya izleyicisi build sirasinda
  # bunlari okumaya calisip "os error 33" ile patliyordu. Build oncesi
  # sunucuyu kapat (koprusu :3500 ayakta kalir).
  Kill-Port $port
  Start-Sleep -Milliseconds 500
  if (Test-Path (Join-Path $root '.next')) { Remove-Item (Join-Path $root '.next') -Recurse -Force }
  & npx next build
  if ($LASTEXITCODE -ne 0) { Write-Host 'BUILD BASARISIZ - yayin durduruldu.' -ForegroundColor Red; exit 1 }
} else {
  Write-Host ''
  Write-Host '=== [2/4] Build atlandi (-SkipBuild) ===' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '=== [3/4] Sunucu baslatiliyor (arka planda) ===' -ForegroundColor Cyan
Kill-Port $port
Start-Sleep -Milliseconds 500
# Yeni sunucu surecine RedirectStandardOutput/Error zaten dosyalari SIFIRDAN
# yazar; burada sadece onceki oturumun logu BUYUKSE .1 olarak saklanir
# (post-mortem icin), kucukse oldugu gibi birakilip uzerine yazilir.
Rotate-Log $outLog
Rotate-Log $errLog

$env:NODE_ENV = 'production'
$proc = Start-Process -FilePath $nodeExe `
  -ArgumentList @($nextBin, 'start', '-H', '0.0.0.0', '-p', "$port") `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Write-Host "  node PID = $($proc.Id)"

Write-Host ''
Write-Host '=== [4/4] Saglik kontrolu ===' -ForegroundColor Cyan
$appOk = $false
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing "http://localhost:$port" -TimeoutSec 5
    if ($r.StatusCode -ge 200) { $appOk = $true; break }
  } catch {}
  if ($proc.HasExited) { Write-Host "  Sunucu erken kapandi (ExitCode=$($proc.ExitCode)). server-err.log'a bakin." -ForegroundColor Red; break }
}

$kpsOk = $false
try {
  $k = Invoke-WebRequest -UseBasicParsing 'http://localhost:3500/master.asmx' -TimeoutSec 5
  $kpsOk = $k.StatusCode -eq 200 -and $k.Content.Contains('KimlikBilgisiGetirTurkV2')
} catch {}

$lan = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -match '^(10\.20\.|192\.168\.)' } |
  Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $lan) { $lan = 'localhost' }

Write-Host ''
Write-Host ('  Uygulama (3000)   : ' + $(if ($appOk) { 'CALISIYOR' } else { 'YANIT YOK' })) -ForegroundColor $(if ($appOk) { 'Green' } else { 'Red' })
Write-Host ('  NVI koprusu (3500): ' + $(if ($kpsOk) { 'CALISIYOR' } else { 'YANIT YOK' })) -ForegroundColor $(if ($kpsOk) { 'Green' } else { 'Yellow' })
Write-Host ''
Write-Host "  Yerel : http://localhost:$port"
Write-Host "  Ag    : http://$($lan):$port"
Write-Host "  WAN   : http://88.247.62.145:$port"
Write-Host ''
if (-not $appOk) { exit 1 }
