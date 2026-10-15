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
import {
  CorporatePagination,
  ToolbarDivider,
  ToolbarIcon,
  corporateSearchInput,
  corporateTableCard,
  corporateToolbarCard,
  formatCount,
  toolbarButton,
  toolbarDangerButton,
  toolbarPrimaryButton,
} from '@/components/shared/corporateToolbar'

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
const CHAINABLE_FILTER_COLUMNS = [
  'mahalle', 'ilce', 'nufusIli', 'uyruk', 'meslek', 'ogrenimDurumu', 'saglikDurumu', 'hastalikAdi',
  'sosyalGuvence', 'kayitTipi', 'tcSorgu', 'kaydiAcan', 'sonIslemYapan',
]

// 2026-10-15 kullanici istegi: Dosyalar'da oldugu gibi bireyler tablosunun
// TUM alanlari listede; Sütun Görünürlüğü'nden ac/kapat (bkz. documents/all).
type BeneficiaryColumnDef = { label: string; group: string; hidden?: boolean }
const BENEFICIARY_COLUMNS: Record<string, BeneficiaryColumnDef> = {
  id: { label: 'Kayıt ID', group: 'Dosya' },
  dosyaId: { label: 'Dosya ID', group: 'Dosya' },
  dosyaNo: { label: 'Dosya No', group: 'Dosya' },
  dosyaDurumu: { label: 'Dosya Durumu', group: 'Dosya' },
  incelemePuani: { label: 'İnceleme Puanı', group: 'Dosya' },
  kayitTipi: { label: 'Kayıt Tipi', group: 'Dosya', hidden: true },
  tc: { label: 'TC Kimlik No', group: 'Kimlik' },
  adSoyad: { label: 'Ad Soyad', group: 'Kimlik' },
  cinsiyet: { label: 'Cinsiyet', group: 'Kimlik' },
  adi: { label: 'Adı', group: 'Kimlik' },
  soyadi: { label: 'Soyadı', group: 'Kimlik' },
  kayitliAdSoyad: { label: 'Kayıtlı Ad Soyad', group: 'Kimlik', hidden: true },
  yakinligi: { label: 'Yakınlığı', group: 'Kimlik' },
  babaAdi: { label: 'Baba Adı', group: 'Kimlik' },
  anaAdi: { label: 'Ana Adı', group: 'Kimlik' },
  dogumTarihi: { label: 'Doğum Tarihi', group: 'Kimlik' },
  dogumYeri: { label: 'Doğum Yeri', group: 'Kimlik', hidden: true },
  olumTarihi: { label: 'Ölüm Tarihi', group: 'Kimlik' },
  medeniHali: { label: 'Medeni Hali', group: 'Kimlik' },
  uyruk: { label: 'Uyruğu', group: 'Kimlik', hidden: true },
  telefon: { label: 'Telefon', group: 'İletişim ve Adres' },
  nufusIli: { label: 'Nüfus İli', group: 'İletişim ve Adres', hidden: true },
  ilce: { label: 'İlçe', group: 'İletişim ve Adres' },
  mahalle: { label: 'Mahalle', group: 'İletişim ve Adres' },
  adresNo: { label: 'Adres No', group: 'İletişim ve Adres' },
  adres: { label: 'Adres', group: 'İletişim ve Adres' },
  adresGuncellemeTarihi: { label: 'Adres Güncelleme Tarihi', group: 'İletişim ve Adres', hidden: true },
  meslek: { label: 'Mesleği', group: 'Sosyal Durum', hidden: true },
  ogrenimDurumu: { label: 'Öğrenim Durumu', group: 'Sosyal Durum', hidden: true },
  mezunOkul: { label: 'Mezun Olduğu Okul', group: 'Sosyal Durum', hidden: true },
  saglikDurumu: { label: 'Sağlık Durumu', group: 'Sosyal Durum', hidden: true },
  hastalikAdi: { label: 'Hastalık Adı', group: 'Sosyal Durum', hidden: true },
  sosyalGuvence: { label: 'Sosyal Güvencesi', group: 'Sosyal Durum', hidden: true },
  aylikGelir: { label: 'Aylık Geliri', group: 'Sosyal Durum', hidden: true },
  iban: { label: 'IBAN', group: 'Sosyal Durum', hidden: true },
  aciklama: { label: 'Açıklama', group: 'Açıklama ve Kontrol', hidden: true },
  tcSorgu: { label: 'TC Sorgu Durumu', group: 'Açıklama ve Kontrol', hidden: true },
  kontrol1: { label: 'Kontrol 1', group: 'Açıklama ve Kontrol', hidden: true },
  kontrol2: { label: 'Kontrol 2', group: 'Açıklama ve Kontrol', hidden: true },
  kaydiAcan: { label: 'Kaydı Açan', group: 'Kayıt Bilgisi', hidden: true },
  sonIslemYapan: { label: 'Son İşlem Yapan', group: 'Kayıt Bilgisi', hidden: true },
  kayitTarihi: { label: 'Kayıt Tarihi', group: 'Kayıt Bilgisi' },
  guncellemeTarihi: { label: 'Güncelleme Tarihi', group: 'Kayıt Bilgisi' },
}
const BENEFICIARY_COLUMN_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(BENEFICIARY_COLUMNS).map(([key, def]) => [key, def.label]),
)
const BENEFICIARY_COLUMN_GROUPS: Record<string, string> = Object.fromEntries(
  Object.entries(BENEFICIARY_COLUMNS).map(([key, def]) => [key, def.group]),
)
const BENEFICIARY_DEFAULT_HIDDEN_COLUMNS = Object.entries(BENEFICIARY_COLUMNS)
  .filter(([, def]) => def.hidden)
  .map(([key]) => key)
