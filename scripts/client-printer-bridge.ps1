param(
  [int]$Port = 17833
)

$ErrorActionPreference = "Stop"
$address = [System.Net.IPAddress]::Parse("127.0.0.1")
$listener = [System.Net.Sockets.TcpListener]::new($address, $Port)

function Get-LocalPrinterNames {
  $printerNames = New-Object System.Collections.Generic.List[string]

  try {
    Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object {
      if ($_ -and -not $printerNames.Contains($_)) {
        $printerNames.Add($_)
      }
    }
  } catch {
  }

  try {
    Add-Type -AssemblyName System.Drawing
    [System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object {
      if ($_ -and -not $printerNames.Contains($_)) {
        $printerNames.Add($_)
      }
    }
  } catch {
  }

  try {
    Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name | ForEach-Object {
      if ($_ -and -not $printerNames.Contains($_)) {
        $printerNames.Add($_)
      }
    }
  } catch {
  }

  try {
    $network = New-Object -ComObject WScript.Network
    $connections = $network.EnumPrinterConnections()
    for ($index = 1; $index -lt $connections.Count(); $index += 2) {
      $printerName = [string]$connections.Item($index)
      if ($printerName -and -not $printerNames.Contains($printerName)) {
        $printerNames.Add($printerName)
      }
    }
  } catch {
  }

  return @($printerNames | Sort-Object -Unique)
}

function Send-HttpResponse {
  param(
    [System.Net.Sockets.TcpClient]$Client,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$Body,
    [string]$ContentType = "application/json; charset=utf-8"
  )

  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $header = @(
    "HTTP/1.1 $StatusCode $StatusText",
    "Content-Type: $ContentType",
    "Content-Length: $($bodyBytes.Length)",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type",
    "Access-Control-Allow-Private-Network: true",
    "Access-Control-Max-Age: 600",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"

  $stream = $Client.GetStream()
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($bodyBytes, 0, $bodyBytes.Length)
  $stream.Flush()
}

try {
  $listener.Start()
  Write-Host "NetSosyal client printer bridge is running at http://127.0.0.1:$Port/printers"
  Write-Host "Keep this window open while using the form designer. Press Ctrl+C to stop."

  while ($true) {
    $client = $listener.AcceptTcpClient()

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      while ($reader.Peek() -ge 0) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) {
          break
        }
      }

      if ($requestLine -match "^(GET|OPTIONS) /(printers|health)(?:\s|\?)") {
        if ($requestLine.StartsWith("OPTIONS ")) {
          Send-HttpResponse -Client $client -StatusCode 204 -StatusText "No Content" -Body ""
        } elseif ($requestLine -match "^GET /health(?:\s|\?)") {
          $payload = @{
            success = $true
            status = "ok"
            service = "nextsosyal-client-printer-bridge"
          } | ConvertTo-Json -Depth 3

          Send-HttpResponse -Client $client -StatusCode 200 -StatusText "OK" -Body $payload
        } else {
          $printerNames = Get-LocalPrinterNames
          $payload = @{
            success = $true
            data = @{
              printers = $printerNames
            }
          } | ConvertTo-Json -Depth 4

          Send-HttpResponse -Client $client -StatusCode 200 -StatusText "OK" -Body $payload
        }
      } else {
        $payload = @{ success = $false; error = "Not found" } | ConvertTo-Json
        Send-HttpResponse -Client $client -StatusCode 404 -StatusText "Not Found" -Body $payload
      }
    } catch {
      try {
        $payload = @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json
        Send-HttpResponse -Client $client -StatusCode 500 -StatusText "Internal Server Error" -Body $payload
      } catch {
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
