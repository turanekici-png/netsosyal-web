'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { downloadXlsx } from '@/lib/utils/xlsxExport'
import { parseXlsxFile } from '@/lib/utils/xlsxImport'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  DestructiveAuthorizationDialog,
  type DestructiveAuthorizationDialogHandle,
} from '@/components/security/DestructiveAuthorizationDialog'

type GulkartRezervClientProps = {
  data: Record<string, unknown>[]
  columns: string[]
  totalCount: number
  currentPage: number
  pageSize: number
  searchTerm: string
  errorMessage?: string | null
}

type CsvRow = Record<string, string>

const HIDDEN_COLUMNS = ['__rowid', 'kullaniciid', 'islemtarihi']

const COLUMN_LABELS: Record<string, string> = {
  id: 'Kayıt No',
  kartno: 'Kart No',
  barkod: 'Barkod',
}

const PREFERRED_COLUMN_ORDER = ['kartno', 'barkod', 'id']

// Kullanici istegi: Excel/CSV sablonunda sadece bu 2 (okunakli) baslik yer
// alsin - "id" otomatik atanir, "kullaniciid"/"islemtarihi" ise islem
// yapan kullaniciyi/zamani tutan meta alanlardir, elle doldurulmasi
// anlamsizdir.
const IMPORT_TEMPLATE_HEADERS = ['Kart No', 'BarKod No']

// Sunucu tarafi (bkz. app/api/gulkart/rezerv/route.ts) sutunlari HAM
// veritabani adlarina (kartno, barkod) gore eslestiriyor - kullanicinin
// doldurdugu sablondaki okunakli basliklar ("Kart No", "BarKod No")
// gonderilmeden ONCE burada HAM adlara cevrilir. Anahtar karsilastirma
// kucuk harfe cevrilip bosluklar temizlenerek yapilir, boylece "Kart No",
// "kart no", "KART NO" gibi varyasyonlarin hepsi eslesir; eslesmeyen
// basliklar (ör. kullanici zaten ham "kartno" yazmissa) OLDUGU GIBI
// birakilir - sunucu zaten HAM adlari da kabul ediyor.
const IMPORT_HEADER_ALIASES: Record<string, string> = {
  'kart no': 'kartno',
  'barkod no': 'barkod',
}

function remapImportHeaders(rows: CsvRow[]): CsvRow[] {
  return rows.map((row) => {
    const remapped: CsvRow = {}
    Object.entries(row).forEach(([header, value]) => {
      const normalizedHeader = header.trim().toLocaleLowerCase('tr-TR')
      const canonicalHeader = IMPORT_HEADER_ALIASES[normalizedHeader] || header
      remapped[canonicalHeader] = value
    })
    return remapped
  })
}

function removeHiddenColumns(row: Record<string, unknown>) {
  const visibleRow: Record<string, unknown> = {}
  Object.entries(row).forEach(([key, value]) => {
    if (!HIDDEN_COLUMNS.includes(key.toLocaleLowerCase('tr-TR'))) {
      visibleRow[key] = value
    }
  })
  return visibleRow
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"' && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function detectDelimiter(headerLine: string) {
  const delimiters = [';', ',', '\t']
  return delimiters
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ';'
}

function parseCsv(text: string): CsvRow[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalizedText.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return []

  const delimiter = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim())

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter)
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  }).filter((row) => Object.values(row).some((value) => value.trim()))
}

function toXlsxRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const safeRow: Record<string, string | number | boolean | Date | null | undefined> = {}
    Object.entries(row).forEach(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
      ) {
        safeRow[key] = value
        return
      }

      safeRow[key] = JSON.stringify(value)
    })
    return safeRow
  })
}

function buildPageUrl(routePath: string, searchParams: URLSearchParams, page: number, searchTerm: string) {
  const params = new URLSearchParams(searchParams.toString())
  params.set('page', String(page))

  if (searchTerm.trim()) {
    params.set('search', searchTerm.trim())
  } else {
    params.delete('search')
  }

  return `${routePath}?${params.toString()}`
}

