'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { reportHeaderGhostButton, reportHeaderPrintButton } from '@/components/shared/ReportPageHeader'

type DetailOperation = {
  operationType: string
  tableName: string
  recordId: string
  description: string
  activityDate: string | null
}

type SummaryItem = {
  label: string
  count: number
}

type ReportData = {
  userName: string
  period: string
  periodLabel: string
  operations: DetailOperation[]
  operationSummary: SummaryItem[]
  tableSummary: SummaryItem[]
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalize(value: string) {
  return value.toLocaleLowerCase('tr-TR')
}

function operationBadgeClass(operationType: string) {
  const op = normalize(operationType)
  if (op.includes('ekle') || op.includes('insert')) return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (op.includes('sil') || op.includes('delete')) return 'bg-rose-50 text-rose-700 border border-rose-200'
  if (op.includes('guncelle') || op.includes('güncelle') || op.includes('update')) return 'bg-sky-50 text-[#0076b6] border border-sky-200'
  return 'bg-slate-100 text-slate-600 border border-slate-200'
}

function tableBadgeClass(tableName: string) {
  const table = normalize(tableName)
  if (table.startsWith('dosya')) return 'bg-amber-50 text-amber-800 border border-amber-200'
  if (table.startsWith('birey')) return 'bg-blue-50 text-blue-800 border border-blue-200'
  if (table.startsWith('yrd_')) return 'bg-rose-50 text-rose-700 border border-rose-200'
  if (table.startsWith('tahkikat') || table.includes('rapor')) return 'bg-violet-50 text-violet-700 border border-violet-200'
  return 'bg-slate-100 text-slate-600 border border-slate-200'
}

export const dynamic = 'force-dynamic'

function PersonnelPerformanceReportContent() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<ReportData | null>(null)
  const [status, setStatus] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [operationFilter, setOperationFilter] = useState('all')
  const [tableFilter, setTableFilter] = useState('all')

  const userName = searchParams.get('user') || ''
  const period = searchParams.get('period') || 'daily'

  useEffect(() => {
    if (!userName) return

    const controller = new AbortController()

    fetch(`/api/settings/personnel-performance/details?user=${encodeURIComponent(userName)}&period=${encodeURIComponent(period)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Rapor bilgisi alınamadı.')
        }
        setData(payload.data)
        setStatus('')
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        setStatus(error instanceof Error ? error.message : 'Rapor bilgisi alınamadı.')
      })
      .finally(() => setIsLoading(false))

    return () => controller.abort()
  }, [period, userName])

  const operationOptions = useMemo(() => {
    return Array.from(new Set((data?.operations ?? []).map((item) => item.operationType))).sort((a, b) => a.localeCompare(b, 'tr-TR'))
  }, [data])

  const tableOptions = useMemo(() => {
    return Array.from(new Set((data?.operations ?? []).map((item) => item.tableName))).sort((a, b) => a.localeCompare(b, 'tr-TR'))
  }, [data])

  const filteredOperations = useMemo(() => {
    const query = normalize(searchTerm.trim())
    return (data?.operations ?? []).filter((item) => {
      const matchesOperation = operationFilter === 'all' || item.operationType === operationFilter
      const matchesTable = tableFilter === 'all' || item.tableName === tableFilter
      const searchable = normalize([
        item.operationType,
        item.tableName,
        item.recordId,
        item.description,
        formatDate(item.activityDate),
      ].join(' '))
      const matchesSearch = !query || searchable.includes(query)
      return matchesOperation && matchesTable && matchesSearch
    })
  }, [data, operationFilter, searchTerm, tableFilter])

  const totalOperations = data?.operations.length ?? 0
  const totalTables = data?.tableSummary.length ?? 0
  const totalTypes = data?.operationSummary.length ?? 0
  const maxOperationCount = Math.max(...(data?.operationSummary.map((item) => item.count) ?? [0]), 1)
  const lastOperationDate = data?.operations[0]?.activityDate ?? null

  return (
    <main className="min-h-screen w-full bg-gradient-to-br from-sky-50 via-white to-emerald-50 px-3 py-5 text-slate-900 sm:px-5 lg:px-8">
      <div className="mx-auto w-full max-w-[1900px] space-y-5">
        <div className="rounded-lg border border-[#8fd167] bg-gradient-to-r from-[#087fb2] via-[#309690] to-[#6fb744] px-5 py-4 text-white shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/85">Personel performans raporu</p>
              <h1 className="mt-1 text-2xl font-black leading-tight text-white lg:text-3xl">{data?.userName || userName || 'Kullanıcı'}</h1>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                <span className="inline-flex items-center justify-center rounded-md border border-white/50 bg-white/15 px-3 py-1.5 text-white">
                  {data?.periodLabel || 'Günlük'} rapor
                </span>
                <span className="inline-flex items-center justify-center rounded-md border border-white/50 bg-white/15 px-3 py-1.5 text-white">
                  Son işlem: {formatDate(lastOperationDate)}
                </span>
                <span className="inline-flex items-center justify-center rounded-md border border-white/50 bg-white/15 px-3 py-1.5 text-white">
                  Filtrelenen kayıt: {filteredOperations.length.toLocaleString('tr-TR')}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => window.print()} className={reportHeaderPrintButton}>
                Yazdır
              </button>
              <a href="/settings?tab=personnelPerformance" className={reportHeaderGhostButton}>
                Performans ekranına dön
              </a>
            </div>
          </div>
        </div>

        {!userName ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">
            Rapor için kullanıcı bilgisi bulunamadı.
          </div>
        ) : isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500 shadow-sm">
            Rapor hazırlanıyor...
          </div>
        ) : status ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">
            {status}
          </div>
        ) : data ? (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
              {[
                { label: 'Toplam işlem', value: totalOperations, tone: 'text-[#0076b6]', helper: 'Seçilen dönemde yapılan tüm hareketler', card: 'border-sky-200 bg-gradient-to-br from-sky-50 to-white' },
                { label: 'Filtrelenen', value: filteredOperations.length, tone: 'text-emerald-700', helper: 'Arama ve filtre sonrası görünen kayıt', card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white' },
                { label: 'İşlem türü', value: totalTypes, tone: 'text-violet-700', helper: 'Farklı işlem başlığı sayısı', card: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white' },
                { label: 'Etkilenen tablo', value: totalTables, tone: 'text-amber-700', helper: 'Kayıt girilen farklı tablo sayısı', card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white' },
              ].map((item) => (
                <div key={item.label} className={`rounded-lg border p-5 shadow-sm ${item.card}`}>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">{item.label}</p>
                  <p className={`mt-2 text-3xl font-black ${item.tone}`}>{item.value.toLocaleString('tr-TR')}</p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{item.helper}</p>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px_220px_auto] lg:items-end">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Raporda ara</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Açıklama, tablo, kayıt no veya işlem ara"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">İşlem türü</span>
                  <select
                    value={operationFilter}
                    onChange={(event) => setOperationFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                  >
                    <option value="all">Tümü</option>
                    {operationOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Tablo</span>
                  <select
                    value={tableFilter}
                    onChange={(event) => setTableFilter(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-[#0076b6] focus:bg-white"
                  >
                    <option value="all">Tümü</option>
                    {tableOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('')
                    setOperationFilter('all')
                    setTableFilter('all')
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:border-rose-200 hover:text-rose-600"
                >
                  Temizle
                </button>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
              <div className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-black text-slate-900">İşlem dağılımı</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">{data.operationSummary.length} tür</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {data.operationSummary.length > 0 ? data.operationSummary.map((item) => (
                      <button
                        key={`operation-${item.label}`}
                        type="button"
                        onClick={() => setOperationFilter(item.label)}
                        className="block w-full rounded-lg p-2 text-left hover:bg-slate-50"
                      >
                        <div className="mb-1 flex justify-between gap-3 text-xs font-black text-slate-600">
                          <span className="truncate">{item.label}</span>
                          <span>{item.count.toLocaleString('tr-TR')}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              normalize(item.label).includes('ekle') ? 'bg-emerald-500'
                                : normalize(item.label).includes('sil') ? 'bg-rose-500'
                                : normalize(item.label).includes('guncelle') || normalize(item.label).includes('güncelle') ? 'bg-[#0076b6]'
                                : 'bg-slate-400'
                            }`}
                            style={{ width: `${Math.max((item.count / maxOperationCount) * 100, 4)}%` }}
                          />
                        </div>
                      </button>
                    )) : (
                      <p className="rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-400">İşlem kaydı yok.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-black text-slate-900">Tablo dağılımı</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">{data.tableSummary.length} tablo</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {data.tableSummary.length > 0 ? data.tableSummary.map((item) => (
                      <button
                        key={`table-${item.label}`}
                        type="button"
                        onClick={() => setTableFilter(item.label)}
                        className={`rounded-full px-3 py-1 text-xs font-black transition-colors hover:opacity-80 ${tableBadgeClass(item.label)}`}
                      >
                        {item.label}: {item.count.toLocaleString('tr-TR')}
                      </button>
                    )) : (
                      <p className="text-xs font-bold text-slate-400">Tablo kaydı yok.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-sm font-black text-slate-900">Yapılan işlemler</h2>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Seçilen kullanıcının kayıt hareketleri tarih sırasına göre listelenir.</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                    {filteredOperations.length.toLocaleString('tr-TR')} kayıt
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Tarih</th>
                        <th className="px-4 py-3">İşlem</th>
                        <th className="px-4 py-3">Tablo</th>
                        <th className="px-4 py-3">Kayıt No</th>
                        <th className="px-4 py-3">Açıklama</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredOperations.length > 0 ? filteredOperations.map((item, index) => (
                        <tr key={`${item.tableName}-${item.recordId}-${item.activityDate}-${index}`} className="align-top odd:bg-white even:bg-slate-50/60 hover:bg-sky-50/70">
                          <td className="whitespace-nowrap px-4 py-3 text-xs font-bold text-slate-500">{formatDate(item.activityDate)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${operationBadgeClass(item.operationType)}`}>{item.operationType}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tableBadgeClass(item.tableName)}`}>{item.tableName}</span>
                          </td>
                          <td className="px-4 py-3 text-xs font-bold text-slate-500">{item.recordId}</td>
                          <td className="max-w-xl px-4 py-3 text-xs font-semibold leading-5 text-slate-700">{item.description}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={5} className="px-4 py-12 text-center">
                            <p className="text-sm font-black text-slate-500">Kayıt bulunamadı</p>
                            <p className="mt-1 text-xs font-semibold text-slate-400">Arama veya filtreleri temizleyerek tekrar deneyebilirsiniz.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}

export default function PersonnelPerformanceReportPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-bold text-slate-500">Rapor hazırlanıyor...</div>}>
      <PersonnelPerformanceReportContent />
    </Suspense>
  )
}
