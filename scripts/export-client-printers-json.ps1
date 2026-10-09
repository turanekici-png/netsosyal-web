param(
  [string]$OutputPath = "$([Environment]::GetFolderPath('Desktop'))\netsosyal-yazicilar.json"
)

$ErrorActionPreference = "Stop"
$printerNames = New-Object System.Collections.Generic.List[string]

function Add-PrinterName {
  param([string]$Name)

  $normalizedName = $Name.Trim()
  if ($normalizedName -and -not $printerNames.Contains($normalizedName)) {
    $printerNames.Add($normalizedName)
  }
}

try {
  Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object { Add-PrinterName $_ }
} catch {
}

try {
  Add-Type -AssemblyName System.Drawing
  [System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { Add-PrinterName $_ }
} catch {
}

try {
  Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name | ForEach-Object { Add-PrinterName $_ }
} catch {
}

try {
  $network = New-Object -ComObject WScript.Network
  $connections = $network.EnumPrinterConnections()
  for ($index = 1; $index -lt $connections.Count(); $index += 2) {
    Add-PrinterName ([string]$connections.Item($index))
  }
} catch {
}

$payload = [ordered]@{
  printers = @($printerNames | Sort-Object -Unique)
  assistancePrinters = [ordered]@{}
  designPrinters = [ordered]@{}
}

$payload | ConvertTo-Json -Depth 4 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "NetSosyal yazıcı JSON dosyası oluşturuldu:"
Write-Host $OutputPath
