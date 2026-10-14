# Zamanlanmis gorev tarafindan periyodik calistirilir: GitHub'da (origin/main)
# yeni commit varsa, yerel calisma kopyasi TEMIZSE pull edip mevcut
# guncelle-yayinla.ps1 ile canliya alir. Yerelde commit edilmemis degisiklik
# varsa GUVENLIK icin pull yapmaz, sadece log'a uyari yazar (olasi calisma
# kaybini onlemek icin).
#
# NOT: $ErrorActionPreference = 'Stop' KULLANILMIYOR - git gibi native
# programlar normal/basarili calismada da stderr'e ilerleme mesaji yazar;
# 'Stop' ile bu PowerShell'de sahte bir terminating error'a donusurdu
# (nitekim ilk denemede "HATA: From https://github.com/..." diye basarili
# bir fetch bu sekilde yanlislikla hata olarak loglanmisti).

$projectRoot = "C:\Users\Administrator\Desktop\NetSosyal\NetSosyal"
Set-Location $projectRoot

$logDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "git-auto-deploy.log"

function Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $logFile -Value $line
}

git fetch origin main 2>&1 | Out-Null

$localHash = (git rev-parse main).Trim()
$remoteHash = (git rev-parse origin/main).Trim()

if ($localHash -eq $remoteHash) {
  exit 0
}

$statusOutput = git status --porcelain
if ($statusOutput) {
  Log "UYARI: origin/main'de yeni commit var ($localHash -> $remoteHash) ama yerelde kaydedilmemis degisiklik tespit edildi. Pull ATLANDI, elle kontrol edilmeli."
  exit 1
}

Log "Yeni commit bulundu ($localHash -> $remoteHash). git pull baslatiliyor."
$pullOutput = git pull origin main 2>&1
$pullOutput | ForEach-Object { Log "  $_" }

Log "Yayin script'i (guncelle-yayinla.ps1) calistiriliyor."
$deployOutput = & "$projectRoot\scripts\guncelle-yayinla.ps1" 2>&1
$deployOutput | ForEach-Object { Log "  $_" }

Log "Otomatik yayin tamamlandi."