const BENEFICIARY_COLUMN_ORDER = Object.keys(BENEFICIARY_COLUMNS)

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
  const totalPages = Math.max(1, Math.ceil(totalCount / (pagination.limit || PAGE_SIZE)))
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
    <div className="dy-dosyalar dy-tum-bireyler space-y-4">
      {/* 2026-10-15: Tüm Dosyalar ile ayni lacivert/altin kurumsal dil. */}
      <ReportPageHeader
        eyebrow="Birey Yönetimi"
        kicker="Dosya Yönetimi › Tüm Bireyler"
        title="Tüm Bireyler"
        subtitle={
          <>
            {formatCount(totalCount)} birey
            {data.length > 0 && <> · {formatCount(firstRecord)}–{formatCount(lastRecord)} arası gösteriliyor</>}
            {selectedRowIds.length > 0 && <> · <span className="font-bold text-[#E9D9A8]">{formatCount(selectedRowIds.length)} seçili</span></>}
          </>
        }
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

      {/* 2026-10-15: arac cubugu islev gruplarina ayrildi (Seçim · Dosya ·
          Dışa Aktar · Temizle/Sil) - islevler/onaylar AYNEN korunur. */}
      <div className={corporateToolbarCard}>
        <form onSubmit={handleSearch} className="flex w-full flex-wrap gap-2 sm:flex-nowrap">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <ToolbarIcon name="search" />
            </span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="TC, ad soyad, dosya no, mahalle, ilçe, adres veya telefon ara"
              className={corporateSearchInput}
            />
          </div>
          <button type="submit" className={`${toolbarPrimaryButton} min-h-11 px-5`}>
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
              className={`${toolbarButton} min-h-11`}
            >
              <ToolbarIcon name="x" />
              Aramayı Temizle
            </button>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-10 md:min-h-11 items-center gap-2 rounded-lg border border-[#E7DDC2] bg-[#FBF8F0] px-3 md:px-3.5 py-2 text-[14.5px] md:text-[17px] font-semibold text-slate-600">
              Seçili
              <strong className="text-[15.5px] md:text-[18px] font-black text-[#1E2A38]">{formatCount(selectedRowIds.length)}</strong>
              <span className="text-slate-300">/</span>
              <strong className="text-[15.5px] md:text-[18px] font-black text-[#1E2A38]">{formatCount(totalCount)}</strong>
              kayıt
            </span>
            <button
              type="button"
              onClick={() => void selectAllFilteredRows()}
              disabled={totalCount === 0 || isSelectingFiltered}
              className={toolbarButton}
            >
              <ToolbarIcon name="check" />
              {isSelectingFiltered ? 'Seçiliyor...' : `Filtrelenenlerin Tümünü Seç (${formatCount(totalCount)})`}
            </button>
            {selectedRowIds.length > 0 && (
              <button type="button" onClick={() => setSelectedRowIds([])} className={toolbarButton}>
                <ToolbarIcon name="x" />
                Seçimi Kaldır
              </button>
            )}
          </div>

          <ToolbarDivider />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openSelectedBeneficiaryFile}
              disabled={selectedRowIds.length !== 1 || selectedRows.length !== 1}
              className={toolbarPrimaryButton}
              title="Tek bir birey seçiliyken dosyasını açar (satıra çift tıklayarak da açabilirsiniz)"
            >
              <ToolbarIcon name="open" />
              Seçili Dosyayı Aç
            </button>
            <button type="button" onClick={refreshBeneficiaries} disabled={loading} className={toolbarButton}>
              <ToolbarIcon name="refresh" />
              {loading ? 'Yenileniyor...' : 'Yenile'}
            </button>
          </div>

          <ToolbarDivider />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportSelectedRows} disabled={selectedRowIds.length === 0} className={toolbarButton}>
              <ToolbarIcon name="download" />
              Seçilenleri XLSX
            </button>
            <button type="button" onClick={exportAllRows} disabled={exportStatus === 'loading'} className={toolbarButton}>
              <ToolbarIcon name="download" />
              {exportStatus === 'loading' ? 'Aktarılıyor...' : 'Tüm Bireyler XLSX'}
            </button>
            <BulkWhatsappSendButton recipients={bulkWhatsappRecipients} className={toolbarButton} />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <button type="button" onClick={clearFilters} className={toolbarButton}>
              <ToolbarIcon name="filterOff" />
              Filtreleri Temizle
            </button>
            <button
              type="button"
              onClick={deleteSelectedRows}
              disabled={selectedRowIds.length === 0 || isDeleting}
              className={toolbarDangerButton}
            >
              <ToolbarIcon name="trash" />
              {isDeleting ? 'Siliniyor...' : selectedRowIds.length > 0 ? `Sil (${formatCount(selectedRowIds.length)})` : 'Sil'}
            </button>
          </div>
        </div>
      </div>

      <div className={corporateTableCard}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E2A38] border-t-transparent" />
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
            preferredColumnOrder={BENEFICIARY_COLUMN_ORDER}
            // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli
            // degil - kullanici HER sutunu (Telefon dahil) gosterip
            // gizleyebilir.
            columnLabels={BENEFICIARY_COLUMN_LABELS}
            columnGroups={BENEFICIARY_COLUMN_GROUPS}
            defaultHiddenColumns={BENEFICIARY_DEFAULT_HIDDEN_COLUMNS}
            corporate
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
          <CorporatePagination
            page={pagination.page}
            totalPages={totalPages}
            totalCount={totalCount}
            firstRecord={firstRecord}
            lastRecord={lastRecord}
            hasRows={data.length > 0}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
            onPageChange={setPage}
          />
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-extrabold text-[#1E2A38]">Sisteme Birey Ekle</h3>
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
                className="rounded-md bg-[#1E2A38] px-5 py-2 text-[13px] font-extrabold text-white shadow-sm hover:bg-[#2A3B4D]"
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
