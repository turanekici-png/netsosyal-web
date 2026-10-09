'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTabs } from '@/lib/context/TabContext'
import { AdvancedTable } from '@/components/shared/AdvancedTable'

export const dynamic = 'force-dynamic'

interface StaffReportRecord {
  id: string
  fileNo: string
  applicant: string
  identityNumber: string
  staff: string
  applicationDate: string | null
  amount: string
  stage: string
  status: string
  // Kullanici istegi: raporun en saginda gorunen "dosya durumu" (ör.
  // "Yardım Yapılamaz") diger raporlardaki gibi renkli gosterilsin - bu
  // yuzden API artik metin degil HAM/numerik kod gonderiyor,
  // AdvancedTable'in fileStatusColumns mekanizmasi renklendirip metne
  // cevirir (bkz. asagidaki AdvancedTable cagrisi).
  fileStatus: number | null
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('tr-TR').format(value)
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('tr-TR')
}

function isInspectionStage(stage: string) {
  return stage.toLocaleLowerCase('tr-TR').includes('ince')
}

// Kullanici istegi: ustteki asama ozet kutulari da (AdvancedTable'daki
// rozetlerle - bkz. components/shared/AdvancedTable.tsx getStageBadgeClass
// - AYNI renk kuraliyla) Ana Sayfa'daki "Tahkikat Personeline Göre Nakit
// Yardımlar" widget'i ile tutarli renklendirilsin.
function getStageGroupStyle(stage: string) {
  const normalized = stage.trim().toLocaleLowerCase('tr-TR')
  if (normalized === 'uygundur') {
    return { card: 'border-emerald-300 bg-emerald-50', label: 'text-emerald-700', value: 'text-emerald-900' }
  }
  if (normalized === 'uygun değil' || normalized === 'uygun degil') {
    return { card: 'border-rose-300 bg-rose-50', label: 'text-rose-700', value: 'text-rose-900' }
  }
  if (normalized.includes('otomatik red')) {
    return { card: 'border-slate-600 bg-slate-800', label: 'text-slate-300', value: 'text-white' }
  }
  if (normalized.includes('ince')) {
    return { card: 'border-amber-300 bg-amber-50', label: 'text-amber-700', value: 'text-amber-900' }
  }
  return { card: 'border-slate-200 bg-white', label: 'text-[#005f95]', value: 'text-slate-950' }
}

