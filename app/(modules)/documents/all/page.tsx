'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { encodeSortParam, type SortSpec } from '@/lib/sortSpec'
import { BulkWhatsappSendButton } from '@/components/shared/BulkWhatsappSendButton'
import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { downloadXlsx } from '@/lib/utils/xlsxExport'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  DestructiveAuthorizationDialog,
  type DestructiveAuthorizationDialogHandle,
} from '@/components/security/DestructiveAuthorizationDialog'
import { ColumnPickerReportModal, type ReportRow } from '@/components/shared/ColumnPickerReportModal'
import { usePredefinedStatusMaps } from '@/lib/hooks/usePredefinedStatusMaps'
import type { MessageTemplateTokenValues } from '@/lib/messageTemplateTokens'

type DocumentRow = Record<string, string | number | null>

type PaginationState = {
  page: number
  limit: number
  hasNext: boolean
  total: number
}

const PAGE_SIZE = 50
// Basliklardaki "▼" acilir menusunun "Sütundaki Değerler" listesini
// sunucudan (TUM eslesen kayitlar uzerinden, sadece ekrandaki sayfadan
// degil) besleyen sutunlar - bkz. /api/documents/filter-options.
const CHAINABLE_FILTER_COLUMNS = ['mahalle', 'cadde', 'sokak', 'binaNo']
const DOCUMENT_COLUMN_LABELS: Record<string, string> = {
  dosyaId: 'Dosya ID',
  dosyaNo: 'Dosya No',
  incelemePuani: 'İnceleme Puanı',
  dosyaSahibi: 'Dosya Sahibi',
  durum: 'Dosya Durumu',
  kartNo: 'Kart No',
  muracaatTarihi: 'Müracaat Tarihi',
  telefon: 'Telefon',
  ceptel: 'Cep Telefonu',
  mahalle: 'Mahalle',
  cadde: 'Cadde',
  sokak: 'Sokak',
  binaNo: 'Bina No',
  daireNo: 'Daire No',
  adresNo: 'Adres No',
  adres: 'Adres',
  toplamBirey: 'Toplam Birey',
  aciklama: 'Açıklama',
  olusturmaTarihi: 'Oluşturma Tarihi',
  guncellemeTarihi: 'Güncelleme Tarihi',
}