export function GulkartRezervClient({
  data,
  columns,
  totalCount,
  currentPage,
  pageSize,
  searchTerm,
  errorMessage,
}: GulkartRezervClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const destructiveAuthorizationRef = useRef<DestructiveAuthorizationDialogHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchInput, setSearchInput] = useState(searchTerm)
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
  const [importStatus, setImportStatus] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [isSelectingFiltered, setIsSelectingFiltered] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionStatus, setActionStatus] = useState('')

  const firstRecord = data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const selectedRows = data.filter((row, index) => selectedRowIds.includes(String(row.id ?? row.__rowid ?? index)))

  const filterSignature = useMemo(() => {
    const params = new URLSearchParams()
    searchParams.forEach((value, key) => {
      if (key.startsWith('f_')) params.append(key, value)
    })
    return params.toString()
  }, [searchParams])

  // "Tümünü Seç"in gerektigi filtrelenmis-tum-id-listesi sorgusu icin -
  // ekrandaki arama/filtreler (f_...) AYNEN sunucuya iletilir, boylece
  // secilen kayitlar ekrandaki filtreyle her zaman tutarli olur.
  const filteredIdsUrl = useMemo(() => {
    const params = new URLSearchParams(filterSignature)
    params.set('idsOnly', '1')
    if (searchInput.trim()) params.set('search', searchInput.trim())
    return `/api/gulkart/rezerv?${params.toString()}`
  }, [filterSignature, searchInput])

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(buildPageUrl('/gulkart/rezerv', searchParams, 1, searchInput))
  }

  const refreshPage = () => {
    setRefreshing(true)
    router.refresh()
    window.setTimeout(() => setRefreshing(false), 600)
  }

  const clearFilters = () => {
    setSearchInput('')
    setSelectedRowIds([])
    setActionStatus('')
    router.replace('/gulkart/rezerv')
  }

  const exportSelectedRows = () => {
    if (selectedRows.length === 0) return
    downloadXlsx(toXlsxRows(selectedRows.map(removeHiddenColumns)), `secili-gulkart-rezerv-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Gülkart Rezerv')
  }

  const exportListedRows = () => {
    if (data.length === 0) return
    downloadXlsx(toXlsxRows(data.map(removeHiddenColumns)), `tum-gulkart-rezerv-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Gülkart Rezerv')
  }

  const downloadTemplate = () => {
    const content = `${IMPORT_TEMPLATE_HEADERS.join(';')}\n`
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nakitkartrezerv-sablon-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (file?: File) => {
    if (!file) return

    setIsImporting(true)
    setImportStatus('')

    try {
      // Kullanici istegi: ".xlsx dosyasını doğrudan yükleyebilelim" -
      // .xlsx dosyasi tarayicida (bagimliliksiz kendi okuyucumuzla - bkz.
      // parseXlsxFile) satirlara cevrilir, CSV ile AYNI JSON {rows}
      // akisiyla sunucuya gonderilir.
      const isXlsx = file.name.toLocaleLowerCase('tr-TR').endsWith('.xlsx')
      const parsedRows = isXlsx ? await parseXlsxFile(file) : parseCsv(await file.text())

      if (parsedRows.length === 0) {
        throw new Error('Dosyada aktarılacak satır bulunamadı.')
      }

      // Sablondaki okunakli basliklar ("Kart No", "BarKod No") sunucuya
      // gonderilmeden once HAM sutun adlarina ("kartno", "barkod") cevrilir.
      const rows = remapImportHeaders(parsedRows)

      const response = await fetch('/api/gulkart/rezerv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })

      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Excel aktarımı yapılamadı.')
      }

      setImportStatus(`${payload.data?.inserted || 0} kayıt aktarıldı${payload.data?.skipped ? `, ${payload.data.skipped} satır atlandı` : ''}.`)
      router.refresh()
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Excel aktarımı yapılamadı.')
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const selectAllFilteredRows = async () => {
    setIsSelectingFiltered(true)
    setActionStatus('')
    try {
      const response = await fetch(filteredIdsUrl)
      const payload = await response.json()
      if (!response.ok || !payload.success || !Array.isArray(payload.data?.ids)) {
        throw new Error(payload.error || 'Filtrelenen kayıtlar seçilemedi.')
      }
      setSelectedRowIds(payload.data.ids.map((id: unknown) => String(id)))
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Filtrelenen kayıtlar seçilemedi.')
    } finally {
      setIsSelectingFiltered(false)
    }
  }

  const deleteSelectedRows = async () => {
    if (selectedRowIds.length === 0) return

    if (!(await confirmDialog(`${selectedRowIds.length} Gülkart rezerv kaydı kalıcı olarak silinecek. Devam edilsin mi?`))) return

    const destructiveToken = await destructiveAuthorizationRef.current?.authorize(
      `${selectedRowIds.length} Gülkart Rezerv Kaydı İçin Silme Onayı`,
    )
    if (!destructiveToken) return

    setIsDeleting(true)
    setActionStatus('')

    try {
      const response = await fetch('/api/gulkart/rezerv', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-destructive-authorization': destructiveToken,
        },
        body: JSON.stringify({ ids: selectedRowIds }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Gülkart rezerv kayıtları silinemedi.')
      }

      setActionStatus(`${payload.data?.deleted || 0} Gülkart rezerv kaydı silindi.`)
      setSelectedRowIds([])
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Gülkart rezerv kayıtları silinemedi.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6 text-slate-950">
      <DestructiveAuthorizationDialog ref={destructiveAuthorizationRef} />
      <ReportPageHeader
        eyebrow="Gülkart İşlemleri"
        title="Gülkart Rezerv"
        description={`${firstRecord}-${lastRecord} arası kayıtlar gösteriliyor (Toplam ${totalCount} kayıt).`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>
              Yazdır
            </button>
          </div>
        }
      />

      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      {actionStatus && (
        <div className={`rounded-xl border p-4 text-sm font-bold print:hidden ${
          actionStatus.includes('silindi')
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
        >
          {actionStatus}
        </div>
      )}

      <div className="rounded-xl border border-pink-200 bg-white p-4 shadow-sm print:hidden">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[15px] font-black uppercase tracking-wide text-pink-700">Excel İle Veri Ekle</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Nakit Kart Rezerv Aktarımı</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Excel (.xlsx) dosyanızı doğrudan yükleyebilir, isterseniz CSV olarak da aktarabilirsiniz. Şablonda sadece{' '}
              <strong>Kart No, BarKod No</strong> başlıkları yer alır - bunları doldurup yükleyin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={columns.length === 0}
              className="rounded-md border border-pink-200 bg-pink-50 px-3 py-2 text-[15px] font-black text-pink-700 hover:bg-pink-100 disabled:opacity-50"
            >
              Excel Şablonu İndir
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="rounded-md bg-pink-600 px-3 py-2 text-[15px] font-black text-white hover:bg-pink-700 disabled:cursor-wait disabled:opacity-60"
            >
              {isImporting ? 'Aktarılıyor...' : 'CSV / Excel Verisi Yükle'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx"
              className="hidden"
              onChange={(event) => void handleImportFile(event.target.files?.[0])}
            />
          </div>
        </div>
        {importStatus && (
          <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${importStatus.includes('aktarıldı') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {importStatus}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-pink-50/60 p-4 shadow-[0_14px_35px_rgba(0,118,182,0.10)] print:hidden">
        <form onSubmit={handleSearch} className="flex w-full gap-2">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Kart no veya barkod ara"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 placeholder:text-slate-400 shadow-sm outline-none focus:border-[#0076b6]"
          />
          <button type="submit" className="min-h-11 rounded-xl bg-[#0076b6] px-4 py-2 text-[15px] font-extrabold text-white hover:bg-[#00649b]">
            Ara
          </button>
          {searchTerm && (
            <button type="button" onClick={clearFilters} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[15px] font-extrabold text-slate-600 hover:bg-slate-50">
              Temizle
            </button>
          )}
        </form>

        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 [&>button]:min-h-11 [&>button]:rounded-xl [&>button]:shadow-sm [&>span]:flex [&>span]:min-h-11 [&>span]:items-center [&>span]:justify-center [&>span]:rounded-xl">
          <span className="border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-black text-slate-600">
            Seçili: {selectedRowIds.length} / Filtre Sonucu: {totalCount}
          </span>
          <button
            type="button"
            onClick={() => void selectAllFilteredRows()}
            disabled={totalCount === 0 || isSelectingFiltered}
            className="border border-violet-300 bg-violet-50 px-3 py-2 text-[15px] font-black text-violet-700 hover:bg-violet-100 disabled:pointer-events-none disabled:opacity-50"
          >
            {isSelectingFiltered ? 'Seçiliyor...' : `Filtrelenenlerin Tümünü Seç (${totalCount})`}
          </button>
          {selectedRowIds.length > 0 && (
            <button type="button" onClick={() => setSelectedRowIds([])} className="border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50">
              Seçimi Kaldır
            </button>
          )}
          <button type="button" onClick={refreshPage} disabled={refreshing} className="border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {refreshing ? 'Yenileniyor...' : 'Yenile'}
          </button>
          <button type="button" onClick={exportSelectedRows} disabled={selectedRows.length === 0} className="bg-[#3f7f28] px-3 py-2 text-[15px] font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50">
            Seçilenleri XLSX Aktar
          </button>
          <button type="button" onClick={exportListedRows} disabled={data.length === 0} className="bg-amber-500 px-3 py-2 text-[15px] font-black text-white hover:bg-amber-600 disabled:pointer-events-none disabled:opacity-60">
            Tüm Kayıtları XLSX Aktar
          </button>
          <button
            type="button"
            onClick={() => void deleteSelectedRows()}
            disabled={selectedRowIds.length === 0 || isDeleting}
            className="bg-rose-600 px-3 py-2 text-[15px] font-black text-white hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50"
          >
            {isDeleting ? 'Siliniyor...' : `Seçilenleri Sil (${selectedRowIds.length})`}
          </button>
          <button type="button" onClick={clearFilters} className="border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50">
            Filtreleri Temizle
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-white p-4 shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
        {data.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
            Görüntülenecek Gülkart rezerv kaydı bulunamadı.
          </div>
        ) : (
          <AdvancedTable
            key={`nakitkartrezerv-${filterSignature}`}
            data={data}
            tableId="nakitkartrezerv"
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
            getRowId={(row, index) => String(row.id ?? row.__rowid ?? index)}
            excludedColumns={HIDDEN_COLUMNS}
            columnLabels={COLUMN_LABELS}
            preferredColumnOrder={PREFERRED_COLUMN_ORDER}
            showRowNumber
            rowNumberStart={firstRecord || 1}
            serverSideFiltering
          />
        )}

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 print:hidden">
          <div className="text-xs font-bold text-slate-500">
            Sayfa {currentPage} / {totalPages} (Toplam {totalCount} kayıt)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(buildPageUrl('/gulkart/rezerv', searchParams, currentPage - 1, searchTerm))}
              disabled={currentPage <= 1}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() => router.push(buildPageUrl('/gulkart/rezerv', searchParams, currentPage + 1, searchTerm))}
              disabled={currentPage >= totalPages}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
