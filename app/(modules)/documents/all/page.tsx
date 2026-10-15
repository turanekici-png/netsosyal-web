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
const CHAINABLE_FILTER_COLUMNS = [
  'mahalle', 'cadde', 'sokak', 'binaNo', 'site',
  'aileNiteligi', 'konutTuru', 'konutDurumu', 'isinmaTuru', 'mulkiyetDurumu', 'yardimOncelikSirasi',
  'kaydiAcan', 'sonIslemYapan', 'konumKaynagi', 'konumDurumu',
]

// 2026-10-15 kullanici istegi: dosyalar tablosunun TUM alanlari listede;
// Sütun Görünürlüğü'nden ac/kapat. Sira = panelde ve ilk acilista gorunen sira.
// grup = paneldeki grup; gizli = ilk acilista (ve kayitli duzende henuz
// yoksa) kapali baslar.
type DocumentColumnDef = { label: string; group: string; hidden?: boolean }
const DOCUMENT_COLUMNS: Record<string, DocumentColumnDef> = {
  dosyaId: { label: 'Dosya ID', group: 'Dosya' },
  dosyaNo: { label: 'Dosya No', group: 'Dosya' },
  durum: { label: 'Dosya Durumu', group: 'Dosya' },
  incelemePuani: { label: 'İnceleme Puanı', group: 'Dosya' },
  dosyaSahibi: { label: 'Dosya Sahibi', group: 'Dosya' },
  kartNo: { label: 'Kart No', group: 'Dosya' },
  muracaatTarihi: { label: 'Müracaat Tarihi', group: 'Dosya' },
  durumTarihi: { label: 'Durum Tarihi', group: 'Dosya', hidden: true },
  durumAciklamasi: { label: 'Durum Açıklaması', group: 'Dosya', hidden: true },
  vizeTarihi: { label: 'Vize Tarihi', group: 'Dosya', hidden: true },
  ilkKayitTarihi: { label: 'İlk Kayıt Tarihi', group: 'Dosya', hidden: true },
  yardimOncelikSirasi: { label: 'Yardım Öncelik Sırası', group: 'Dosya', hidden: true },
  telefon: { label: 'Telefon', group: 'İletişim ve Adres' },
  ceptel: { label: 'Cep Telefonu', group: 'İletişim ve Adres' },
  mahalle: { label: 'Mahalle', group: 'İletişim ve Adres' },
  mahalleKodu: { label: 'Mahalle Kodu', group: 'İletişim ve Adres', hidden: true },
  cadde: { label: 'Cadde', group: 'İletişim ve Adres' },
  sokak: { label: 'Sokak', group: 'İletişim ve Adres' },
  site: { label: 'Site', group: 'İletişim ve Adres', hidden: true },
  blok: { label: 'Blok', group: 'İletişim ve Adres', hidden: true },
  binaNo: { label: 'Bina No', group: 'İletişim ve Adres' },
  daireNo: { label: 'Daire No', group: 'İletişim ve Adres' },
  adresNo: { label: 'Adres No', group: 'İletişim ve Adres' },
  adres: { label: 'Adres', group: 'İletişim ve Adres' },
  toplamBirey: { label: 'Toplam Birey', group: 'Hane ve Konut' },
  kayitliBireySayisi: { label: 'Kayıtlı Birey Sayısı', group: 'Hane ve Konut', hidden: true },
  aileNiteligi: { label: 'Aile Niteliği', group: 'Hane ve Konut', hidden: true },
  konutTuru: { label: 'Konut Türü', group: 'Hane ve Konut', hidden: true },
  konutDurumu: { label: 'Konut Durumu', group: 'Hane ve Konut', hidden: true },
  isinmaTuru: { label: 'Isınma Türü', group: 'Hane ve Konut', hidden: true },
  mulkiyetDurumu: { label: 'Mülkiyet Durumu', group: 'Hane ve Konut', hidden: true },
  kiraMiktari: { label: 'Kira Miktarı', group: 'Hane ve Konut', hidden: true },
  toplamGelir: { label: 'Toplam Gelir', group: 'Hane ve Konut', hidden: true },
  aciklama: { label: 'Açıklama', group: 'Açıklama' },
  eskiAciklama: { label: 'Eski Açıklama', group: 'Açıklama', hidden: true },
  kaydiAcan: { label: 'Kaydı Açan', group: 'Kayıt Bilgisi', hidden: true },
  sonIslemYapan: { label: 'Son İşlem Yapan', group: 'Kayıt Bilgisi', hidden: true },
  olusturmaTarihi: { label: 'Oluşturma Tarihi', group: 'Kayıt Bilgisi' },
  guncellemeTarihi: { label: 'Güncelleme Tarihi', group: 'Kayıt Bilgisi' },
  konumEnlem: { label: 'Konum Enlem', group: 'Konum', hidden: true },
  konumBoylam: { label: 'Konum Boylam', group: 'Konum', hidden: true },
  konumKaynagi: { label: 'Konum Kaynağı', group: 'Konum', hidden: true },
  konumDurumu: { label: 'Konum Durumu', group: 'Konum', hidden: true },
  konumGuven: { label: 'Konum Güven Skoru', group: 'Konum', hidden: true },
  konumAdresHash: { label: 'Konum Adres Özeti', group: 'Konum', hidden: true },
  konumHata: { label: 'Konum Hatası', group: 'Konum', hidden: true },
  konumTarihi: { label: 'Konum Tarihi', group: 'Konum', hidden: true },
}
const DOCUMENT_COLUMN_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(DOCUMENT_COLUMNS).map(([key, def]) => [key, def.label]),
)
const DOCUMENT_COLUMN_GROUPS: Record<string, string> = Object.fromEntries(
  Object.entries(DOCUMENT_COLUMNS).map(([key, def]) => [key, def.group]),
)
const DOCUMENT_DEFAULT_HIDDEN_COLUMNS = Object.entries(DOCUMENT_COLUMNS)
  .filter(([, def]) => def.hidden)
  .map(([key]) => key)
