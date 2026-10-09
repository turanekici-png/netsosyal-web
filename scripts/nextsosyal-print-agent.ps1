param(
  [int]$Port = 17834
)

$ErrorActionPreference = "Stop"
$AgentVersion = "2.9.0"
# NFC kart okuyucu ajani (bkz. install.bat / lib/cardReaderInstallerScript.ts)
# KENDI HTTP sunucusunu acmiyor - o program sadece PC/SC ile karti okuyup
# odaktaki alana klavye gibi yaziyor, tarayiciyla hic konusmuyor. Bu yuzden
# "calisiyor mu" durumunu, zaten acik olan BU ajanin surecinden (Get-Process
# ile) sorup /card-reader-status ucundan donduruyoruz - ayri bir servis
# acmaya gerek kalmiyor. Process adi, exe'nin dosya adiyla (uzantisiz)
# AYNI olmak ZORUNDA - degisirse burasi da guncellenmeli.
$CardReaderProcessName = "nextsosyal-card-reader-agent"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not ("NextSosyal.NativePrinter" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace NextSosyal {
  public static class NativePrinter {
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetDefaultPrinter(string printerName);
  }
}
"@
}

$address = [System.Net.IPAddress]::Parse("127.0.0.1")
$listener = [System.Net.Sockets.TcpListener]::new($address, $Port)

