'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { encodeSortParam, type SortSpec } from '@/lib/sortSpec'
import { BulkWhatsappSendButton } from '@/components/shared/BulkWhatsappSendButton'
import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import { downloadXlsx } from '@/lib/utils/xlsxExport'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { ColumnPickerReportModal, type ReportRow } from '@/components/shared/ColumnPickerReportModal'
import { usePredefinedStatusMaps } from '@/lib/hooks/usePredefinedStatusMaps'
import type { MessageTemplateTokenValues } from '@/lib/messageTemplateTokens'

export const dynamic = "force-dynamic"

type BeneficiaryRow = Record<string, string | number | null>

type PaginationState = {
  page: number
  limit: number
  hasNext: boolean
  total: number
}

const PAGE_SIZE = 50
// Basliklardaki "▼" acilir menusunun "Sütundaki Değerler" listesini
// sunucudan (TUM eslesen kayitlar uzerinden, sadece ekrandaki sayfadan
// degil) besleyen sutunlar - bkz. /api/beneficiary/filter-options.
const CHAINABLE_FILTER_COLUMNS = ['mahalle', 'ilce']
const BENEFICIARY_COLUMN_LABELS: Record<string, string> = {
  id: 'Kayıt ID',
  dosyaId: 'Dosya ID',
  dosyaNo: 'Dosya No',
  dosyaDurumu: 'Dosya Durumu',
  incelemePuani: 'İnceleme Puanı',
  tc: 'TC Kimlik No',
  adSoyad: 'Ad Soyad',
  adi: 'Adı',
  soyadi: 'Soyadı',
  telefon: 'Telefon',
  ilce: 'İlçe',
  mahalle: 'Mahalle',
  yakinligi: 'Yakınlığı',
  cinsiyet: 'Cinsiyet',
  babaAdi: 'Baba Adı',
  anaAdi: 'Ana Adı',
  dogumTarihi: 'Doğum Tarihi',
  olumTarihi: 'Ölüm Tarihi',
  medeniHali: 'Medeni Hali',
  adresNo: 'Adres No',
  adres: 'Adres',
  kayitTarihi: 'Kayıt Tarihi',
  guncellemeTarihi: 'Güncelleme Tarihi',
}