export default function AllDocumentsPage() {
  const destructiveAuthorizationRef = useRef<DestructiveAuthorizationDialogHandle>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { fileStatusMap } = usePredefinedStatusMaps()
  const [data, setData] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
  const [bulkRecipientCache, setBulkRecipientCache] = useState<Record<string, { id: string; phone: string | null; label: string | null; tokens: MessageTemplateTokenValues; dosyaNo: string | null; dosyaId: string | null }>>({})
  const [exportStatus, setExportStatus] = useState<'idle' | 'loading'>('idle')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSelectingFiltered, setIsSelectingFiltered] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>([{ key: 'dosyaNo', direction: 'asc' }])
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)
  const [remoteFilterOptions, setRemoteFilterOptions] = useState<Record<string, { value: string; label: string; count: number }[]>>({})
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: PAGE_SIZE,
    hasNext: false,
    total: 0,
  })

  const tableFilterSignature = useMemo(() => {
    const params = new URLSearchParams()
    searchParams.forEach((value, key) => {
      if (key.startsWith('f_')) {
        params.append(key, value)
      }
    })
    return params.toString()
  }, [searchParams])

  const sortParam = useMemo(() => encodeSortParam(sortSpecs), [sortSpecs])

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort: sortParam,
    })

    if (search.trim()) {
      params.set('search', search.trim())
    }

    new URLSearchParams(tableFilterSignature).forEach((value, key) => {
      params.set(key, value)
    })

    return `/api/documents?${params.toString()}`
  }, [page, search, sortParam, tableFilterSignature])

  const allFilteredUrl = useMemo(() => {
    const params = new URLSearchParams({ export: 'all', sort: sortParam })
    if (search.trim()) params.set('search', search.trim())
    new URLSearchParams(tableFilterSignature).forEach((value, key) => params.set(key, value))
    return `/api/documents?${params.toString()}`
  }, [search, sortParam, tableFilterSignature])

  useEffect(() => {
    setPage(1)
    setSelectedRowIds([])
  }, [tableFilterSignature])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    fetch(requestUrl, { signal: controller.signal })
      .then((res) => res.json())
      .then((res) => {
        if (res.success) {
          const rows: DocumentRow[] = Array.isArray(res.data) ? res.data : []
          const nextPage = Number(res.pagination?.page || page)
          const nextLimit = Number(res.pagination?.limit || PAGE_SIZE)
          const hasNext = Boolean(res.pagination?.hasNext)

          setData(rows)
          setPagination({
            page: nextPage,
            limit: nextLimit,
            hasNext,
            total: Number(res.pagination?.total || 0),
          })
          setTotalCount(Number(res.pagination?.total || 0))
          setError(null)
          return
        }

        setError(res.error || 'Dosyalar listelenemedi.')
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Dosyalar listelenemedi.')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [requestUrl, page, refreshKey])

  // Basliklardaki "▼" acilir menusunun deger listesini, o an ekrandaki
  // sayfadan degil, DIGER tum aktif filtrelere gore daralan sunucu
  // sorgusundan besler - "Dosya Durumu = Yeni Müracaat" secilince Mahalle
  // listesi de otomatik olarak sadece o durumdaki dosyalarin mahallelerini
  // gostersin diye (zincirlenmis/faceted filtre).
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ columns: CHAINABLE_FILTER_COLUMNS.join(',') })
    if (search.trim()) params.set('search', search.trim())
    new URLSearchParams(tableFilterSignature).forEach((value, key) => params.set(key, value))

    fetch(`/api/documents/filter-options?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((res) => {
        if (res.success && res.data) setRemoteFilterOptions(res.data)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
      })

    return () => controller.abort()
  }, [search, tableFilterSignature])

  const firstRecord = data.length === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1
  const canGoPrevious = pagination.page > 1 && !loading
  const canGoNext = pagination.hasNext && !loading
  const selectedRows = data.filter((row) => row.id && selectedRowIds.includes(String(row.id)))

  // Baska bir SAYFAdaki secimler, o an data icinde GORUNMEDIGI icin
  // selectedRows'ta kaybolur - toplu WhatsApp gonderiminin TUM sayfalardaki
  // secimleri kapsamasi icin, her secilen kaydin telefon/isim bilgisi ilk
  // secildigi anda (o an data icinde varken) bu onbellege kaydedilip sayfa
  // degisse bile saklanir.
  useEffect(() => {
    setBulkRecipientCache((prev) => {
      const next: Record<string, { id: string; phone: string | null; label: string | null; tokens: MessageTemplateTokenValues; dosyaNo: string | null; dosyaId: string | null }> = {}
      selectedRowIds.forEach((id) => {
        if (prev[id]) {
          next[id] = prev[id]
          return
        }
        const row = data.find((candidate) => candidate.id && String(candidate.id) === id)
        if (row) {
          const phone = row.telefon ? String(row.telefon) : null
          const name = row.dosyaSahibi ? String(row.dosyaSahibi) : null
          const dosyano = row.dosyaNo ? String(row.dosyaNo) : null
          const dosyaid = row.dosyaId ? String(row.dosyaId) : (row.id ? String(row.id) : null)
          next[id] = {
            id,
            phone,
            label: name,
            // Dosyalar listesi genel (yardim turunden bagimsiz) bir dosya
            // listesi oldugu icin isim/telefon/dosyano kisayollari anlamli -
            // iban/tarih kisayollari burada "-" olarak gonderilir (bkz.
            // lib/messageTemplateTokens.ts).
            tokens: { isim: name, telefon: phone, dosyano },
            // Kullanici istegi: buradan gonderilen mesajlar da o dosyanin
            // Dosya Yonetimi > "Mesaj Raporlari" ekraninda gorunsun.
            dosyaNo: dosyano,
            dosyaId: dosyaid,
          }
        }
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowIds, data])

  const bulkWhatsappRecipients = selectedRowIds
    .map((id) => bulkRecipientCache[id])
    .filter((entry): entry is { id: string; phone: string | null; label: string | null; tokens: MessageTemplateTokenValues; dosyaNo: string | null; dosyaId: string | null } => Boolean(entry))

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setSelectedRowIds([])
    setSearch(searchInput)
  }

  const openDocument = (row: DocumentRow) => {
    const fileId = row.id ? String(row.id) : ''
    if (!fileId) return
    router.push(`/documents?fileId=${encodeURIComponent(fileId)}`)
  }

  const openSelectedDocument = () => {
    if (selectedRowIds.length !== 1 || selectedRows.length !== 1) return
    openDocument(selectedRows[0])
  }

  const refreshDocuments = () => {
    setRefreshKey((current) => current + 1)
  }

  const changeSort = (specs: SortSpec[]) => {
    setSortSpecs(specs)
    setPage(1)
    setSelectedRowIds([])
  }

  const exportSelectedRows = async () => {
    if (selectedRowIds.length === 0) return
    const response = await fetch(allFilteredUrl)
    const payload = await response.json()
    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      alert(payload.error || 'Seçilen dosyalar aktarılamadı.')
      return
    }
    const selectedSet = new Set(selectedRowIds)
    const exportRows = (payload.data as DocumentRow[])
      .filter((row) => selectedSet.has(String(row.id)))
      .map(({ id, ...row }) => row)
    downloadXlsx(exportRows, `secili-dosyalar-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Dosyalar')
  }

  const selectAllFilteredRows = async () => {
    setIsSelectingFiltered(true)
    try {
      const response = await fetch(allFilteredUrl)
      const payload = await response.json()
      if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Filtrelenen dosyalar seçilemedi.')
      }
      setSelectedRowIds((payload.data as DocumentRow[]).map((row) => String(row.id)).filter(Boolean))
    } catch (err) {
      setActionStatus(err instanceof Error ? err.message : 'Filtrelenen dosyalar seçilemedi.')
    } finally {
      setIsSelectingFiltered(false)
    }
  }

  const exportAllRows = async () => {
    setExportStatus('loading')
    try {
      const response = await fetch('/api/documents?export=all')
      const payload = await response.json()

      if (!payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Dosyalar aktarilamadi.')
      }

      const exportRows = payload.data.map(({ id, ...row }: DocumentRow) => row)
      downloadXlsx(exportRows, `tum-dosyalar-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Dosyalar')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Dosyalar aktarilamadi.')
    } finally {
      setExportStatus('idle')
    }
  }

  const deleteSelectedRows = async () => {
    if (selectedRowIds.length === 0) return
    const ids = selectedRowIds

    if (ids.length === 0) {
      setActionStatus('Silinecek dosya id bilgisi bulunamadı.')
      return
    }

    if (!(await confirmDialog(`${ids.length} dosya silinecek. Devam edilsin mi?`))) return

    const destructiveToken = await destructiveAuthorizationRef.current?.authorize(
      `${ids.length} Dosya İçin Silme Onayı`,
    )
    if (!destructiveToken) return

    setIsDeleting(true)
    setActionStatus('')

    try {
      const response = await fetch('/api/documents', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-destructive-authorization': destructiveToken,
        },
        body: JSON.stringify({ ids }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Dosyalar silinemedi.')
      }

      setActionStatus(`${payload.data?.deleted || 0} dosya silindi.`)
      setSelectedRowIds([])
      refreshDocuments()
    } catch (err) {
      setActionStatus(err instanceof Error ? err.message : 'Dosyalar silinemedi.')
    } finally {
      setIsDeleting(false)
    }
  }

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setSelectedRowIds([])
    setActionStatus('')
    setPage(1)
    router.replace('/documents/all')
  }

  const reportColumns = Object.entries(DOCUMENT_COLUMN_LABELS).map(([key, label]) => ({ key, label }))
  const reportScopes = [
    { value: 'all', label: 'Filtrelenen tüm kayıtlar', count: totalCount },
    { value: 'page', label: 'Bu sayfadaki sonuçlar', count: data.length },
    { value: 'selected', label: 'Seçili kayıtlar', count: selectedRowIds.length },
  ]

  const fetchReportRows = async (scope: string): Promise<ReportRow[]> => {
    if (scope === 'page') return data as ReportRow[]

    const response = await fetch(allFilteredUrl)
    const payload = await response.json()
    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      throw new Error(payload.error || 'Kayıtlar alınamadı.')
    }

    if (scope === 'selected') {
      const selectedSet = new Set(selectedRowIds)
      return (payload.data as DocumentRow[]).filter((row) => selectedSet.has(String(row.id))) as ReportRow[]
    }

    return payload.data as ReportRow[]
  }

  // AdvancedTable ekranda "durum" kodunu (0,1,2...) okunabilir etikete
  // ceviriyor (fileStatusColumns={['durum']}) - rapor da ayni etiketi
  // gostermeli, ham kodu degil.
  const resolveReportCellValue = (columnKey: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return value
    if (columnKey === 'durum') return fileStatusMap[String(value)] ?? value
    return value
  }

  return (
    <div className="dy-dosyalar space-y-6">
      <DestructiveAuthorizationDialog ref={destructiveAuthorizationRef} />
      <ReportPageHeader
        className="dy-page-hero"
        eyebrow="Dosya Yönetimi"
        title="Tüm Dosyalar"
        description={`${firstRecord}-${lastRecord} arası kayıtlar gösteriliyor.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={reportHeaderGhostButton} onClick={() => setIsReportModalOpen(true)}>
              Rapor Oluştur
            </button>
            <button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>
              Yazdır (Ctrl+P)
            </button>
          </div>
        }
      />

      {actionStatus && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${
          actionStatus.includes('silindi')
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {actionStatus}
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-emerald-50/60 p-4 shadow-[0_14px_35px_rgba(0,118,182,0.10)] print:hidden">
        <form onSubmit={handleSearch} className="flex w-full gap-2">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Dosya no, dosyadaki herhangi bir bireyin adı/TC'si, kart no, telefon, mahalle, cadde/sokak, adres veya açıklama ara"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 placeholder:text-slate-400 shadow-sm outline-none focus:border-[#0076b6]"
          />
          <button
            type="submit"
            className="rounded-md bg-[#0076b6] px-4 py-2 text-[15px] font-extrabold text-white hover:bg-[#00649b]"
          >
            Ara
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setSearch('')
                setPage(1)
              }}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[15px] font-extrabold text-slate-600 hover:bg-slate-50"
            >
              Temizle
            </button>
          )}
        </form>

        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 [&>button]:min-h-11 [&>button]:rounded-xl [&>button]:shadow-sm [&>span]:flex [&>span]:min-h-11 [&>span]:items-center [&>span]:justify-center [&>span]:rounded-xl">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-black text-slate-600">
            Seçili: {selectedRowIds.length} / Filtre Sonucu: {totalCount}
          </span>
          <button
            type="button"
            onClick={() => void selectAllFilteredRows()}
            disabled={totalCount === 0 || isSelectingFiltered}
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-[15px] font-black text-violet-700 hover:bg-violet-100 disabled:pointer-events-none disabled:opacity-50"
          >
            {isSelectingFiltered ? 'Seçiliyor...' : `Filtrelenenlerin Tümünü Seç (${totalCount})`}
          </button>
          {selectedRowIds.length > 0 && (
            <button type="button" onClick={() => setSelectedRowIds([])} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50">
              Seçimi Kaldır
            </button>
          )}
          <button
            type="button"
            onClick={refreshDocuments}
            disabled={loading}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? 'Yenileniyor...' : 'Yenile'}
          </button>
          <button
            type="button"
            onClick={openSelectedDocument}
            disabled={selectedRowIds.length !== 1 || selectedRows.length !== 1}
            className="rounded-md border border-[#0076b6] bg-white px-3 py-2 text-[15px] font-black text-[#0076b6] hover:bg-[#eaf7fd] disabled:pointer-events-none disabled:opacity-50"
          >
            Seçili Dosyayı Aç
          </button>
          <button
            type="button"
            onClick={exportSelectedRows}
            disabled={selectedRowIds.length === 0}
            className="rounded-md bg-[#3f7f28] px-3 py-2 text-[15px] font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50"
          >
            Seçilenleri XLSX Aktar
          </button>
          <BulkWhatsappSendButton
            recipients={bulkWhatsappRecipients}
            className="rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-[15px] font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={deleteSelectedRows}
            disabled={selectedRowIds.length === 0 || isDeleting}
            className="rounded-md bg-rose-600 px-3 py-2 text-[15px] font-black text-white hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50"
          >
            {isDeleting ? 'Siliniyor...' : 'Sil'}
          </button>
          <button
            type="button"
            onClick={exportAllRows}
            disabled={exportStatus === 'loading'}
            className="rounded-md bg-amber-500 px-3 py-2 text-[15px] font-black text-white hover:bg-amber-600 disabled:pointer-events-none disabled:opacity-60"
          >
            {exportStatus === 'loading' ? 'Aktarılıyor...' : 'Tüm Dosyaları XLSX Aktar'}
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50"
          >
            Filtreleri Temizle
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-white p-4 shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : (
          // Kullanici istegi: kayit olmasa (filtre sonucu bos donse) bile
          // sutun basliklari - ve icindeki filtre/siralama kontrolleri -
          // KAYBOLMASIN diye tablo ARTIK HER ZAMAN render edilir.
          <AdvancedTable
            key={tableFilterSignature || 'all-documents-table'}
            data={data}
            tableId="all-documents-table"
            emptyMessage="Listelenecek dosya kaydı bulunamadı."
            excludedColumns={['id']}
            onRowDoubleClick={openDocument}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
            getRowId={(row) => String(row.id)}
            showRowNumber
            rowNumberStart={firstRecord || 1}
            preferredColumnOrder={['dosyaId', 'dosyaNo', 'durum', 'incelemePuani', 'dosyaSahibi']}
            // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli
            // degil - kullanici HER sutunu (Cep Telefonu dahil) gosterip
            // gizleyebilir.
            columnLabels={DOCUMENT_COLUMN_LABELS}
            fileStatusColumns={['durum']}
            fileStatusVariant="solid"
            columnReorderingControls
            serverSideFiltering
            serverSideSorting
            filterValueOptions={remoteFilterOptions}
            sortSpecs={sortSpecs}
            onSortChange={changeSort}
          />
        )}

        {!error && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <div className="text-xs font-bold text-slate-500">
              Sayfa {pagination.page} (Toplam {totalCount} kayıt)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={!canGoPrevious}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Onceki
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!canGoNext}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[15px] font-extrabold transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Sonraki
              </button>
            </div>
          </div>
        )}
      </div>

      <ColumnPickerReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="Dosyalar Raporu"
        reportHeading="Dosyalar Raporu"
        columns={reportColumns}
        scopes={reportScopes}
        fetchRows={fetchReportRows}
        resolveCellValue={resolveReportCellValue}
        fileNamePrefix="dosyalar-raporu"
      />
    </div>
  )
}
