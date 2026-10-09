$ErrorActionPreference = 'Stop'

$port = if ($env:KPSV2_PORT) { [int]$env:KPSV2_PORT } else { 3500 }

# KPSV2 koprusu IIS Express ile bu makinede (uygulama sunucusu) calisir.
# 10.0.0.183 bu makinenin IP'si DEGIL; oraya baglama "Erisim engellendi"
# ile basarisiz oluyordu. Varsayilan localhost - farkli bir adres icin
# KPSV2_HOST ortam degiskeni verin.
$kpsv2Host = if ($env:KPSV2_HOST) { $env:KPSV2_HOST } else { 'localhost' }
$healthUrl = "http://$($kpsv2Host):$($port)/master.asmx"

$appPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'kpsv2\WebServisApplication'
$appHostConfigTemplate = Join-Path (Split-Path -Parent $PSScriptRoot) 'kpsv2\applicationhost-kps.config'
$logDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'logs'
# applicationhost-kps.config icindeki fiziksel yol makineye gore degisir
# (deploy klasoru farkli kullanicida olabilir). Calisma aninda gercek yolu
# yerlestirilmis bir kopya uretip IIS Express'i onunla baslatiyoruz.
$appHostConfig = Join-Path $logDir 'applicationhost-kps.runtime.config'
$stdoutLog = Join-Path $logDir 'kpsv2-iisexpress.out.log'
$stderrLog = Join-Path $logDir 'kpsv2-iisexpress.err.log'
$iisExpress = Join-Path $env:ProgramFiles 'IIS Express\iisexpress.exe'

function Test-Kpsv2Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
    return $response.StatusCode -eq 200 -and $response.Content.Contains('KimlikBilgisiGetirTurkV2')
  } catch {
    return $false
  }
}

function Write-RecentLog {
  if (Test-Path -LiteralPath $stderrLog) {
    Write-Host 'KPSV2 hata logu:'
    Get-Content -LiteralPath $stderrLog -Tail 20
  }

  if (Test-Path -LiteralPath $stdoutLog) {
    Write-Host 'KPSV2 cikti logu:'
    Get-Content -LiteralPath $stdoutLog -Tail 20
  }
}

if (-not (Test-Path -LiteralPath $iisExpress) -and ${env:ProgramFiles(x86)}) {
  $iisExpress = Join-Path ${env:ProgramFiles(x86)} 'IIS Express\iisexpress.exe'
}

if (-not (Test-Path -LiteralPath $iisExpress)) {
  Write-Host 'KPSV2 baslatilamadi: IIS Express bulunamadi.'
  Write-Host 'IIS Express kurulu degilse NVI sorgulari calismaz.'
  exit 1
}

if (-not (Test-Path -LiteralPath $appPath)) {
  Write-Host "KPSV2 baslatilamadi: $appPath bulunamadi."
  exit 1
}

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

if (-not (Test-Path -LiteralPath $appHostConfigTemplate)) {
  Write-Host "KPSV2 baslatilamadi: $appHostConfigTemplate bulunamadi."
  exit 1
}

$existing = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if ($existing) {
  if (Test-Kpsv2Health) {
    Write-Host "KPSV2 zaten calisiyor: $healthUrl"
    exit 0
  }

  Write-Host "KPSV2 baslatilamadi: $port portu dolu ama $healthUrl yanit vermiyor."
  exit 1
}

# Sablondaki __KPSV2_PHYSICAL_PATH__ isaretcisini gercek uygulama yoluyla
# degistir - SADECE baslatacaksak (calisan iisexpress runtime config'i kilitli
# tutabilir, o durumda yeniden yazmaya calismayiz).
$templateText = [System.IO.File]::ReadAllText($appHostConfigTemplate)
$runtimeText = $templateText.Replace('__KPSV2_PHYSICAL_PATH__', $appPath)
try {
  [System.IO.File]::WriteAllText($appHostConfig, $runtimeText, (New-Object System.Text.UTF8Encoding($false)))
} catch {
  Write-Host "KPSV2 uyari: runtime config yazilamadi ($($_.Exception.Message)); mevcut kopya kullanilacak."
  if (-not (Test-Path -LiteralPath $appHostConfig)) { exit 1 }
}

Write-Host "KPSV2 baslatiliyor: $healthUrl"

$process = Start-Process `
  -WindowStyle Hidden `
  -FilePath $iisExpress `
  -ArgumentList @('/config:"' + $appHostConfig + '"', '/site:"SivasBldNvi"') `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

for ($attempt = 1; $attempt -le 10; $attempt++) {
  Start-Sleep -Milliseconds 800

  if (Test-Kpsv2Health) {
    Write-Host "KPSV2 hazir: $healthUrl"
    exit 0
  }

  if ($process.HasExited) {
    Write-Host "KPSV2 baslatilamadi: IIS Express erken kapandi. ExitCode=$($process.ExitCode)"
    Write-RecentLog
    exit 1
  }
}

Write-Host "KPSV2 baslatildi ancak $healthUrl saglik kontrolu basarisiz."
Write-RecentLog
exit 1
