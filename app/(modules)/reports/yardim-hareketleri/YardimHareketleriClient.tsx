'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { downloadXlsx } from '@/lib/utils/xlsxExport'

type YardimHareketleriClientProps = {
  groups: Array<{ yardimtip: string; count: number }>
  data: Record<string, unknown>[]
  exportData: Record<string, unknown>[]
  filterValueOptions?: Record<string, ColumnValueOption[]>
  selectedTip: string
  startDate: string
  endDate: string
  totalCount: number
  totalAmount: number
  currentPage: number
  pageSize: number
  errorMessage?: string | null
}

type XlsxCellValue = string | number | boolean | Date | null | undefined
type XlsxSafeRow = Record<string, XlsxCellValue>
type ColumnValueOption = { value: string; label: string; count: number }

function toXlsxRows(rows: Record<string, unknown>[]): XlsxSafeRow[] {
  return rows.map((row) => {
    const nextRow: XlsxSafeRow = {}
    Object.entries(row).forEach(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
      ) {
        nextRow[key] = value
        return
      }

      nextRow[key] = JSON.stringify(value)
    })
    return nextRow
  })
}

function buildUrl(searchParams: URLSearchParams, updates: Record<string, string | null>) {
  const params = new URLSearchParams(searchParams.toString())

  Object.entries(updates).forEach(([key, value]) => {
    if (value && value.trim()) {
      params.set(key, value.trim())
      return
    }

    params.delete(key)
  })

  const query = params.toString()
  return query ? `/reports/yardim-hareketleri?${query}` : '/reports/yardim-hareketleri'
}

export function YardimHareketleriClient({
  groups,
  data,
  exportData,
  filterValueOptions = {},
  selectedTip,
  startDate,
  endDate,
  totalCount,
  totalAmount,
  currentPage,
  pageSize,
  errorMessage,
}: YardimHareketleriClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [startInput, setStartInput] = useState(startDate)
  const [endInput, setEndInput] = useState(endDate)

  const firstRecord = data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const canGoPrevious = currentPage > 1
  const canGoNext = currentPage < totalPages
  const totalAmountText = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(totalAmount)

  const filterSignature = useMemo(() => {
    const params = new URLSearchParams()
    searchParams.forEach((value, key) => {
      if (key.startsWith('f_')) params.append(key, value)
    })
    return params.toString()
  }, [searchParams])
  const columnLabels = useMemo(() => ({
    dosya_sahibi: 'DOSYA SAHİBİ',
    inceleme_puani: 'İNCELEME PUANI',
  }), [])

  const selectTip = (yardimtip: string) => {
    router.push(buildUrl(searchParams, { tip: yardimtip, page: '1' }))
  }

  const applyDateRange = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(buildUrl(searchParams, { start: startInput, end: endInput, page: '1' }))
  }

  const clearDateRange = () => {
    setStartInput('')
    setEndInput('')
    router.push(buildUrl(searchParams, { start: null, end: null, page: '1' }))
  }

  const goToPage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const requestedPage = Math.max(1, Math.min(totalPages, Number(formData.get('page')) || currentPage))
    router.push(buildUrl(searchParams, { page: String(requestedPage) }))
  }

  const exportListedRows = () => {
    if (exportData.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    downloadXlsx(toXlsxRows(exportData), `yardim-hareketleri-${today}.xlsx`, 'Yardım Hareketleri')
  }

  const openRowDocument = (row: Record<string, unknown>) => {
    const fileId = row.dosyaid
    const fileNo = row.dosyano

    if (fileId) {
      router.push(`/documents?fileId=${encodeURIComponent(String(fileId))}`)
      return
    }

    if (fileNo) {
      router.push(`/documents/all?search=${encodeURIComponent(String(fileNo))}`)
    }
  }

  return (
    <div className="space-y-6 text-slate-950">
      <ReportPageHeader
        eyebrow="Raporlar"
        title="Yardım Hareketleri"
        description={`${firstRecord}-${lastRecord} arası kayıtlar gösteriliyor. İşlem sayısı: ${totalCount}. Toplam miktar: ${totalAmountText}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>
              Yazdır (Ctrl+P)
            </button>
            <button
              type="button"
              className={reportHeaderGhostButton}
              onClick={exportListedRows}
              disabled={exportData.length === 0}
            >
              Excel
            </button>
          </div>
        }
      />

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-600">Yardım Tipleri</h2>
          <form onSubmit={applyDateRange} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[15px] font-black text-slate-600">
              Başlangıç
              <input
                type="date"
                value={startInput}
                onChange={(event) => setStartInput(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[15px] font-black text-slate-600">
              Bitiş
              <input
                type="date"
                value={endInput}
                onChange={(event) => setEndInput(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
              />
            </label>
            <button type="submit" className="rounded-md bg-[#0076b6] px-4 py-2 text-[15px] font-extrabold text-white hover:bg-[#00649b]">
              Listele
            </button>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={clearDateRange}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[15px] font-extrabold text-slate-600 hover:bg-slate-50"
              >
                Temizle
              </button>
            )}
          </form>
        </div>

        <div className="flex flex-wrap gap-2">
          {groups.length === 0 ? (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500">
              Kayıt bulunamadı
            </span>
          ) : (
            groups.map((group) => {
              const active = group.yardimtip === selectedTip
              return (
                <button
                  key={group.yardimtip}
                  type="button"
                  onClick={() => selectTip(group.yardimtip)}
                  className={`rounded-md border px-3 py-2 text-sm font-black transition-colors ${
                    active
                      ? 'border-[#0076b6] bg-[#0076b6] text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {group.yardimtip} ({group.count})
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <AdvancedTable
          key={`yardim-hareketleri-${selectedTip}-${startDate}-${endDate}-${filterSignature}`}
          data={errorMessage ? [] : data}
          tableId="yardim_hareketleri_rapor_firmaad"
          selectable={false}
          showRowNumber
          rowNumberStart={firstRecord || 1}
          excludedColumns={['dosyaid']}
          preferredColumnOrder={['id', 'dosyano', 'inceleme_puani', 'dosya_sahibi', 'kartno', 'firmaad', 'firmatip', 'yardimtip', 'miktar', 'tarih']}
          columnLabels={columnLabels}
          filterValueOptions={filterValueOptions}
          onRowDoubleClick={openRowDocument}
          serverSideFiltering
        />

        {data.length === 0 && !errorMessage && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
            Seçilen yardım tipi ve tarih aralığı için kayıt bulunamadı.
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 text-sm font-bold text-slate-600 md:flex-row md:items-center md:justify-between print:hidden">
          <span>
            Toplam {totalCount} kayıt, sayfa {currentPage}/{totalPages}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canGoPrevious}
              onClick={() => router.push(buildUrl(searchParams, { page: String(currentPage - 1) }))}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => router.push(buildUrl(searchParams, { page: String(currentPage + 1) }))}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Sonraki
            </button>
            <form onSubmit={goToPage} className="flex items-center gap-2">
              <input
                key={currentPage}
                name="page"
                type="number"
                min={1}
                max={totalPages}
                defaultValue={currentPage}
                className="w-20 rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-[#0076b6]"
                aria-label="Sayfa numarası"
              />
              <button
                type="submit"
                className="rounded-md border border-[#0076b6] bg-white px-4 py-2 text-[15px] font-black text-[#0076b6] hover:bg-[#eaf7fd]"
              >
                Sayfaya Git
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
