'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { downloadXlsx } from '@/lib/utils/xlsxExport'

export type MessageReportRow = Record<string, unknown>

type MessageReportClientProps = {
  title: string
  eyebrow: string
  icon: string
  accentGradient: string
  routePath: string
  data: MessageReportRow[]
  totalCount: number
  currentPage: number
  pageSize: number
  searchTerm: string
  columnLabels: Record<string, string>
  preferredColumnOrder: string[]
  emptyMessage: string
  exportFilePrefix: string
  searchPlaceholder?: string
  // Durum (gönderildi/iletildi/okundu/hata gibi) sütununa göre filtreleme -
  // sayfa bu listeyi o kanalda GERÇEKTEN kullanılan durum değerleriyle
  // doldurur (bkz. whatsapp/page.tsx, page.tsx). Verilmezse dropdown gizlenir.
  statusOptions?: { value: string; label: string }[]
  statusFilterValue?: string
}

function buildPageUrl(routePath: string, searchParams: URLSearchParams, page: number) {
  const params = new URLSearchParams(searchParams.toString())
  params.set('page', String(page))
  return `${routePath}?${params.toString()}`
}

export function MessageReportClient({
  title,
  eyebrow,
  icon,
  accentGradient,
  routePath,
  data,
  totalCount,
  currentPage,
  pageSize,
  searchTerm,
  columnLabels,
  preferredColumnOrder,
  emptyMessage,
  exportFilePrefix,
  statusOptions,
  statusFilterValue,
  searchPlaceholder,
}: MessageReportClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const firstRecord = data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const value = String(formData.get('search') || '').trim()
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', '1')
    if (value) params.set('search', value)
    else params.delete('search')
    router.push(`${routePath}?${params.toString()}`)
  }

  // Durum filtresi degistirildigi AN (Ara butonuna basmadan) uygulanir -
  // arama kutusundan farkli olarak bu bir dropdown, kullanicinin "gonder"
  // niyeti zaten secim yapmasinin kendisidir.
  const handleStatusFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', '1')
    if (value) params.set('durum', value)
    else params.delete('durum')
    router.push(`${routePath}?${params.toString()}`)
  }

  const exportRows = () => {
    if (data.length === 0) return
    const rows = data.map((row) => {
      const safeRow: Record<string, string | number | boolean | Date | null | undefined> = {}
      Object.entries(row).forEach(([key, value]) => {
        if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) {
          safeRow[key] = value
          return
        }
        safeRow[key] = JSON.stringify(value)
      })
      return safeRow
    })
    downloadXlsx(rows, `${exportFilePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`, title)
  }

  return (
    <div className="space-y-6 text-slate-950">
      <div className="overflow-hidden rounded-2xl border border-white shadow-[0_18px_45px_rgba(15,23,42,0.10)] ring-1 ring-slate-200 print:hidden">
        <div className={`flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r ${accentGradient} px-5 py-4 text-white`}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 text-2xl">
              {icon}
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-white/80">{eyebrow}</p>
              <h1 className="text-lg font-black leading-tight">{title}</h1>
            </div>
          </div>
          <button type="button" onClick={() => window.print()} className={reportHeaderGhostButton}>
            Yazdır
          </button>
        </div>
        <div className="bg-gradient-to-b from-slate-50/60 via-white to-white px-5 py-2.5 text-xs font-bold text-slate-500">
          {firstRecord}-{lastRecord} arası kayıt gösteriliyor (toplam {totalCount}).
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <input
          name="search"
          defaultValue={searchTerm}
          placeholder={searchPlaceholder || 'Dosya no, ad soyad, telefon veya mesaj içeriğinde ara...'}
          className="min-w-[260px] flex-1 rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-[#0076b6]"
        />
        {statusOptions && statusOptions.length > 0 && (
          <select
            aria-label="Duruma göre filtrele"
            value={statusFilterValue || ''}
            onChange={handleStatusFilterChange}
            className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#0076b6]"
          >
            <option value="">Tüm Durumlar</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
        <button type="submit" className="rounded-lg bg-[#0076b6] px-5 py-2.5 text-sm font-black text-white hover:bg-[#00649b]">
          Ara
        </button>
        {(searchTerm || statusFilterValue) && (
          <button type="button" onClick={() => router.push(routePath)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50">
            Temizle
          </button>
        )}
        <button type="button" onClick={exportRows} disabled={data.length === 0} className="rounded-lg bg-[#3f7f28] px-4 py-2.5 text-sm font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50">
          XLSX Aktar
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {data.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <AdvancedTable
            data={data}
            tableId={`${exportFilePrefix}-table`}
            showRowNumber
            rowNumberStart={(currentPage - 1) * pageSize + 1}
            preferredColumnOrder={preferredColumnOrder}
            columnLabels={columnLabels}
          />
        )}

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 print:hidden">
          <div className="text-xs font-bold text-slate-500">
            Sayfa {currentPage} / {totalPages} (Toplam {totalCount} kayıt)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(buildPageUrl(routePath, searchParams, currentPage - 1))}
              disabled={currentPage <= 1}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() => router.push(buildPageUrl(routePath, searchParams, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
