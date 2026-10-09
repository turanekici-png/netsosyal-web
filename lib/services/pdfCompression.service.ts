import 'server-only'
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Kullanici istegi: sosyalyardimdkm veritabanindaki "belge" tablosu
// (dosyalara yuklenen belgelerin NEREDEYSE TAMAMI - 54.550 kayittan
// 54.550'si - PDF formatinda) surekli buyuyup diski doldurdugu icin -
// bundan sonra eklenen PDF belgeler, veritabanina yazilmadan once
// Ghostscript ile yeniden kodlanip kucultuluyor. Canli veriden alinan 3
// gercek ornekte %65-66 kucculme, GORSEL KALITE KAYBI OLMADAN dogrulandi
// (bu belgeler cogunlukla metin/tablo tabanli otomatik sorgu raporlari,
// taranmis fotograf degil - bkz. sohbet gecmisi).
//
// -dPDFSETTINGS=/ebook: 150 DPI'ye kadar goruntu kucultme + orta seviye
// JPEG kalitesi - taranmis/arsivlik belgeler icin Ghostscript'in dengeli,
// standart profili (asiri agresif "/screen" 72 DPI KULLANILMADI - kucuk
// yazilarin bulanik gorunme riski var).
// Surum klasoru adi (ör. "gs10.07.1") Ghostscript guncellendiginde
// degisecegi icin sabit bir yol yerine "C:\Program Files\gs\" altindaki
// surum klasorleri dinamik olarak taranir - kod, ileride Ghostscript
// guncellenirse DEGISTIRILMEDEN calismaya devam eder.
const GHOSTSCRIPT_SEARCH_ROOTS: { dir: string; exe: string }[] = [
  { dir: 'C:/Program Files/gs', exe: 'gswin64c.exe' },
  { dir: 'C:/Program Files (x86)/gs', exe: 'gswin32c.exe' },
]
const GHOSTSCRIPT_TIMEOUT_MS = 60_000

let cachedGsPath: string | null | undefined

function resolveGhostscriptPath(): string | null {
  if (cachedGsPath !== undefined) return cachedGsPath

  // turbopackIgnore: bu yollar SABIT DEGIL (dinamik surum klasoru taramasi,
  // bkz. yukaridaki yorum) - Turbopack build sirasinda bunu statik analizle
  // takip edip TUM PROJEYI (public/ dahil) izlemeye calisiyor, build suresini
  // ciddi sekilde uzatiyordu. Bu, salt build-zamani izleme davranisini
  // kapatir - calisma zamaninda (PDF sikistirilirken) islev AYNEN devam eder.
  for (const { dir, exe } of GHOSTSCRIPT_SEARCH_ROOTS) {
    if (!existsSync(/* turbopackIgnore: true */ dir)) continue

    const versionFolders = readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse() // en yuksek surum adi (alfabetik) once denensin

    for (const versionFolder of versionFolders) {
      const candidate = join(dir, versionFolder, 'bin', exe)
      if (existsSync(/* turbopackIgnore: true */ candidate)) {
        cachedGsPath = candidate
        return cachedGsPath
      }
    }
  }

  cachedGsPath = null
  return null
}

function runGhostscript(args: string[]): Promise<{ ok: boolean; error?: string }> {
  const gsPath = resolveGhostscriptPath()
  if (!gsPath) return Promise.resolve({ ok: false, error: 'Ghostscript bulunamadı.' })

  return new Promise((resolve) => {
    // turbopackIgnore: gsPath dinamik cozulen bir yol (yukaridaki
    // resolveGhostscriptPath) - build-zamani izlemeyi kapatir, calisma
    // zamanindaki calistirma davranisini etkilemez.
    const child = spawn(/* turbopackIgnore: true */ gsPath, args, { windowsHide: true })
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, error: 'Zaman aşımı' })
    }, GHOSTSCRIPT_TIMEOUT_MS)

    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, error: error.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true } : { ok: false, error: stderr || `çıkış kodu ${code}` })
    })
  })
}

// Sadece GERCEK PDF belgeler icin kullanilir - resimler icin
// imageCompression.service.ts kullanilir (bkz. cagiran kod).
export async function compressPdfBuffer(buffer: Buffer): Promise<Buffer> {
  if (!resolveGhostscriptPath()) {
    // Ghostscript kurulu degilse sessizce orijinal veri kullanilir - kritik
    // bir bagimlilik olarak ele alinmiyor, sadece "olursa iyi olur"
    // bir iyilestirme.
    return buffer
  }

  const workDir = mkdtempSync(join(tmpdir(), 'belge-pdf-'))
  const inputPath = join(workDir, 'in.pdf')
  const outputPath = join(workDir, 'out.pdf')

  try {
    writeFileSync(inputPath, buffer)

    const result = await runGhostscript([
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/ebook',
      '-dNOPAUSE',
      '-dBATCH',
      '-dQUIET',
      '-dSAFER',
      `-sOutputFile=${outputPath}`,
      inputPath,
    ])

    if (!result.ok || !existsSync(outputPath)) {
      console.warn('[pdfCompression] PDF sıkıştırılamadı, orijinal veri kullanılıyor:', result.error)
      return buffer
    }

    const compressed = readFileSync(outputPath)
    // Savunma: sikistirma beklenmedik sekilde ORIJINALDEN BUYUK/BOS bir
    // dosya uretirse orijinal korunur - veri ASLA buyutulmez/bozulmaz.
    return compressed.length > 0 && compressed.length < buffer.length ? compressed : buffer
  } catch (error) {
    console.warn('[pdfCompression] PDF sıkıştırılamadı, orijinal veri kullanılıyor:', error)
    return buffer
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