function InvestigationStaffReportsContent() {
  const searchParams = useSearchParams()
  const { addTab } = useTabs()
  const staff = searchParams.get('staff') || 'Belirtilmedi'
  const [records, setRecords] = useState<StaffReportRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  // Kullanici istegi: ustteki asama ozet kutularindan hangisine tiklanirsa
  // alttaki liste SADECE o asamaya gore filtrelensin - tekrar tiklamak
  // filtreyi kaldirir (hepsini gosterir).
  const [selectedStage, setSelectedStage] = useState<string | null>(null)
  const groupedRecords = useMemo(() => {
    const recordsByStage = new Map<string, StaffReportRecord[]>()

    records.forEach((record) => {
      const stage = record.stage?.trim() || 'Belirtilmedi'
      const stageRecords = recordsByStage.get(stage) ?? []
      stageRecords.push(record)
      recordsByStage.set(stage, stageRecords)
    })

    return Array.from(recordsByStage.entries())
      .map(([stage, stageRecords]) => ({
        stage,
        records: [...stageRecords].sort((firstRecord, secondRecord) => (
          firstRecord.applicant.localeCompare(secondRecord.applicant, 'tr-TR', { sensitivity: 'base' })
        )),
      }))
      .sort((firstGroup, secondGroup) => {
        const firstIsInspection = isInspectionStage(firstGroup.stage)
        const secondIsInspection = isInspectionStage(secondGroup.stage)

        if (firstIsInspection !== secondIsInspection) {
          return firstIsInspection ? -1 : 1
        }

        return firstGroup.stage.localeCompare(secondGroup.stage, 'tr-TR', { sensitivity: 'base' })
      })
  }, [records])
  const displayedRecords = useMemo(() => {
    const allRecords = groupedRecords.flatMap((group) => group.records)
    if (!selectedStage) return allRecords
    return allRecords.filter((record) => (record.stage?.trim() || 'Belirtilmedi') === selectedStage)
  }, [groupedRecords, selectedStage])
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
    setSelectedStage(null)

    async function loadRecords() {
      try {
        const query = new URLSearchParams({ staff })
        const response = await fetch(`/api/dashboard/investigation-staff-reports?${query.toString()}`)
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Tahkikat personel listesi alinamadi.')
        }

        if (!isCancelled) {
          setRecords(payload.data.records)
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Tahkikat personel listesi yuklenirken hata olustu.')
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
  }, [staff])

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-md border border-[#9bd36f] bg-gradient-to-r from-[#0076b6] to-[#6fb744] px-5 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[15px] font-black uppercase tracking-wide text-white/90">Tahkikat Personel Raporu</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">{staff}</h1>
            <p className="mt-1 text-sm font-bold text-white/85">Sadece durumu 0 olan ayni/nakdi yardim kayitlari</p>
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
          Bu personele ait durumu 0 olan kayit bulunamadi.
        </div>
      ) : (
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <h2 className="text-base font-extrabold text-[#005f95]">{staff}</h2>
            <span className="rounded-full bg-white px-3 py-1 text-[14px] font-extrabold text-slate-600">
              {formatNumber(records.length)} kayit
            </span>
          </div>
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* Kullanici istegi: bu kutular tiklanabilir birer filtre -
                hangisine tiklanirsa alttaki liste SADECE o asamaya gore
                filtrelenir (bkz. selectedStage); tekrar tiklamak filtreyi
                kaldirir. Renkler, AdvancedTable'daki rozetlerle (bkz.
                getStageBadgeClass) AYNI kurali kullanir. */}
            {groupedRecords.map((group) => {
              const style = getStageGroupStyle(group.stage)
              const isSelected = selectedStage === group.stage

              return (
                <button
                  type="button"
                  key={group.stage}
                  onClick={() => setSelectedStage((prev) => (prev === group.stage ? null : group.stage))}
                  className={`rounded-lg border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${style.card} ${
                    isSelected ? 'ring-2 ring-offset-2 ring-[#0076b6]' : ''
                  }`}
                >
                  <p className={`text-[12px] font-black uppercase tracking-wide ${style.label}`}>
                    {group.stage}
                  </p>
                  <p className={`mt-3 text-2xl font-black ${style.value}`}>{formatNumber(group.records.length)}</p>
                </button>
              )
            })}
          </div>
          <div className="p-4">
            <AdvancedTable
              data={displayedRecords as unknown as Record<string, unknown>[]}
              tableId="dashboard_investigation_staff_reports"
              excludedColumns={['id']}
              preferredColumnOrder={['fileNo', 'applicant', 'identityNumber', 'staff', 'applicationDate', 'amount', 'stage', 'status', 'fileStatus']}
              columnLabels={{ fileNo: 'Dosya No', applicant: 'Kişi', identityNumber: 'TC', staff: 'Personel', applicationDate: 'Müracaat Tarihi', amount: 'Miktar', stage: 'Aşama', status: 'Yardım Durumu', fileStatus: 'Dosya Durumu' }}
              onRowDoubleClick={(row) => openFile(String(row.fileNo || ''))}
              showRowNumber
              stageColumns={['stage']}
              fileStatusColumns={['fileStatus']}
            />
          </div>
          <div className="hidden overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-white text-[14px] font-extrabold uppercase text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2">Dosya No</th>
                  <th className="border-b border-slate-200 px-3 py-2">Kişi</th>
                  <th className="border-b border-slate-200 px-3 py-2">TC</th>
                  <th className="border-b border-slate-200 px-3 py-2">Müracaat Tarihi</th>
                  <th className="border-b border-slate-200 px-3 py-2">Miktar</th>
                  <th className="border-b border-slate-200 px-3 py-2">Asama</th>
                </tr>
              </thead>
              <tbody>
                {displayedRecords.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => openFile(item.fileNo)}
                    className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-sky-50"
                  >
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.fileNo}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-800">{item.applicant}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.identityNumber}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{formatDate(item.applicationDate)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.amount}</td>
                    <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.stage}</td>
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

export default function InvestigationStaffReportsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm font-bold text-slate-500">Liste yukleniyor...</div>}>
      <InvestigationStaffReportsContent />
    </Suspense>
  )
}
