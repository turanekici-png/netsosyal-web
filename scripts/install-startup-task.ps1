# NetSosyal - Windows acilista (oturum acilinca) uygulamayi otomatik baslatan
# Zamanlanmis Gorev'i kurar. Boylece elektrik kesintisi / yeniden baslatma
# sonrasi sunucu + KPSV2 koprusu elle mudahale gerekmeden ayaga kalkar.
#
# Kullanim (yonetici PowerShell'i gerekmez, gorev mevcut kullanici icin kurulur):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-startup-task.ps1
#
# Kaldirmak icin:
#   Unregister-ScheduledTask -TaskName 'NetSosyal Otomatik Baslat' -Confirm:$false

$ErrorActionPreference = 'Stop'

$taskName  = 'NetSosyal Otomatik Baslat'
$root      = Split-Path -Parent $PSScriptRoot
$scriptPs1 = Join-Path $PSScriptRoot 'yayinla.ps1'

if (-not (Test-Path $scriptPs1)) {
  throw "yayinla.ps1 bulunamadi: $scriptPs1"
}

# -SkipBuild: acilista YENIDEN BUILD ALMAYIZ - .next zaten diskte hazir.
# Sadece KPSV2 koprusu + Next sunucusu baslatilir ve saglik kontrolu yapilir.
$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPs1`" -SkipBuild" `
  -WorkingDirectory $root

# Hem oturum acilista hem de (kullanici zaten acikken kurulumda) 1 dk sonra
# bir kez daha dener - boylece kurulum aninda da devreye girer.
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# RunLevel Limited: gorevi kaydetmek yonetici hakki GEREKTIRMEZ. Uygulama
# yalnizca ayni kullanicinin surecleriyle ve proje klasoruyle calisiyor, bu
# yuzden yukseltilmis hak gerekmez. (Yonetici olarak -RunLevel Highest
# istenirse bu betigi yukseltilmis bir PowerShell'den calistirmak yeterli.)
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Eski gorev kaldirildi, yeniden kuruluyor..." -ForegroundColor DarkGray
}

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $triggerLogon `
  -Principal $principal `
  -Settings $settings `
  -Description 'Windows oturumu acilinca NetSosyal sunucusunu ve KPSV2 (NVI) koprusunu baslatir (scripts\yayinla.ps1 -SkipBuild).' | Out-Null

Write-Host ''
Write-Host "OK - '$taskName' gorevi kuruldu (tetik: oturum acilista, kullanici $env:USERNAME)." -ForegroundColor Green
Write-Host "Test etmek icin:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Kaldirmak icin :  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
