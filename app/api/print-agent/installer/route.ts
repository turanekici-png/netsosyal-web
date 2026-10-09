import { readFileSync } from 'fs'
import { join } from 'path'
import { buildAgentSetupBatchBody, sanitizeOrigin } from '@/lib/printAgentInstallerScript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// NOT: Chrome, guvensiz (http) bir sayfadan .bat/.exe gibi calistirilabilir
// dosyalarin indirilmesini varsayilan olarak ENGELLIYOR ("Guvenli olmayan
// indirme islemi engellendi"). Bu uygulama LAN'da http:// uzerinden
// calistigi icin bu tek-dosya .bat indirmesi TARAYICIYA GORE
// engellenebilir. Bu yuzden "Bu Bilgisayari Ayarla" butonu ARTIK bunun
// yerine /api/print-agent/package (zip) rotasini kullaniyor - zip dosyalari
// bu spesifik engellemeye takilmiyor. Bu rota, dogrudan indirmenin
// calistigi ortamlar (ör. eski bir bookmark) icin geriye donuk uyumluluk
// amacli olarak birakildi.
function chunkText(value: string, chunkSize = 7000) {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize))
  }

  return chunks
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const safeOrigin = sanitizeOrigin(requestUrl.searchParams.get('origin'))

  const agentPath = join(process.cwd(), 'scripts', 'nextsosyal-print-agent.ps1')
  const agentBase64 = readFileSync(agentPath).toString('base64')
  const base64Lines = chunkText(agentBase64)
    .map((chunk, index) => `${index === 0 ? '>' : '>>'} "%B64_FILE%" echo ${chunk}`)
    .join('\r\n')
  const installer = `@echo off
title NextSosyal Print Agent Kurulum
setlocal
set "TARGET_DIR=C:\\NextSosyalPrintAgent"
set "TASK_NAME=NextSosyalPrintAgent"
set "STARTUP_FILE=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NextSosyal Print Agent.vbs"
set "STARTUP_FILE_BAT=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NextSosyal Print Agent.bat"
set "B64_FILE=%TEMP%\\nextsosyal-print-agent.b64"
set "REG_PS1=%TEMP%\\nextsosyal-register-print-agent-task.ps1"

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" 2>nul

if exist "%B64_FILE%" del /F /Q "%B64_FILE%" >nul 2>nul
${base64Lines}

rem "if not exist" SADECE klasorun VAR olup olmadigina bakar, YAZILABILIR
rem olup olmadigina degil - klasor daha once BASKA bir Windows kullanicisi
rem tarafindan olusturulmussa, "var" gorunur ama izin yoksa cozme sessizce
rem basarisiz olurdu. GERCEK sonuca (dosya olustu mu) gore, basarisiz
rem olursa kullanicinin KENDI profiline (%LOCALAPPDATA%) dusuyoruz.
certutil -f -decode "%B64_FILE%" "%TARGET_DIR%\\nextsosyal-print-agent.ps1" >nul 2>nul
if not exist "%TARGET_DIR%\\nextsosyal-print-agent.ps1" (
  set "TARGET_DIR=%LOCALAPPDATA%\\NextSosyalPrintAgent"
  if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" 2>nul
  rem Bu son deneme SESSIZE ALINMIYOR - basarisiz olursa Windows'un GERCEK
  rem hata metnini ekranda gormemiz gerekiyor.
  echo.
  echo Birincil konum basarisiz oldu, yedek konuma deneniyor: "%TARGET_DIR%"
  certutil -f -decode "%B64_FILE%" "%TARGET_DIR%\\nextsosyal-print-agent.ps1"
)
del /F /Q "%B64_FILE%" >nul 2>nul
if not exist "%TARGET_DIR%\\nextsosyal-print-agent.ps1" (
  echo.
  echo HATA: Agent dosyasi hazirlanamadi. Hedef: "%TARGET_DIR%"
  echo Kullanici: %USERNAME%
  echo Yukaridaki satirlarda Windows'un gosterdigi hata mesajina bakin.
  pause
  exit /b 1
)

(
  echo @echo off
  echo title NextSosyal Print Agent
  echo powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%%~dp0nextsosyal-print-agent.ps1"
  echo pause
) > "%TARGET_DIR%\\start-nextsosyal-print-agent.bat"
${buildAgentSetupBatchBody(safeOrigin)}
pause
`

  return new Response(installer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="NextSosyal-Print-Agent-Kurulum.bat"',
      'Cache-Control': 'no-store',
    },
  })
}
