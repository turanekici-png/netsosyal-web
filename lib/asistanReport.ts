import { foldTurkish } from '@/lib/utils'

// Sosyal Asistan'in dondurdugu bir sonuc tablosunu, sohbet balonundan
// "Yeni Sekmede Aç" ile uygulamanin KENDI ic sekme sistemine (bkz.
// WorkspaceTabs.tsx/TabContext.tsx - "Ana Sayfa"/"Dosya Yönetimi" ile ayni
// satirdaki sekmeler) tasimak icin kullanilan ortak yardimcilar.
//
// Kullanici istegi (2026-09-21, ilk tur): rapor ayri bir NATIVE tarayici
// sekmesinde/penceresinde (window.open) aciliyordu.
// Kullanici istegi (2026-09-21, 2. tur): "listeyi yeni sayfada açmasın
// işaretli alanda yeni sekme olarak açsın" - isaret edilen alan uygulamanin
// KENDI ust sekme cubugu (ekran goruntusunde "Ana Sayfa | Dosya Yönetimi |
// 40006 GAMZE TIRNAKSIZ" seklinde gorunen satir). Bu yuzden artik native
// pencere yerine gercek bir uygulama sayfasina (/asistan/rapor) TabContext
// uzerinden gecis yapiliyor; veri (buyuk olabildigi icin URL'e sigmaz)
// sessionStorage'da TEK bir "guncel rapor" slotunda tasiniyor - ayni anda
// sadece bir rapor sekmesi oldugu icin (WorkspaceTabs zaten "Sosyal Asistan
// Raporu" basligini TEK sekmeye indirger, path'teki sorgu parametresi farkli
// olsa bile) benzersiz id'ye gerek yok.
export const ASISTAN_REPORT_STORAGE_KEY = 'netsosyal:asistan:report:current'

export type AsistanReportTable = {
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
}

export type AsistanStoredReport = {
  table: AsistanReportTable
  question: string
  generatedAt: string
}

export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (value instanceof Date) return value.toLocaleDateString('tr-TR')
  if (typeof value === 'string') {
    // Bos/sadece bosluktan olusan metin de "-" gosterilir - aksi halde
    // (ör. bir dosyanin adi-soyadi sutunu bos donerse) hucre tamamen bos
    // gorunur ve kullanici bunu bir GORUNTULEME HATASI sanabilir; "-" veri
    // gercekten YOK/eksik oldugunu acikca belli eder (kullanici istegi,
    // 2026-09-21, 3. tur: raporun "daha profesyonel" olmasi).
    if (value.trim() === '') return '-'
    // ISO tarih benzeri metinleri de daha okunur goster (pg Date nesnesi
    // olarak degil, string olarak gelmis olabilir).
    const isoMatch = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    if (isoMatch) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('tr-TR')
    }
    return value
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function saveAsistanReport(report: AsistanStoredReport): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.sessionStorage.setItem(ASISTAN_REPORT_STORAGE_KEY, JSON.stringify(report))
    return true
  } catch {
    // Kota dolu/erisilemez olabilir - cagiran taraf false'u kullanip
    // kullaniciya "rapor acilamadi" mesaji gosterir.
    return false
  }
}

export function loadAsistanReport(): AsistanStoredReport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(ASISTAN_REPORT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AsistanStoredReport
    if (!parsed || !parsed.table || !Array.isArray(parsed.table.columns) || !Array.isArray(parsed.table.rows)) return null
    return parsed
  } catch {
    return null
  }
}

// Kullanici istegi (2026-09-21): "acilan bu sekmedeki dosyalara cift
// tiklayarak icine girebilsin" - rapor tablosunda bir "dosyaid" (dogrudan
// dosyalar.id, coguna FK) veya "dosyano" (insan-dostu dosya numarasi,
// cozumleme gerektirir - bkz. /api/asistan/resolve-file) sutunu varsa,
// satirlar cift-tiklanabilir hale getirilir. Boyle bir sutun YOKSA
// (asistanin sorgusu dosya ile ilgili degilse) satirlar STATIK kalir -
// yanlis/rastgele bir sutunu dosya id'si sanip yanlis dosyaya
// goturmemek icin sadece bu iki BILINEN, guvenilir isim kaliplari
// eslesince aktif olur.
export type FileLinkColumn = { index: number; mode: 'id' | 'dosyano' }

export function detectFileLinkColumn(columns: string[]): FileLinkColumn | null {
  const normalized = columns.map((column) => foldTurkish(column).replace(/[^a-z0-9]/g, ''))
  const dosyaidIndex = normalized.findIndex((column) => column === 'dosyaid')
  if (dosyaidIndex !== -1) return { index: dosyaidIndex, mode: 'id' }
  const dosyanoIndex = normalized.findIndex((column) => column === 'dosyano' || column === 'dosyanumarasi')
  if (dosyanoIndex !== -1) return { index: dosyanoIndex, mode: 'dosyano' }
  return null
}

// Kullanici istegi (2026-09-16): "liste xlsx dosyasi olarak da verilebilsin,
// tum liste sinirsiz olarak" - sohbette (veya rapor sekmesinde) zaten elde
// olan (sunucudan tekrar istemeye gerek olmayan) TAM sonuc tablosu
// /api/asistan/export-xlsx'e gonderilip donen dosya indirilir. Hem sohbet
// balonundaki mini tablo hem /asistan/rapor sekmesi AYNI fonksiyonu kullanir.
export async function downloadResultAsXlsx(table: AsistanReportTable): Promise<string | null> {
  try {
    const response = await fetch('/api/asistan/export-xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns: table.columns, rows: table.rows }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      return payload?.error || 'Excel dosyası oluşturulamadı.'
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sosyal-asistan-raporu-${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    return null
  } catch {
    return 'Excel dosyası indirilemedi - sunucuya ulaşılamadı.'
  }
}
