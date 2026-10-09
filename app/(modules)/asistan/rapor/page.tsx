'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { foldTurkish } from '@/lib/utils'
import {
  loadAsistanReport,
  downloadResultAsXlsx,
  detectFileLinkColumn,
  formatCellValue,
  type AsistanStoredReport,
} from '@/lib/asistanReport'

type SortState = { column: string; direction: 'asc' | 'desc' } | null

// Kullanici istegi (2026-09-21, 3. tur): "bu sayfayı daha profesyonel yap
// başlıklarda filtre ve sıralama olsun" - AdvancedTable.tsx (bkz.
// components/shared/AdvancedTable.tsx) uygulamanin GENEL tablolarinda
// kullanilan, ama sabit/bilinen sutunlar+tableId'ye gore calisan agir bir
// bilesen - Sosyal Asistan'in sorguya gore DEGISKEN/bilinmeyen sutunlarina
// uymuyor. Bunun yerine, ayni "profesyonel" his (baslikta siralama oku +
// hemen altinda kompakt filtre kutusu, foldTurkish ile Turkce-duyarsiz
// arama - bkz. turkce-duyarsiz-arama.md) icin KUCUK, bu sayfaya ozel bir
// istemci-tarafi siralama/filtreleme eklendi - veri zaten tamamen
// sessionStorage'dan tek seferde yuklendigi icin sunucuya tekrar gitmeye
// gerek yok.
function sortValue(row: Record<string, unknown>, column: string): { text: string; num: number | null } {
  const raw = row[column]
  const text = foldTurkish(formatCellValue(raw))
  if (raw === null || raw === undefined || raw === '') return { text, num: null }
  const numeric = typeof raw === 'number' ? raw : Number(String(raw).replace(/\./g, '').replace(',', '.'))
  return { text, num: Number.isFinite(numeric) ? numeric : null }
}

function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const numeric = typeof raw === 'number' ? raw : Number(String(raw).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : null
}

function findColumn(columns: string[], candidates: string[]): string | null {
  const normalizedCandidates = candidates.map((c) => foldTurkish(c).replace(/[^a-z0-9]/g, ''))
  return columns.find((column) => normalizedCandidates.includes(foldTurkish(column).replace(/[^a-z0-9]/g, ''))) ?? null
}

// Kullanici istegi (2026-09-21, 6. tur): "listenin genel durumu ile ilgili
// rapor ver, örneğin toplam dosya sayısı, toplam birey sayısı gibi" -
// sorgu her seferinde FARKLI sutunlar donebildigi icin (asistan dinamik
// SQL yaziyor) sabit bir sema varsayilamaz; bunun yerine YAYGIN sutun
// etiketlerini (Dosya No, Kişi Sayısı, Miktar/Tutar) tanıyip varsa ozet
// istatistik kartlari olusturuyoruz - hicbiri yoksa sadece satir sayisi
// gosterilir (zaten var olan "X satır" bilgisiyle cakismaz, ayri bir yerde).
function buildSummaryStats(
  rows: Record<string, unknown>[],
  dosyaNoColumn: string | null,
  kisiSayisiColumn: string | null,
  miktarColumn: string | null,
): { label: string; value: string }[] {
  const stats: { label: string; value: string }[] = []

  if (dosyaNoColumn) {
    const distinctDosya = new Set(rows.map((row) => String(row[dosyaNoColumn] ?? '')).filter(Boolean))
    stats.push({ label: 'Toplam Dosya', value: distinctDosya.size.toLocaleString('tr-TR') })
  }

  if (kisiSayisiColumn) {
    // Kisi Sayisi dosya bazinda SABIT bir deger - ayni dosya birden fazla
    // satirda tekrar ediyorsa (ör. dosya+yardim turu join'i) her dosyayi
    // SADECE BIR KEZ saymak icin dosya no'ya gore tekillestirilir.
    const seenDosya = new Set<string>()
    let total = 0
    rows.forEach((row) => {
      const dosyaKey = dosyaNoColumn ? String(row[dosyaNoColumn] ?? '') : null
      if (dosyaKey !== null) {
        if (seenDosya.has(dosyaKey)) return
        seenDosya.add(dosyaKey)
      }
      const value = toNumber(row[kisiSayisiColumn])
      if (value !== null) total += value
    })
    stats.push({ label: 'Toplam Kişi', value: total.toLocaleString('tr-TR') })
  }

  if (miktarColumn) {
    let total = 0
    rows.forEach((row) => {
      const value = toNumber(row[miktarColumn])
      if (value !== null) total += value
    })
    stats.push({ label: 'Toplam Miktar', value: `${total.toLocaleString('tr-TR')} ₺` })
  }

  if (stats.length === 0) {
    stats.push({ label: 'Toplam Satır', value: rows.length.toLocaleString('tr-TR') })
  }

  return stats
}

function ReportContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cacheBust = searchParams.get('t') || ''
  const [report, setReport] = useState<AsistanStoredReport | null | undefined>(undefined)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [openingRowKey, setOpeningRowKey] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [sortState, setSortState] = useState<SortState>(null)

  useEffect(() => {
    setReport(loadAsistanReport())
    setColumnFilters({})
    setSortState(null)
  }, [cacheBust])

  const handleExport = async () => {
    if (!report) return
    setIsExporting(true)
    setExportError('')
    const error = await downloadResultAsXlsx(report.table)
    if (error) setExportError(error)
    setIsExporting(false)
  }

  const openFile = async (mode: 'id' | 'dosyano', value: string) => {
    const rowKey = `${mode}:${value}`
    setOpenError('')
    setOpeningRowKey(rowKey)
    try {
      if (mode === 'id') {
        router.push(`/documents?fileId=${encodeURIComponent(value)}`)
        return
      }
      const response = await fetch('/api/asistan/resolve-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dosyano: value }),
      })
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: { fileId?: string }; error?: string } | null
      if (payload?.success && payload.data?.fileId) {
        router.push(`/documents?fileId=${encodeURIComponent(payload.data.fileId)}`)
      } else {
        setOpenError(payload?.error || 'Dosya bulunamadı.')
        setOpeningRowKey(null)
      }
    } catch {
      setOpenError('Dosya açılamadı - sunucuya ulaşılamadı.')
      setOpeningRowKey(null)
    }
  }

  const table = report?.table
  const linkColumn = useMemo(() => (table ? detectFileLinkColumn(table.columns) : null), [table])
  const dosyaNoColumn = useMemo(() => (table ? findColumn(table.columns, ['Dosya No', 'DosyaNo']) : null), [table])
  const kisiSayisiColumn = useMemo(() => (table ? findColumn(table.columns, ['Kişi Sayısı', 'KisiSayisi']) : null), [table])
  const miktarColumn = useMemo(() => (table ? findColumn(table.columns, ['Miktar', 'Tutar']) : null), [table])
  const activeFilterCount = Object.values(columnFilters).filter((value) => value.trim()).length

  const visibleRows = useMemo(() => {
    if (!table) return []
    let rows = table.rows

    const activeFilters = Object.entries(columnFilters).filter(([, value]) => value.trim())
    if (activeFilters.length > 0) {
      rows = rows.filter((row) =>
        activeFilters.every(([column, filterValue]) =>
          foldTurkish(formatCellValue(row[column])).includes(foldTurkish(filterValue.trim())),
        ),
      )
    }

    if (sortState) {
      const { column, direction } = sortState
      const factor = direction === 'asc' ? 1 : -1
      rows = [...rows].sort((rowA, rowB) => {
        const a = sortValue(rowA, column)
        const b = sortValue(rowB, column)
        if (a.num !== null && b.num !== null) return (a.num - b.num) * factor
        return a.text.localeCompare(b.text, 'tr-TR') * factor
      })
    }

    return rows
  }, [table, columnFilters, sortState])

  const summaryStats = useMemo(
    () => buildSummaryStats(visibleRows, dosyaNoColumn, kisiSayisiColumn, miktarColumn),
    [visibleRows, dosyaNoColumn, kisiSayisiColumn, miktarColumn],
  )

  const toggleSort = (column: string) => {
    setSortState((current) => {
      if (!current || current.column !== column) return { column, direction: 'asc' }
      if (current.direction === 'asc') return { column, direction: 'desc' }
      return null
    })
  }

  if (report === undefined) {
    return null
  }

  if (!report || !table) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-2xl font-black text-slate-700">Görüntülenecek bir rapor yok</p>
        <p className="max-w-md text-xl font-semibold text-slate-500">
          Sosyal Asistan sohbetinde bir sonuç aldıktan sonra &quot;Yeni Sekmede Aç&quot; ile buraya gönderebilirsiniz.
        </p>
      </div>
    )
  }

  const { question, generatedAt } = report

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-slate-50 p-1 print:bg-white print:p-0 dark:bg-slate-950">
      {/* Kullanici istegi (2026-09-21, 4. tur): "başlıklar daha profesyonel
          ve renkli olsun sayfa daha profesyonel bir sayfa haline
          getirelim" - duz gri baslik yerine markanin lacivertiyle (#1E2A38)
          uyumlu bir "hero" kart + tablo basliklari da ayni renk tonunda. */}
      <div className="sticky top-0 z-10 shrink-0 rounded-xl bg-[#1E2A38] px-5 py-4 text-white shadow-[0_8px_20px_rgba(16,30,43,0.25)] sm:px-6 print:static print:rounded-none print:bg-none print:text-slate-900 print:shadow-none">
       <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-xl print:hidden">🤖</span>
            <div>
              <p className="text-lg font-black uppercase tracking-wide text-white/70 print:text-slate-500">Sosyal Asistan</p>
              <h1 className="text-xl font-black leading-tight sm:text-2xl">Sosyal Asistan Raporu</h1>
            </div>
          </div>
          <p className="mt-1.5 text-xl font-semibold italic text-white/85 print:text-slate-600">{question}</p>
        </div>
        {/* Kullanici istegi (2026-09-21, 6. tur): "listenin genel durumu ile
            ilgili rapor ver, örneğin toplam dosya sayısı, toplam birey
            sayısı gibi" - baslik kartinin sagindaki bos alana (ekran
            goruntusunde isaretlenen yer) ozet istatistik kartlari eklendi;
            sorguya gore hangi sutunlar bulunursa (Dosya No/Kişi Sayısı/
            Miktar) o kadar kart gosterilir (bkz. buildSummaryStats). */}
        <div className="flex flex-wrap gap-2 lg:shrink-0 print:hidden">
          {summaryStats.map((stat) => (
            <div key={stat.label} className="min-w-[100px] rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-center">
              <p className="text-xl font-black leading-tight sm:text-2xl">{stat.value}</p>
              <p className="text-sm font-bold uppercase tracking-wide text-white/70">{stat.label}</p>
            </div>
          ))}
        </div>
       </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isExporting}
            className="rounded-md bg-emerald-500 px-4 py-2 text-base font-black uppercase text-white shadow-sm hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 print:hidden"
          >
            {isExporting ? 'Hazırlanıyor…' : 'Excel (.xlsx) İndir'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-white/15 px-4 py-2 text-base font-black uppercase text-white shadow-sm hover:bg-white/25 print:hidden"
          >
            Yazdır
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setColumnFilters({})}
              className="rounded-md bg-white/15 px-4 py-2 text-base font-black uppercase text-white shadow-sm hover:bg-white/25 print:hidden"
            >
              Filtreleri Temizle ({activeFilterCount})
            </button>
          )}
          <span className="text-lg font-bold text-white/80 print:text-slate-500">
            {activeFilterCount > 0 ? `${visibleRows.length} / ${table.rows.length}` : table.rows.length} satır
            {table.truncated ? ' (örnek)' : ''} — {new Date(generatedAt).toLocaleString('tr-TR')}
          </span>
        </div>
        {linkColumn && (
          <p className="mt-2 text-lg font-bold text-white/90 print:hidden">Bir satıra çift tıklayarak ilgili dosyayı açabilirsiniz.</p>
        )}
        {exportError && <p className="mt-2 text-lg font-bold text-rose-100 print:hidden">{exportError}</p>}
        {openError && <p className="mt-2 text-lg font-bold text-rose-100 print:hidden">{openError}</p>}
      </div>

      {/* Kullanici istegi (2026-09-30): bu tablonun sutunlari da ASISTANIN
          SORGUSUNA GORE DEGISIR (bkz. AsistanChat.tsx - ResultTable'daki
          ayni gerekce) - bilincli olarak orta duzeyde buyutuldu, tam 20px
          cok sutunlu bir raporda yatay kullanilabilirligi bozardi. */}
      <div className="app-visible-scroll min-h-0 flex-1 overflow-auto rounded-xl border border-slate-300 bg-white shadow-sm print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        {table.rows.length === 0 ? (
          <p className="p-4 text-xl font-bold text-slate-500">Sonuç bulunamadı.</p>
        ) : (
          <table className="min-w-full border-collapse text-base">
            <thead className="sticky top-0 z-[1]">
              <tr className="bg-[#1E2A38]">
                {table.columns.map((column) => {
                  const isSorted = sortState?.column === column
                  return (
                    <th key={column} className="whitespace-nowrap px-4 py-3 text-left font-black uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={`flex items-center gap-1.5 transition hover:text-amber-200 ${isSorted ? 'text-amber-300' : ''}`}
                        title="Sıralamak için tıklayın"
                      >
                        {column}
                        <span className="text-sm leading-none opacity-80">
                          {isSorted ? (sortState!.direction === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
              <tr className="bg-slate-100 print:hidden">
                {table.columns.map((column) => (
                  <th key={column} className="border-b border-slate-200 px-2.5 py-2 font-normal normal-case">
                    <input
                      type="text"
                      value={columnFilters[column] || ''}
                      onChange={(event) => setColumnFilters((current) => ({ ...current, [column]: event.target.value }))}
                      placeholder="Filtrele…"
                      className="w-full min-w-[90px] rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#1E2A38] focus:ring-1 focus:ring-[#1E2A38]/30"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={table.columns.length} className="px-4 py-6 text-center text-xl font-bold text-slate-400">
                    Filtreyle eşleşen satır yok.
                  </td>
                </tr>
              )}
              {visibleRows.map((row, index) => {
                const rawLinkValue = linkColumn ? row[table.columns[linkColumn.index]] : null
                const linkValue = rawLinkValue === null || rawLinkValue === undefined ? '' : String(rawLinkValue)
                const isClickable = Boolean(linkColumn && linkValue)
                const rowKey = linkColumn ? `${linkColumn.mode}:${linkValue}` : ''
                const isOpening = isClickable && openingRowKey === rowKey

                return (
                  <tr
                    key={index}
                    onDoubleClick={isClickable ? () => void openFile(linkColumn!.mode, linkValue) : undefined}
                    className={`${index % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'} ${isClickable ? `cursor-pointer hover:bg-sky-50 ${isOpening ? 'opacity-50' : ''}` : ''}`}
                    title={isClickable ? 'Çift tıklayarak dosyayı aç' : undefined}
                  >
                    {table.columns.map((column) => (
                      <td key={column} className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-700">
                        {formatCellValue(row[column])}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function AsistanRaporPage() {
  return (
    <Suspense fallback={null}>
      <ReportContent />
    </Suspense>
  )
}
