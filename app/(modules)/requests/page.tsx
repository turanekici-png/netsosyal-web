'use client'

import { useEffect, useState } from 'react'
import { ManagedReportTablePage } from '@/components/shared/ManagedReportTablePage'

export default function RequestsPage() {
  const [requests, setRequests] = useState<Record<string, unknown>[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/requests?limit=50')
      const payload = await response.json()
      if (payload.success && Array.isArray(payload.data)) {
        setRequests(payload.data)
        setErrorMessage(null)
      } else if (payload.error) {
        setErrorMessage(payload.error)
      }
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Müracaatlar listelenemedi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">
        Müracaatlar yükleniyor...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}

      <ManagedReportTablePage
        eyebrow="Müracaat Yönetimi"
        title="Müracaatlar Listesi"
        routePath="/requests"
        data={errorMessage ? [] : requests}
        tableId="requests-main-table"
        totalCount={requests.length}
        currentPage={1}
        pageSize={50}
        searchPlaceholder="Talep no, dosya no, adres veya açıklama ara"
        emptyMessage="Görüntülenecek müracaat kaydı bulunamadı."
        newButtonLabel="Yeni Müracaat Ekle"
        exportFilePrefix="muracaatlar"
        excludedColumns={['beneficiaries']}
        onRefresh={() => void loadData()}
      />
    </div>
  )
}