export default function BeneficiaryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { fileStatusMap, maritalStatusMap, relationshipMap } = usePredefinedStatusMaps()
  const [data, setData] = useState<BeneficiaryRow[]>([])
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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newTc, setNewTc] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>([{ key: 'id', direction: 'asc' }])
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

    return `/api/beneficiary?${params.toString()}`
  }, [page, search, sortParam, tableFilterSignature])

  const allFilteredUrl = useMemo(() => {
    const params = new URLSearchParams({ export: 'all', sort: sortParam })
    if (search.trim()) params.set('search', search.trim())
    new URLSearchParams(tableFilterSignature).forEach((value, key) => params.set(key, value))
    return `/api/beneficiary?${params.toString()}`
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
          const rows: BeneficiaryRow[] = Array.isArray(res.data) ? res.data : []
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

        setError(res.error || 'Bireyler listelenemedi.')
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Bireyler listelenemedi.')
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
  // sorgusundan besler (zincirlenmis/faceted filtre) - bkz. documents/all
  // sayfasindaki ayni deseni.
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ columns: CHAINABLE_FILTER_COLUMNS.join(',') })
    if (search.trim()) params.set('search', search.trim())
    new URLSearchParams(tableFilterSignature).forEach((value, key) => params.set(key, value))

    fetch(`/api/beneficiary/filter-options?${params.toString()}`, { signal: controller.signal })
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

  // Baska bir SAYFAdaki (2. sayfa vb.) secimler, o an data icinde GORUNMEDIGI
  // icin selectedRows'ta kaybolur - toplu WhatsApp gonderiminin TUM
  // sayfalardaki secimleri kapsamasi icin, her secilen kaydin telefon/isim
  // bilgisi ilk secildigi anda (o an data icinde varken) bu onbellege
  // kaydedilip sayfa degisse bile saklanir.
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
          const name = row.adSoyad ? String(row.adSoyad) : null
          const dosyano = row.dosyaNo ? String(row.dosyaNo) : null
          const dosyaid = row.dosyaId ? String(row.dosyaId) : null
          next[id] = {
            id,
            phone,
            label: name,
            // Bireyler listesi genel (yardim turunden bagimsiz) bir kisi
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

  const openBeneficiaryFile = (row: BeneficiaryRow) => {
    const fileId = row.dosyaId ? String(row.dosyaId) : ''
    const tc = row.tc ? String(row.tc) : ''

    if (fileId) {
      router.push(`/documents?fileId=${encodeURIComponent(fileId)}`)
      return
    }

    if (tc) {
      router.push(`/documents?search=${encodeURIComponent(tc)}`)
    }
  }

  const openSelectedBeneficiaryFile = () => {
    if (selectedRowIds.length !== 1 || selectedRows.length !== 1) return
    openBeneficiaryFile(selectedRows[0])
  }

  const refreshBeneficiaries = () => {
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
      alert(payload.error || 'Seçilen bireyler aktarılamadı.')
      return
    }
    const selectedSet = new Set(selectedRowIds)
    const rows = (payload.data as BeneficiaryRow[]).filter((row) => selectedSet.has(String(row.id)))
    downloadXlsx(rows, `secili-bireyler-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Bireyler')
  }

  const selectAllFilteredRows = async () => {
    setIsSelectingFiltered(true)
    try {
      const response = await fetch(allFilteredUrl)
      const payload = await response.json()
      if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Filtrelenen bireyler seçilemedi.')
      }
      setSelectedRowIds((payload.data as BeneficiaryRow[]).map((row) => String(row.id)).filter(Boolean))
    } catch (err) {
      setActionStatus(err instanceof Error ? err.message : 'Filtrelenen bireyler seçilemedi.')
    } finally {
      setIsSelectingFiltered(false)
    }
  }

  const exportAllRows = async () => {
    setExportStatus('loading')
    try {
      const response = await fetch('/api/beneficiary?export=all')
      const payload = await response.json()

      if (!payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Bireyler aktarilamadi.')
      }

      downloadXlsx(payload.data, `tum-bireyler-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Bireyler')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bireyler aktarilamadi.')
    } finally {
      setExportStatus('idle')
    }
  }

  const deleteSelectedRows = async () => {
    if (selectedRowIds.length === 0) return
    const ids = selectedRowIds

    if (ids.length === 0) {
      setActionStatus('Silinecek birey id bilgisi bulunamadı.')
      return
    }

    if (!(await confirmDialog(`${ids.length} birey silinecek. Devam edilsin mi?`))) return

    setIsDeleting(true)
    setActionStatus('')

    try {
      const response = await fetch('/api/beneficiary', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Bireyler silinemedi.')
      }

      setActionStatus(`${payload.data?.deleted || 0} birey silindi.`)
      setSelectedRowIds([])
      refreshBeneficiaries()
    } catch (err) {
      setActionStatus(err instanceof Error ? err.message : 'Bireyler silinemedi.')
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
    router.replace('/beneficiary')
  }

  const reportColumns = Object.entries(BENEFICIARY_COLUMN_LABELS).map(([key, label]) => ({ key, label }))
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
      return (payload.data as BeneficiaryRow[]).filter((row) => selectedSet.has(String(row.id))) as ReportRow[]
    }

    return payload.data as ReportRow[]
  }

  // AdvancedTable ekranda "dosyaDurumu/medeniHali/yakinligi" gibi kod
  // sutunlarini okunabilir etikete ceviriyor (bkz. fileStatusColumns/
  // maritalStatusColumns/relationshipColumns proplari) - rapor da AYNI
  // etiketleri gostermeli, ham kodu (0, 1, 2...) degil.
  const resolveReportCellValue = (columnKey: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return value
    if (columnKey === 'dosyaDurumu') return fileStatusMap[String(value)] ?? value
    if (columnKey === 'medeniHali') return maritalStatusMap[String(value)] ?? value
    if (columnKey === 'yakinligi') return relationshipMap[String(value)] ?? value
    return value
  }

  const handleAddBeneficiary = async () => {
    if (!/^\d{11}$/.test(newTc)) {
      alert('Lutfen 11 haneli gecerli bir TC Kimlik Numarasi girin.')
      return
    }

    try {
      const res = await fetch('/api/beneficiary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tc: newTc,
          name: `Mernis Dogrulamali Kayit (${newTc.slice(0, 3)}...)`,
          phone: 'Belirtilmedi',
          district: 'Merkez',
          familyType: 'Bilinmiyor',
        }),
      })

      if (!res.ok) {
        alert('Kayit eklenirken hata olustu veya bu TC zaten kayitli.')
        return
      }

      setIsModalOpen(false)
      setNewTc('')
      refreshBeneficiaries()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Birey eklenemedi.')
    }
  }

  return (
    <div className="space-y-6">
      <ReportPageHeader
        eyebrow="Birey Yönetimi"
        title="Tüm Bireyler"
        description={`${firstRecord}-${lastRecord} arası kayıtlar gösteriliyor.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={reportHeaderGhostButton} onClick={() => setIsModalOpen(true)}>
              Yeni Birey Ekle
            </button>
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
            placeholder="TC, ad soyad, dosya no, mahalle, ilçe, adres veya telefon ara"
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
            onClick={refreshBeneficiaries}
            disabled={loading}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[15px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? 'Yenileniyor...' : 'Yenile'}
          </button>
          <button
            type="button"
            onClick={openSelectedBeneficiaryFile}
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
            {exportStatus === 'loading' ? 'Aktarılıyor...' : 'Tüm Bireyleri XLSX Aktar'}
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
            key={tableFilterSignature || 'all-beneficiaries-table'}
            data={data}
            tableId="all-beneficiaries-table"
            emptyMessage="Listelenecek birey kaydı bulunamadı."
            onRowDoubleClick={openBeneficiaryFile}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
            getRowId={(row) => String(row.id)}
            // Kullanici istegi: olum tarihi olan birey SIYAH satirda gosterilir.
            rowClassName={(row) => {
              const death = String(row.olumTarihi ?? '').trim()
              return death && death !== '-' && death !== '0'
                ? 'bg-[#16232B] [&_td]:!border-slate-600 [&_td]:!text-white'
                : ''
            }}
            showRowNumber
            rowNumberStart={firstRecord || 1}
            preferredColumnOrder={['id', 'dosyaId', 'dosyaNo', 'dosyaDurumu', 'incelemePuani', 'tc', 'adSoyad', 'cinsiyet']}
            // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli
            // degil - kullanici HER sutunu (Telefon dahil) gosterip
            // gizleyebilir.
            columnLabels={BENEFICIARY_COLUMN_LABELS}
            fileStatusColumns={['dosyaDurumu']}
            fileStatusVariant="solid"
            columnReorderingControls
            maritalStatusColumns={['medeniHali']}
            relationshipColumns={['yakinligi']}
            genderColumns={['cinsiyet']}
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

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-extrabold text-[#005f95]">Sisteme Birey Ekle</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-md px-2 py-1 text-xl font-black text-slate-400 hover:bg-rose-50 hover:text-rose-500"
              >
                x
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1.5 block text-[15px] font-extrabold text-slate-700">TC Kimlik No</label>
                <input
                  value={newTc}
                  onChange={(event) => setNewTc(event.target.value.replace(/\D/g, '').slice(0, 11))}
                  type="text"
                  maxLength={11}
                  className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-[#0076b6] focus:ring-1 focus:ring-[#0076b6]"
                  placeholder="11 haneli TC Kimlik no..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 rounded-b-lg border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-md px-4 py-2 text-[13px] font-extrabold text-slate-600 hover:bg-slate-200"
              >
                Iptal
              </button>
              <button
                type="button"
                onClick={handleAddBeneficiary}
                className="rounded-md bg-[#0076b6] px-5 py-2 text-[13px] font-extrabold text-white shadow-sm hover:bg-[#005f95]"
              >
                Sorgula ve Kaydet
              </button>
            </div>
          </div>
        </div>
      )}

      <ColumnPickerReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="Bireyler Raporu"
        reportHeading="Bireyler Raporu"
        columns={reportColumns}
        scopes={reportScopes}
        fetchRows={fetchReportRows}
        resolveCellValue={resolveReportCellValue}
        fileNamePrefix="bireyler-raporu"
      />
    </div>
  )
}