const DOCUMENT_COLUMN_ORDER = Object.keys(DOCUMENT_COLUMNS)

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
  const totalPages = Math.max(1, Math.ceil(totalCount / (pagination.limit || PAGE_SIZE)))
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
    <div className="dy-dosyalar dy-tum-dosyalar space-y-4">
      <DestructiveAuthorizationDialog ref={destructiveAuthorizationRef} />
      {/* 2026-10-15: lacivert/altin kurumsal baslik (dy-page-hero teal
          ezmesi bu sayfada kaldirildi - Yardımlar/Dosya Yönetimi ile ayni dil). */}
      <ReportPageHeader
        eyebrow="Dosya Yönetimi"
        kicker="Dosya Yönetimi › Tüm Dosyalar"
        title="Tüm Dosyalar"
        subtitle={
          <>
            {formatCount(totalCount)} dosya
            {data.length > 0 && <> · {formatCount(firstRecord)}–{formatCount(lastRecord)} arası gösteriliyor</>}
            {selectedRowIds.length > 0 && <> · <span className="font-bold text-[#E9D9A8]">{formatCount(selectedRowIds.length)} seçili</span></>}
          </>
        }
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

      {/* 2026-10-15: arac cubugu islev gruplarina ayrildi (Seçim · Dosya ·
          Dışa Aktar · Temizle/Sil); renkli tekil dugmeler yerine tek kurumsal
          dil. Islevler/onaylar AYNEN korunur. */}
      <div className={corporateToolbarCard}>
        <form onSubmit={handleSearch} className="flex w-full flex-wrap gap-2 sm:flex-nowrap">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <ToolbarIcon name="search" />
            </span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Dosya no, bireyin adı/TC'si, kart no, telefon, mahalle, cadde/sokak, adres veya açıklama ara"
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
              onClick={openSelectedDocument}
              disabled={selectedRowIds.length !== 1 || selectedRows.length !== 1}
              className={toolbarPrimaryButton}
              title="Tek bir dosya seçiliyken açar (satıra çift tıklayarak da açabilirsiniz)"
            >
              <ToolbarIcon name="open" />
              Seçili Dosyayı Aç
            </button>
            <button type="button" onClick={refreshDocuments} disabled={loading} className={toolbarButton}>
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
              {exportStatus === 'loading' ? 'Aktarılıyor...' : 'Tüm Dosyalar XLSX'}
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
            preferredColumnOrder={DOCUMENT_COLUMN_ORDER}
            // Kullanici istegi: hicbir sutun artik zorla gorunur/kilitli
            // degil - kullanici HER sutunu (Cep Telefonu dahil) gosterip
            // gizleyebilir.
            columnLabels={DOCUMENT_COLUMN_LABELS}
            columnGroups={DOCUMENT_COLUMN_GROUPS}
            defaultHiddenColumns={DOCUMENT_DEFAULT_HIDDEN_COLUMNS}
            corporate
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
