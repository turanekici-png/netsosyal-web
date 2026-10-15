'use client'

import { useEffect, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { AdvancedTable } from '@/components/shared/AdvancedTable'

export const dynamic = 'force-dynamic'

interface UserPerformanceRow {
  userName: string
  daily: number
  weekly: number
  monthly: number
  lastActivity: string | null
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('tr-TR').format(value)
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function UserPerformancePage() {
  const [users, setUsers] = useState<UserPerformanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const { addTab } = useTabs()

  useEffect(() => {
    let isCancelled = false

    async function loadUsers() {
      try {
        const response = await fetch('/api/dashboard/user-performance', { cache: 'no-store' })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Kullanici performans listesi alinamadi.')
        }

        if (!isCancelled) {
          setUsers(payload.data?.users ?? [])
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Kullanici performans listesi yuklenirken hata olustu.')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadUsers()

    return () => {
      isCancelled = true
    }
  }, [])

  const sortedUsers = [...users].sort((a, b) => (
    b.daily - a.daily || b.monthly - a.monthly || a.userName.localeCompare(b.userName, 'tr-TR')
  ))
  const activeToday = sortedUsers.filter((item) => item.daily > 0).length
  const totalToday = sortedUsers.reduce((sum, item) => sum + item.daily, 0)

  const openUserDetail = (userName: string) => {
    if (!userName) return
    const query = new URLSearchParams({ user: userName, period: 'daily' })

    addTab({ title: `${userName} Performans`, path: `/settings/personnel-performance-report?${query.toString()}` })
  }

  const tableRows = sortedUsers.map((item, index) => ({
    sira: index + 1,
    userName: item.userName,
    daily: item.daily,
    weekly: item.weekly,
    monthly: item.monthly,
    lastActivity: formatDateTime(item.lastActivity),
  }))

  return (
    <div className="ns-kurumsal-pencere space-y-5 text-slate-950">
      <div className="rounded-xl border border-[#2A3B4D] bg-[#1E2A38] px-5 py-4 text-white shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.08)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#D4B26A]">Personel Performansı</p>
            <h1 className="mt-1 text-[20px] font-semibold uppercase leading-tight tracking-wide md:text-[26px]">Kullanıcı Genel İşlem Performansı</h1>
            <p className="mt-1 text-[13.5px] font-medium text-slate-300">Sistem hareket ve denetim kayıtlarına göre bu ayki kullanıcı bazlı işlem sayıları</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-[14px] font-bold">
              Bugün İşlem Yapan: {isLoading ? '...' : formatNumber(activeToday)}
            </div>
            <div className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-[14px] font-bold">
              Bugünkü Toplam: {isLoading ? '...' : formatNumber(totalToday)}
            </div>
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
          Liste yükleniyor...
        </div>
      ) : sortedUsers.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
          Bu ay için işlem kaydı bulunamadı.
        </div>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <AdvancedTable
            corporate
            data={tableRows as unknown as Record<string, unknown>[]}
            tableId="dashboard_user_performance"
            excludedColumns={['sira']}
            preferredColumnOrder={['userName', 'daily', 'weekly', 'monthly', 'lastActivity']}
            columnLabels={{
              userName: 'Kullanıcı',
              daily: 'Bugün',
              weekly: 'Bu Hafta',
              monthly: 'Bu Ay',
              lastActivity: 'Son İşlem',
            }}
            onRowDoubleClick={(row) => openUserDetail(String(row.userName || ''))}
            showRowNumber
          />
        </div>
      )}
    </div>
  )
}
