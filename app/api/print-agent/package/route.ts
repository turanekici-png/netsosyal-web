import { readFileSync } from 'fs'
import { join } from 'path'
import { buildAgentSetupBatchBody, sanitizeOrigin } from '@/lib/printAgentInstallerScript'
import { buildCardReaderSetupBatchBody } from '@/lib/cardReaderInstallerScript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ZipEntry {
  name: string
  content: Buffer
}

const crcTable = new Uint32Array(256)

for (let index = 0; index < 256; index += 1) {
  let value = index

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }

  crcTable[index] = value >>> 0
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980)
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()

  return { dosDate, dosTime }
}

function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const { dosDate, dosTime } = dosDateTime()

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const content = entry.content
    const checksum = crc32(content)
    const localHeader = Buffer.alloc(30)

    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuffer, content)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(content.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuffer)
    offset += localHeader.length + nameBuffer.length + content.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const localFiles = Buffer.concat(localParts)
  const endRecord = Buffer.alloc(22)

  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(entries.length, 8)
  endRecord.writeUInt16LE(entries.length, 10)
  endRecord.writeUInt32LE(centralDirectory.length, 12)
  endRecord.writeUInt32LE(localFiles.length, 16)
  endRecord.writeUInt16LE(0, 20)

  return Buffer.concat([localFiles, centralDirectory, endRecord])
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const safeOrigin = sanitizeOrigin(requestUrl.searchParams.get('origin'))

  const agentPath = join(process.cwd(), 'scripts', 'nextsosyal-print-agent.ps1')
  const agentScript = readFileSync(agentPath)
  // NFC kart okuyucu ajani (kaynagi olmayan, kapali-kutu bir .exe) - bu
  // dosya git'e eklenmez (bkz. .gitignore), sadece bu sunucunun diskinde
  // bulunur. Henuz konulmamissa (ör. baska bir ortam) zip'e dahil edilmez,
  // kurulum SADECE yazici/kamera icin calisir - install.bat da kendi
  // tarafinda "exe yoksa bu adimi atla" kontrolu yapar (bkz.
  // cardReaderInstallerScript.ts), yani bu opsiyonel eksiklik kurulumu
  // BOZMAZ.
  let cardReaderAgentScript: Buffer | null = null
  try {
    cardReaderAgentScript = readFileSync(join(process.cwd(), 'scripts', 'nextsosyal-card-reader-agent.exe'))
  } catch {
    cardReaderAgentScript = null
  }
  const startBat = Buffer.from(`@echo off\r
title NextSosyal Print Agent\r
cd /d "%~dp0"\r
powershell -STA -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0nextsosyal-print-agent.ps1"\r
pause\r
`, 'utf8')
  const hiddenVbs = Buffer.from(`Set shell = CreateObject("WScript.Shell")\r
Set fso = CreateObject("Scripting.FileSystemObject")\r
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)\r
agentPath = fso.BuildPath(scriptDir, "nextsosyal-print-agent.ps1")\r
shell.Run "powershell.exe -STA -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File """ & agentPath & """", 0, False\r
`, 'utf8')
  // install.bat: agent'i C:\NextSosyalPrintAgent'a kopyalar, Gorev
  // Zamanlayici'ya (otomatik baslayan/kendini yeniden baslatan) bir gorev
  // olarak kaydeder ve origin verildiyse kamera icin tarayici "guvenli
  // kaynak" kayit defteri anahtarlarini yazar. Tek-dosya .bat indirmesi
  // (installer/route.ts) Chrome'un guvensiz-indirme engeline takilabildigi
  // icin butonun ana yolu artik bu zip paketi.
  const installBat = Buffer.from(`@echo off\r
title NextSosyal Print Agent Kurulum\r
setlocal\r
set "SCRIPT_DIR=%~dp0"\r
set "TARGET_DIR=C:\\NextSosyalPrintAgent"\r
set "TASK_NAME=NextSosyalPrintAgent"\r
set "STARTUP_FILE=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NextSosyal Print Agent.vbs"\r
set "STARTUP_FILE_BAT=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NextSosyal Print Agent.bat"\r
set "REG_PS1=%TEMP%\\nextsosyal-register-print-agent-task.ps1"\r
set "CARD_READER_TARGET_DIR=C:\\NextSosyalCardReader"\r
set "CARD_READER_TASK_NAME=NextSosyalCardReaderAgent"\r
set "CARD_READER_STARTUP_FILE=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NextSosyal Kart Okuyucu.vbs"\r
set "CARD_READER_STARTUP_FILE_BAT=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NextSosyal Kart Okuyucu.bat"\r
\r
rem Kopyalamadan ONCE kaynak dosyanin GERCEKTEN var olup olmadigini kontrol\r
rem et - zip TAM cikartilmadan (ör. Explorer'in zip icini "goruntuleme"\r
rem modundan) install.bat calistirilirsa, hedef degil KAYNAK bulunamaz ve\r
rem asagidaki kopyalama hep basarisiz olur - bu, izin sorunuyla KARISTIRILMAMALI.\r
if not exist "%SCRIPT_DIR%nextsosyal-print-agent.ps1" (\r
  echo HATA: Kaynak agent dosyasi bulunamadi: "%SCRIPT_DIR%nextsosyal-print-agent.ps1"\r
  echo Zip dosyasini TAMAMEN cikarttiginizdan emin olun ^(sag tik -^> Tumunu Ayikla^),\r
  echo sonra install.bat'i CIKARTILMIS klasorden calistirin ^(zip'in icinden degil^).\r
  pause\r
  exit /b 1\r
)\r
\r
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" 2>nul\r
\r
rem "if not exist" SADECE klasorun VAR olup olmadigina bakar, YAZILABILIR\r
rem olup olmadigina degil - klasor daha once BASKA bir Windows kullanicisi\r
rem tarafindan olusturulmussa (ör. bu bilgisayarda once farkli bir hesapla\r
rem kurulum denendiyse), klasor "var" gorunur ama izin yoksa kopyalama\r
rem sessizce basarisiz olurdu. Bu yuzden VAR OLMA kontrolu yerine, GERCEK\r
rem kopyalama sonucuna gore, basarisiz olursa kullanicinin KENDI profiline\r
rem (%LOCALAPPDATA% - her zaman yazilabilir) otomatik dusuyoruz.\r
copy /Y "%SCRIPT_DIR%nextsosyal-print-agent.ps1" "%TARGET_DIR%\\nextsosyal-print-agent.ps1" >nul 2>nul\r
if errorlevel 1 (\r
  set "TARGET_DIR=%LOCALAPPDATA%\\NextSosyalPrintAgent"\r
  if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" 2>nul\r
  rem Bu son deneme SESSIZE ALINMIYOR - eger bu da basarisiz olursa,\r
  rem Windows'un GERCEK hata metnini (ör. "Erisim engellendi" / "Access is\r
  rem denied") ekranda gormemiz gerekiyor, aksi halde neden basarisiz\r
  rem oldugunu kor kor tahmin ediyoruz.\r
  echo.\r
  echo Birincil konum basarisiz oldu, yedek konuma deneniyor: "%TARGET_DIR%"\r
  copy /Y "%SCRIPT_DIR%nextsosyal-print-agent.ps1" "%TARGET_DIR%\\nextsosyal-print-agent.ps1"\r
)\r
if not exist "%TARGET_DIR%\\nextsosyal-print-agent.ps1" (\r
  echo.\r
  echo HATA: Agent dosyasi kopyalanamadi. Hedef: "%TARGET_DIR%"\r
  echo Kullanici: %USERNAME%\r
  echo Yukaridaki satirlarda Windows'un gosterdigi hata mesajina bakin - bu\r
  echo ekrani NextSosyal ekibine bir fotografla iletin.\r
  pause\r
  exit /b 1\r
)\r
${buildAgentSetupBatchBody(safeOrigin).replace(/\n/g, '\r\n')}\r
${buildCardReaderSetupBatchBody().replace(/\n/g, '\r\n')}\r
pause\r
`, 'utf8')
  const readme = Buffer.from(`NextSosyal Print Agent + Kart Okuyucu\r
\r
ONERILEN KURULUM:\r
1. Bu zip dosyasini herhangi bir klasore cikarin (Indirilenler yeterlidir).\r
2. install.bat dosyasina CIFT TIKLAYIN. Kurulum otomatik tamamlanir:\r
   - Yazdirma servisi C:\\NextSosyalPrintAgent klasorune kopyalanir\r
   - NFC kart okuyucu servisi (varsa) C:\\NextSosyalCardReader klasorune kopyalanir\r
   - Ikisi de oturum acilinca otomatik baslar, cokerse kendini yeniden baslatir\r
3. Kurulduktan sonra zip'i cikardiginiz klasoru silebilirsiniz - servisler artik kendi klasorlerinde calisir.\r
\r
MANUEL / SORUN GIDERME:\r
- Yazdirma servisini pencereli calistirmak icin start-nextsosyal-print-agent.bat dosyasini calistirin.\r
- Yazdirma servisini pencere gorunmeden calistirmak icin start-agent-arka-planda.vbs dosyasini calistirin.\r
- Servisler calistigi surece web uygulamasi kayitli yaziciya direkt baski gonderebilir VE kart okuyucuya okutulan\r
  kart numarasi, o an imlecin bulundugu "Kart No" alanina otomatik yazilir.\r
\r
Trend Micro veya baska kurumsal guvenlik yazilimi engellerse bilgi islemden bu klasor ve dosyalar icin izin isteyin.\r
`, 'utf8')
  const zipEntries: { name: string; content: Buffer }[] = [
    { name: 'nextsosyal-print-agent.ps1', content: agentScript },
    { name: 'install.bat', content: installBat },
    { name: 'start-nextsosyal-print-agent.bat', content: startBat },
    { name: 'start-nextsosyal-print-agent-hidden.vbs', content: hiddenVbs },
    { name: 'start-agent-arka-planda.vbs', content: hiddenVbs },
    { name: 'KURULUM.txt', content: readme },
  ]
  if (cardReaderAgentScript) {
    zipEntries.push({ name: 'nextsosyal-card-reader-agent.exe', content: cardReaderAgentScript })
  }
  const zip = createZip(zipEntries)

  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="NextSosyal-Print-Agent.zip"',
      'Cache-Control': 'no-store',
    },
  })
}
