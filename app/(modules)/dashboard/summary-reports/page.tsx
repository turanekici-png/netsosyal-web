'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTabs } from '@/lib/context/TabContext'
import { AdvancedTable } from '@/components/shared/AdvancedTable'

export const dynamic = 'force-dynamic'

interface SummaryReportRecord {
  id: string
  fileNo: string
  name: string
  identityNumber: string
  phone: string
  address: string
  status: string
  detail: string
  date: string | null
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('tr-TR').format(value)
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('tr-TR')
}

function SummaryReportsContent() {
  const searchParams = useSearchParams()
  const { addTab } = useTabs()
  const kind = searchParams.get('kind') || 'all-files'
  const requestedTitle = searchParams.get('title') || 'Ozet Rapor'
  const [title, setTitle] = useState(requestedTitle)
  const [records, setRecords] = useState<SummaryReportRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const openFile = (fileNo: string) => {
    if (!fileNo || fileNo === '-') return
    const query = new URLSearchParams({ search: fileNo })

    addTab({
      title: `Dosya ${fileNo}`,
      path: `/documents?${query.toString()}`,
    })
  }

  useEffect(() => {
    let isCancelled = false

    async function loadRecords() {
      try {
        setIsLoading(true)
        const query = new URLSearchParams({ kind })
        const response = await fetch(`/api/dashboard/summary-reports?${query.toString()}`)
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Ozet rapor listesi alinamadi.')
        }

        if (!isCancelled) {
          setTitle(payload.data.title || requestedTitle)
          setRecords(payload.data.records)
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setTitle(requestedTitle)
          setError(err instanceof Error ? err.message : 'Ozet rapor listesi yuklenirken hata olustu.')
          setRecords([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadRecords()

    return () => {
      isCancelled = true
    }
  }, [kind, requestedTitle])

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-md border border-[#9bd36f] bg-gradient-to-r from-[#0076b6] to-[#6fb744] px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[15px] font-black uppercase tracking-wide text-white/90">Ana Sayfa Ozet Raporu</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">{title}</h1>
            <p className="mt-1 text-sm font-bold text-white/85">Kart degerinden acilan kayit listesi</p>
          </div>
          <div className="rounded-md border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold">
            Toplam: {isLoading ? '...' : formatNumber(records.length)}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Liste yukleniyor...
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Bu kritere uygun kayit bulunamadi.
        </div>
      ) : (
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <h2 className="text-base font-extrabold text-[#005f95]">{title}</h2>
            <span className="rounded-full bg-white px-3 py-1 text-[14px] font-extrabold text-slate-600">
              {formatNumber(records.length)} kayit
            </span>
          </div>
          <div className="p-4">
            <AdvancedTable
              data={records as unknown as Record<string, unknown>[]}
              tableId={`dashboard_summary_${kind}`}
              excludedColumns={['id']}
              preferredColumnOrder={['fileNo', 'name', 'identityNumber', 'phone', 'status', 'detail', 'date', 'address']}
              columnLabels={{ fileNo: 'Dosya No', name: 'Kişi / Kayıt', identityNumber: 'TC', phone: 'Telefon', status: 'Durum', detail: 'Detay', date: 'Tarih', address: 'Adres' }}
              onRowDoubleClick={(row) => openFile(String(row.fileNo || ''))}
              showRowNumber
            />
          </div>
          <div className="hidden overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
              <thead className="bg-white text-[14px] font-extrabold uppercase text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2">Dosya No</th>
                  <th className="border-b border-slate-200 px-3 py-2">Kişi / Kayıt</th>
                  <th className="border-b border-slate-200 px-3 py-2">TC</th>
                  <th className="border-b border-slate-200 px-3 py-2">Telefon</th>
                  <th className="border-b border-slate-200 px-3 py-2">Durum</th>
                  <th className="border-b border-slate-200 px-3 py-2">Detay</th>
                  <th className="border-b border-slate-200 px-3 py-2">Tarih</th>
                  <th className="border-b border-slate-200 px-3 py-2">Adres</th>
                </tr>
              </thead>
              <tbody>
                {records.map((item) => (
                  <tr
                    key={`${kind}-${item.id}`}
                    onClick={() => openFile(item.fileNo)}
                    className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-sky-50"
                  >
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.fileNo}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-800">{item.name}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.identityNumber}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.phone}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.status}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.detail}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{formatDate(item.date)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

export default function SummaryReportsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-bold text-slate-500">Liste yukleniyor...</div>}>
      <SummaryReportsContent />
    </Suspense>
  )
}