function ConvertTo-JsonResponse {
  param([hashtable]$Payload)
  return ($Payload | ConvertTo-Json -Depth 8)
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
    "Access-Control-Allow-Methods: GET, POST, OPTIONS",
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

# Bu servis 127.0.0.1 uzerinde dinliyor ve /print, /printers uc noktalari
# tarayicidan CORS ile erisilebilir olmasi icin "Access-Control-Allow-Origin: *"
# donduruyor (bu, NextSosyal uygulamasinin KENDI baska bir portundan -
# ornegin http://10.0.0.183:3001 - capraz-kaynak istek atabilmesi icin
# GEREKLI). Ancak "*" ayni zamanda kullanicinin ziyaret ettigi HERHANGI BIR
# internet sitesinin de bu servise (sessizce yazici listesi okuma veya -
# daha ciddisi - keyfi bir baski isi gonderme) erismesine izin verirdi,
# cunku tarayicilar capraz-kaynak isteklerde Origin basligini HER ZAMAN
# GERCEK gonderir (JS bunu taklit edemez). Bu yuzden asil etkiyi yaratan
# uc noktalarda (yazici listesi + baski gonderme) Origin, yerel/LAN
# adreslerinden biriyle eslesmiyorsa istek REDDEDILIYOR - boylece disaridan
# (ornegin kotu niyetli bir web sitesinden) tetiklenen sessiz baski
# saldirilari engellenirken, bu uygulamanin kendi capraz-port cagrisi
# calismaya devam ediyor.
function Test-AllowedOrigin {
  param([string]$OriginHeader)

  if ([string]::IsNullOrWhiteSpace($OriginHeader)) { return $true }

  # Kullanici raporu (2026-09-21): "https://netsosyal.sivas.bel.tr adresinden
  # giris yaptigimda yazicilari gormuyor ama IP ile baglandigimda goruyor" -
  # KOK NEDEN: bu liste sadece localhost/127.0.0.1/ozel LAN IP araliklarini
  # (10.x/192.168.x/172.16-31.x) icermeye BASTAN beri tasarlanmisti, uygulama
  # HTTPS ile gercek genel alan adindan (netsosyal.sivas.bel.tr) yayina
  # gectiginde bu ajan (yerel bir PC uzerinde calisan, ayri/bagimsiz bir
  # servis) HIC guncellenmemisti - bu yuzden o alan adindan gelen Origin
  # (https://netsosyal.sivas.bel.tr) hicbir kalıpla eslesmeyip 403 aliyordu.
  # Asagida SADECE bu bilinen/gercek uretim alan adi ACIKCA eklendi (genel
  # bir joker/wildcard DEGIL) - boylece keyfi bir internet sitesinin bu
  # servise erisimi hala reddedilir, sadece NetSosyal'in kendi genel alan
  # adina izin verilir.
  return [bool]($OriginHeader -match '^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|netsosyal\.sivas\.bel\.tr)(:\d+)?$')
}

function Get-InstalledPrinterNames {
  param(
    # -Fast: sadece hizli/in-process yontemleri kullanir (Get-Printer modul
    # komutu ilk cagirildiginda modul yuklemesi yuzunden, Get-CimInstance
    # Win32_Printer ise WMI sorgusu yuzunden tek basina 1-2+ saniye
    # surebiliyor). Her yazdirmadan once yazici adini DOGRULAMAK icin bu
    # ikisine gerek yok - .NET'in kendi InstalledPrinters listesi zaten
    # guvenilir ve anlik. Tam/eksiksiz tarama (varsayilan, -Fast verilmezse)
    # sadece yazici DROPDOWN'unu dolduran /printers uc noktasinda kullanilir.
    [switch]$Fast
  )

  $printerNames = New-Object System.Collections.Generic.List[string]

  try {
    [System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object {
      if ($_ -and -not $printerNames.Contains($_)) {
        $printerNames.Add($_)
      }
    }
  } catch {
  }

  # Get-Printer / Win32_Printer (WMI) sorgulari YAVAS olabilir (modul
  # yuklemesi, WMI round-trip) VE bazi bilgisayarlarda "PendingDeletion"
  # durumunda takili kalmis bozuk yazici kayitlari (surucu guncellemesi
  # yarim kalmis eski kuyruklar) bu sorgularin normalden uzun surmesine yol
  # acabiliyor - canli olarak boyle bir makinede gozlemlendi. .NET'in kendi
  # InstalledPrinters listesi (yukarida) COGU durumda zaten TUM yerel yazici
  # kuyruklarini (durumlari ne olursa olsun) buluyor - bu yuzden yavas/
  # bozulmaya acik yontemleri HER SEFERINDE degil, SADECE hizli yontem
  # GERCEKTEN hicbir sey bulamadiysa (nadir bir bosluk durumu) son care
  # olarak deniyoruz.
  if (-not $Fast -and $printerNames.Count -eq 0) {
    try {
      Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object {
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

function Print-HtmlToPrinter {
  param(
    [string]$PrinterName,
    [string]$Html,
    [string]$Title,
    [double]$WidthMm = 80,
    [double]$HeightMm = 40
  )

  if (-not $PrinterName.Trim()) {
    throw "Yazıcı adı boş."
  }

  if (-not $Html.Trim()) {
    throw "Yazdırılacak HTML boş."
  }

  $installedPrinters = Get-InstalledPrinterNames -Fast
  if ($installedPrinters.Count -gt 0 -and -not ($installedPrinters -contains $PrinterName)) {
    throw "Yazıcı bulunamadı: $PrinterName"
  }

  $printerSettings = New-Object System.Drawing.Printing.PrinterSettings
  $previousDefaultPrinter = $printerSettings.PrinterName
  $network = New-Object -ComObject WScript.Network
  $tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("nextsosyal-print-{0}.html" -f ([Guid]::NewGuid().ToString("N")))
  $pageSetupPath = "HKCU:\Software\Microsoft\Internet Explorer\PageSetup"
  $pageSetupExisted = Test-Path -LiteralPath $pageSetupPath
  $previousHeader = $null
  $previousFooter = $null
  $browser = $null
  $bitmap = $null
  $printDocument = $null

  if ($pageSetupExisted) {
    $pageSetup = Get-ItemProperty -LiteralPath $pageSetupPath -ErrorAction SilentlyContinue
    $previousHeader = $pageSetup.header
    $previousFooter = $pageSetup.footer
  } else {
    New-Item -Path $pageSetupPath -Force | Out-Null
  }

  # ONCEKI surum, HTML -> goruntu -> yazdirma adimini AYRI bir powershell.exe
  # surecinde (Start-Process -Wait ile bir "worker" betigi calistirarak)
  # yapiyordu. Her tek yazdirmada YENI bir surec acmak (.NET/WinForms/IE
  # WebBrowser motorunu sifirdan yuklemek) basli basina 1-3 saniye ekliyordu
  # - kullanicinin "yazdir'a basinca hala bekliyoruz" geri bildiriminin asil
  # kaynagi buydu. Bu agent zaten -STA modunda calisiyor (WebBrowser STA
  # gerektirir) ve her istek zaten TEK TEK, sirayla islendigi icin (dinleme
  # dongusu tek iş parçacıklı), asil render+yazdirma islemini AYRI bir surece
  # tasimanin performans DISINDA bir faydasi yoktu - sadece surec acma
  # maliyetini ekliyordu. Şimdi ayni islem DOGRUDAN bu fonksiyon icinde,
  # ayri surec acmadan yapiliyor.
  try {
    Set-Content -Path $tempPath -Value $Html -Encoding UTF8
    Set-ItemProperty -LiteralPath $pageSetupPath -Name "header" -Value "" -Force
    Set-ItemProperty -LiteralPath $pageSetupPath -Name "footer" -Value "" -Force

    $printerActivated = [NextSosyal.NativePrinter]::SetDefaultPrinter($PrinterName)
    if (-not $printerActivated) {
      $network.SetDefaultPrinter($PrinterName)
    }

    # ONCEKI surum burada HER yazdirmadan once, sonuc zaten hazir olsa bile
    # kosulsuz 150ms bekliyordu (do-while, sleep once geliyordu). SetDefaultPrinter
    # cogu durumda ANINDA etkili oluyor - once (hic beklemeden) kontrol edip,
    # SADECE henuz yansimadiysa kisa araliklarla (60ms) tekrar deniyoruz. Ust
    # sinir (10sn) ayni kaliyor, sadece yaygin/basarili durumda gereksiz
    # bekleme kaldirildi.
    $defaultPrinterDeadline = [DateTime]::UtcNow.AddSeconds(10)
    $activeDefaultPrinter = [string](New-Object System.Drawing.Printing.PrinterSettings).PrinterName
    while (
      -not [string]::Equals($activeDefaultPrinter, $PrinterName, [System.StringComparison]::OrdinalIgnoreCase) -and
      [DateTime]::UtcNow -lt $defaultPrinterDeadline
    ) {
      Start-Sleep -Milliseconds 60
      $activePrinterSettings = New-Object System.Drawing.Printing.PrinterSettings
      $activeDefaultPrinter = [string]$activePrinterSettings.PrinterName
    }

    if (-not [string]::Equals($activeDefaultPrinter, $PrinterName, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Seçilen yazıcı etkinleştirilemedi. İstenen: $PrinterName, etkin: $activeDefaultPrinter"
    }

    $widthPx = [Math]::Max(1, [int][Math]::Ceiling($WidthMm * 96 / 25.4))
    $heightPx = [Math]::Max(1, [int][Math]::Ceiling($HeightMm * 96 / 25.4))

    $browser = New-Object System.Windows.Forms.WebBrowser
    $browser.ScriptErrorsSuppressed = $true
    $browser.ScrollBarsEnabled = $false
    $browser.Size = New-Object System.Drawing.Size($widthPx, $heightPx)
    $browser.Navigate($tempPath)

    $navigateDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while ($browser.ReadyState -ne [System.Windows.Forms.WebBrowserReadyState]::Complete -and [DateTime]::UtcNow -lt $navigateDeadline) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 30
    }

    if ($browser.ReadyState -ne [System.Windows.Forms.WebBrowserReadyState]::Complete) {
      throw "HTML yazdırma için zamanında yüklenemedi."
    }

    $browser.Size = New-Object System.Drawing.Size($widthPx, $heightPx)
    $bitmap = New-Object System.Drawing.Bitmap($widthPx, $heightPx, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $browser.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $widthPx, $heightPx)))

    $printDocument = New-Object System.Drawing.Printing.PrintDocument
    $printDocument.DocumentName = "NextSosyal"
    $printDocument.PrinterSettings.PrinterName = $PrinterName
    if (-not $printDocument.PrinterSettings.IsValid) {
      throw "Seçilen yazıcı geçerli değil: $PrinterName"
    }

    $paperWidth = [Math]::Max(1, [int][Math]::Round($WidthMm / 25.4 * 100))
    $paperHeight = [Math]::Max(1, [int][Math]::Round($HeightMm / 25.4 * 100))
    $printDocument.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("NextSosyal", $paperWidth, $paperHeight)
    $printDocument.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $printDocument.OriginAtMargins = $false
    $printDocument.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $printDocument.add_PrintPage({
      param($sender, $eventArgs)
      # Yazıcı sürücüsünün fiziksel kenar payını tasarıma ikinci kez eklemesini
      # engelle; tasarım zaten kendi mm ölçüsü ve boşluklarıyla hazırlanmıştır.
      $eventArgs.Graphics.TranslateTransform(
        -[single]$eventArgs.PageSettings.HardMarginX,
        -[single]$eventArgs.PageSettings.HardMarginY
      )
      $targetRectangle = [System.Drawing.RectangleF]::new(
        0,
        0,
        [single]$eventArgs.PageBounds.Width,
        [single]$eventArgs.PageBounds.Height
      )
      $eventArgs.Graphics.DrawImage($bitmap, $targetRectangle)
      $eventArgs.HasMorePages = $false
    })
    $printDocument.Print()
  } finally {
    if ($browser) {
      $browser.Dispose()
    }
    if ($bitmap) {
      $bitmap.Dispose()
    }
    if ($printDocument) {
      $printDocument.Dispose()
    }

    if ($previousDefaultPrinter) {
      try {
        if (-not [NextSosyal.NativePrinter]::SetDefaultPrinter($previousDefaultPrinter)) {
          $network.SetDefaultPrinter($previousDefaultPrinter)
        }
      } catch {
      }
    }

    if ($pageSetupExisted) {
      Set-ItemProperty -LiteralPath $pageSetupPath -Name "header" -Value ([string]$previousHeader) -Force
      Set-ItemProperty -LiteralPath $pageSetupPath -Name "footer" -Value ([string]$previousFooter) -Force
    } else {
      Remove-Item -LiteralPath $pageSetupPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Read-HttpRequest {
  param([System.Net.Sockets.TcpClient]$Client)

  $stream = $Client.GetStream()
  $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)
  $requestLine = $reader.ReadLine()
  $headers = @{}

  while ($reader.Peek() -ge 0) {
    $line = $reader.ReadLine()
    if ([string]::IsNullOrEmpty($line)) {
      break
    }

    $separatorIndex = $line.IndexOf(":")
    if ($separatorIndex -gt 0) {
      $name = $line.Substring(0, $separatorIndex).Trim().ToLowerInvariant()
      $value = $line.Substring($separatorIndex + 1).Trim()
      $headers[$name] = $value
    }
  }

  $body = ""
  if ($headers.ContainsKey("content-length")) {
    $contentLength = [int]$headers["content-length"]
    if ($contentLength -gt 0) {
      $buffer = New-Object char[] $contentLength
      $read = $reader.Read($buffer, 0, $contentLength)
      $body = -join $buffer[0..($read - 1)]
    }
  }

  return @{
    RequestLine = $requestLine
    Headers = $headers
    Body = $body
  }
}

try {
  try {
    $listener.Start()
  } catch [System.Net.Sockets.SocketException] {
    Write-Host "NextSosyal Print Agent zaten calisiyor olabilir: http://127.0.0.1:$Port"
    Write-Host "Form Dizayn sayfasindan 'Agenttan Al' butonuna basarak kontrol edebilirsiniz."
    return
  }

  Write-Host "NextSosyal Print Agent çalışıyor: http://127.0.0.1:$Port"
  Write-Host "Bu pencere açık kaldığı sürece web uygulaması seçili yazıcıya direkt baskı gönderebilir."
  Write-Host "Durdurmak için Ctrl+C."

  while ($true) {
    $client = $listener.AcceptTcpClient()

    try {
      $request = Read-HttpRequest -Client $client
      $requestLine = [string]$request.RequestLine

      if ($requestLine.StartsWith("OPTIONS ")) {
        Send-HttpResponse -Client $client -StatusCode 204 -StatusText "No Content" -Body ""
      } elseif ($requestLine -match "^GET /health(?:\s|\?)") {
        Send-HttpResponse -Client $client -StatusCode 200 -StatusText "OK" -Body (ConvertTo-JsonResponse @{ success = $true; status = "ok"; agentVersion = $AgentVersion })
      } elseif ($requestLine -match "^GET /card-reader-status(?:\s|\?)") {
        if (-not (Test-AllowedOrigin -OriginHeader $request.Headers["origin"])) {
          Send-HttpResponse -Client $client -StatusCode 403 -StatusText "Forbidden" -Body (ConvertTo-JsonResponse @{ success = $false; error = "Bu kaynaktan erisime izin verilmiyor." })
        } else {
          $isRunning = [bool](Get-Process -Name $CardReaderProcessName -ErrorAction SilentlyContinue)
          Send-HttpResponse -Client $client -StatusCode 200 -StatusText "OK" -Body (ConvertTo-JsonResponse @{ success = $true; agentVersion = $AgentVersion; data = @{ running = $isRunning } })
        }
      } elseif ($requestLine -match "^GET /printers(?:\s|\?)") {
        if (-not (Test-AllowedOrigin -OriginHeader $request.Headers["origin"])) {
          Send-HttpResponse -Client $client -StatusCode 403 -StatusText "Forbidden" -Body (ConvertTo-JsonResponse @{ success = $false; error = "Bu kaynaktan erisime izin verilmiyor." })
        } else {
          Send-HttpResponse -Client $client -StatusCode 200 -StatusText "OK" -Body (ConvertTo-JsonResponse @{ success = $true; agentVersion = $AgentVersion; data = @{ printers = Get-InstalledPrinterNames } })
        }
      } elseif ($requestLine -match "^POST /print(?:\s|\?)") {
        if (-not (Test-AllowedOrigin -OriginHeader $request.Headers["origin"])) {
          Send-HttpResponse -Client $client -StatusCode 403 -StatusText "Forbidden" -Body (ConvertTo-JsonResponse @{ success = $false; error = "Bu kaynaktan erisime izin verilmiyor." })
        } else {
          $payload = $request.Body | ConvertFrom-Json
          $printerName = [string]$payload.printerName
          $html = [string]$payload.html
          $title = [string]$payload.title
          $widthMm = if ($null -ne $payload.widthMm) { [double]$payload.widthMm } else { 80 }
          $heightMm = if ($null -ne $payload.heightMm) { [double]$payload.heightMm } else { 40 }

          Print-HtmlToPrinter -PrinterName $printerName -Html $html -Title $title -WidthMm $widthMm -HeightMm $heightMm
          Send-HttpResponse -Client $client -StatusCode 200 -StatusText "OK" -Body (ConvertTo-JsonResponse @{ success = $true; printerName = $printerName; agentVersion = $AgentVersion })
        }
      } else {
        Send-HttpResponse -Client $client -StatusCode 404 -StatusText "Not Found" -Body (ConvertTo-JsonResponse @{ success = $false; error = "Endpoint bulunamadı." })
      }
    } catch {
      Send-HttpResponse -Client $client -StatusCode 500 -StatusText "Internal Server Error" -Body (ConvertTo-JsonResponse @{ success = $false; error = $_.Exception.Message })
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
