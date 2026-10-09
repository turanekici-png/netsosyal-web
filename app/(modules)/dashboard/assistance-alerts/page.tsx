'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTabs } from '@/lib/context/TabContext'
import { AdvancedTable } from '@/components/shared/AdvancedTable'

export const dynamic = 'force-dynamic'

type AlertKind = 'recentStarts' | 'endingSoon'

interface AssistanceAlert {
  id: string
  type: string
  fileNo: string
  applicant: string
  identityNumber: string
  startDate: string | null
  endDate: string | null
  amount: string
  statusCode: string
  statusVariant?: 'default' | 'dgn'
  status: string
}

interface DashboardPayload {
  assistanceAlerts: {
    recentStarts: AssistanceAlert[]
    endingSoon: AssistanceAlert[]
  }
}

const titleByKind: Record<AlertKind, string> = {
  recentStarts: 'Son 10 Gunde Baslayan Yardimlar',
  endingSoon: 'Bitisine 10 Gun Kalan Yardimlar',
}

const descriptionByKind: Record<AlertKind, string> = {
  recentStarts: 'Baslangic tarihi son 10 gun icinde olan yardim kayitlari',
  endingSoon: 'Bitis tarihi bugunden itibaren 10 gun icinde olan yardim kayitlari',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('tr-TR').format(value)
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('tr-TR')
}

function getAssistanceStatusBadgeClass(statusCode: string, variant: 'default' | 'dgn' = 'default') {
  const defaultClasses: Record<string, string> = {
    '0': 'border-amber-600 bg-gradient-to-r from-amber-500 to-orange-600 text-white ring-2 ring-amber-200 shadow-md shadow-amber-200/70',
    '2': 'border-emerald-600 bg-gradient-to-r from-emerald-500 to-green-600 text-white ring-2 ring-emerald-200 shadow-md shadow-emerald-200/70',
    '3': 'border-rose-600 bg-gradient-to-r from-rose-500 to-red-600 text-white ring-2 ring-rose-200 shadow-md shadow-rose-200/70',
    '4': 'border-sky-600 bg-gradient-to-r from-sky-500 to-blue-600 text-white ring-2 ring-sky-200 shadow-md shadow-sky-200/70',
  }
  const dgnClasses: Record<string, string> = {
    '0': 'border-amber-600 bg-gradient-to-r from-amber-500 to-orange-600 text-white ring-2 ring-amber-200 shadow-md shadow-amber-200/70',
    '1': 'border-rose-600 bg-gradient-to-r from-rose-500 to-red-600 text-white ring-2 ring-rose-200 shadow-md shadow-rose-200/70',
    '6': 'border-emerald-600 bg-gradient-to-r from-emerald-500 to-green-600 text-white ring-2 ring-emerald-200 shadow-md shadow-emerald-200/70',
  }
  const classes = variant === 'dgn' ? dgnClasses : defaultClasses

  return classes[statusCode] || defaultClasses['0']
}

function groupAlertsByType(data: AssistanceAlert[]) {
  return data.reduce<Array<{ type: string; items: AssistanceAlert[] }>>((groups, item) => {
    const existingGroup = groups.find((group) => group.type === item.type)
    if (existingGroup) {
      existingGroup.items.push(item)
      return groups
    }

    return [...groups, { type: item.type, items: [item] }]
  }, [])
}

function AssistanceAlertsContent() {
  const searchParams = useSearchParams()
  const { addTab } = useTabs()
  const kindParam = searchParams.get('kind')
  const typeFilter = searchParams.get('type')
  const kind: AlertKind = kindParam === 'endingSoon' ? 'endingSoon' : 'recentStarts'
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isCancelled = false

    async function loadAlerts() {
      try {
        const response = await fetch('/api/dashboard')
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Yardim listesi alinamadi.')
        }

        if (!isCancelled) {
          setData(payload.data)
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Yardim listesi yuklenirken hata olustu.')
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadAlerts()

    return () => {
      isCancelled = true
    }
  }, [])

  const allRecords = data?.assistanceAlerts[kind] ?? []
  const records = typeFilter
    ? allRecords.filter((item) => item.type === typeFilter)
    : allRecords
  const groupedRecords = useMemo(() => groupAlertsByType(records), [records])
  const pageTitle = typeFilter ? `${typeFilter} - ${titleByKind[kind]}` : titleByKind[kind]
  const openFile = (fileNo: string) => {
    if (!fileNo || fileNo === '-') return
    const query = new URLSearchParams({ search: fileNo })

    addTab({
      title: `Dosya ${fileNo}`,
      path: `/documents?${query.toString()}`,
    })
  }

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-md border border-[#9bd36f] bg-gradient-to-r from-[#0076b6] to-[#6fb744] px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[15px] font-black uppercase tracking-wide text-white/90">Yardım Takibi</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">{pageTitle}</h1>
            <p className="mt-1 text-sm font-bold text-white/85">{descriptionByKind[kind]}</p>
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
          Bu kritere uygun yardim kaydi bulunamadi.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <AdvancedTable
              data={records as unknown as Record<string, unknown>[]}
              tableId={`dashboard_assistance_alerts_${kind}`}
              excludedColumns={['id', 'statusCode', 'statusVariant']}
              preferredColumnOrder={['type', 'fileNo', 'applicant', 'identityNumber', 'startDate', 'endDate', 'amount', 'status']}
              columnLabels={{ type: 'Yardım Türü', fileNo: 'Dosya No', applicant: 'Kişi', identityNumber: 'TC', startDate: 'Başlangıç', endDate: 'Bitiş', amount: 'Miktar', status: 'Durum' }}
              onRowDoubleClick={(row) => openFile(String(row.fileNo || ''))}
              showRowNumber
            />
          </div>
          <div className="hidden">
          {groupedRecords.map((group) => (
            <section key={group.type} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <h2 className="text-base font-extrabold text-[#005f95]">{group.type}</h2>
                <span className="rounded-full bg-white px-3 py-1 text-[14px] font-extrabold text-slate-600">
                  {formatNumber(group.items.length)} kayit
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead className="bg-white text-[14px] font-extrabold uppercase text-slate-600">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2">Dosya No</th>
                      <th className="border-b border-slate-200 px-3 py-2">Kişi</th>
                      <th className="border-b border-slate-200 px-3 py-2">TC</th>
                      <th className="border-b border-slate-200 px-3 py-2">Baslangic</th>
                      <th className="border-b border-slate-200 px-3 py-2">Bitis</th>
                      <th className="border-b border-slate-200 px-3 py-2">Miktar</th>
                      <th className="border-b border-slate-200 px-3 py-2">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => openFile(item.fileNo)}
                        className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-sky-50"
                      >
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.fileNo}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-800">{item.applicant}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.identityNumber}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{formatDate(item.startDate)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{formatDate(item.endDate)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.amount}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${getAssistanceStatusBadgeClass(item.statusCode, item.statusVariant)}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AssistanceAlertsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-bold text-slate-500">Liste yukleniyor...</div>}>
      <AssistanceAlertsContent />
    </Suspense>
  )
}
