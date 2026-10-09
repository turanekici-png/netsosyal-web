'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { promptDialog } from '@/components/shared/GlobalPromptDialog'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

type ApprovalRequestRow = {
  id: string
  kayitTuru: string
  turAdi: string
  kayitId: string
  dosyaId: string
  donem: number | null
  durum: number
  talepTarihi: string
  onayTarihi: string | null
  aciklama: string | null
  redAciklama: string | null
  dosyaNo: string | null
  kisiAdi: string | null
  miktar: string | null
  talepEdenAdi: string | null
  onaylayanAdi: string | null
  hedefAdi: string | null
  raporKonu: string | null
  raporIcerik: string | null
}

// "Uygun Görüş İste" (tahkikat_raporu) detay penceresinde gosterilen, o
// dosyaya ait HENUZ karar verilmemis ("Yeni Müracaat", durumu=0) kayitlar -
// bkz. /api/documents/fetch (mapApplicationRow ile ayni sekil).
type PendingApplicationRow = {
  recordId: string
  sourceTable: string
  type: string
  applicationDate: string
  period: string
  status: string
  amount: string
  description: string
}

// Ayni pencerede, dosyanin HALIHAZIRDA acik (aktif/pasif) yardimlari da
// gosterilir - ör. rapor "mevcut bir yardimin suresinin uzatilmasi"
// icin yazilmis olabilir; bu durumda yeni bir müracaat degil, VAR OLAN bir
// yardimin GUNCELLENMIS hali (ör. yeni bitis tarihi) burada gorunur - bkz.
// /api/documents/fetch (mapAssistanceRow ile ayni sekil).
type ExistingAssistanceRow = {
  recordId: string
  sourceTable: string
  type: string
  date: string
  startDate: string
  endDate: string
  periodInfo: string
  status: string
  amount: string
}

// Sadece bu 4 turdeki muracaatlar "Onayla" ile dogrudan yardima
// donusturulup donemi acilabilir (bkz. app/api/documents/convert-application).
const CONVERTIBLE_SOURCE_TABLES = new Set(['yrd_ekmek', 'yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_haziryemek'])

// /api/documents/fetch, "durumu" (status) alanini HAM SAYISAL KOD olarak
// dondurur (ör. "2", "3") - normal Dosya Yönetimi ekraninda bu kod, DataTable
// bilesenine ayrica gecirilen "predefinedValues" ile OTOMATIK etikete
// cevriliyor. Bu sayfada o mekanizma yok, bu yuzden ayni kodlarin sabit
// (uygulama genelinde tutarli) karsiliklari burada elle esleniyor.
const ASSISTANCE_STATUS_LABELS: Record<string, string> = {
  '0': 'Yeni Müracaat',
  '2': 'Aktif',
  '3': 'İptal Edildi',
  '4': 'Süresi Bitti',
  '5': 'Durduruldu',
  '6': 'Ödendi',
}

function assistanceStatusLabel(code: string) {
  return ASSISTANCE_STATUS_LABELS[code] || code || '-'
}

function parseTrDate(value: string | null | undefined) {
  if (!value) return null
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, day, month, year] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? null : date
}

// "Talep Edilen Dönem" - Gıda Bankası/Destek Paketi'nde "donem" kolonu
// (mapAssistanceRow -> periodInfo), bir Düzenle sonrasi otomatik calisan
// "manual-period" ucu tarafindan GUNCEL takvim ayi ("Ağustos" vb.) ile
// UZERINE YAZILABILIYOR - kullanicinin Düzenle formunda sectigi GERCEK
// süre ("5 Ay") kaybolmus gibi görünebiliyor (bkz. handleSaveAssistance).
// Gercek/guvenilir kaynak HER ZAMAN baslangic->bitis tarihi FARKIDIR - bu
// yuzden ay adi yerine, mumkunse tarihlerden hesaplanan ay sayisi gosterilir.
function requestedPeriodLabel(startDate: string, endDate: string, fallback: string) {
  const start = parseTrDate(startDate)
  const end = parseTrDate(endDate)
  if (start && end && end > start) {
    const months = Math.round((end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + (end.getDate() - start.getDate()) / 30)
    if (months >= 1) return `${months} Ay`
  }
  return fallback && fallback !== '-' ? fallback : 'belirtilmemiş'
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all'

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'pending', label: 'Bekleyenler' },
  { id: 'approved', label: 'Onaylananlar' },
  { id: 'rejected', label: 'Reddedilenler' },
  { id: 'cancelled', label: 'İptal Edilenler' },
  { id: 'all', label: 'Tümü' },
]

const KAYIT_TURU_BADGE: Record<string, string> = {
  yrd_gidabankasi: 'bg-sky-100 text-sky-800 border-sky-200',
  yrd_destekpaketi: 'bg-violet-100 text-violet-800 border-violet-200',
  yrd_ddgidadosyali: 'bg-amber-100 text-amber-800 border-amber-200',
  tahkikat_raporu: 'bg-teal-100 text-teal-800 border-teal-200',
}

// "yrd_*" turleri YAZDIRMA onayidir, "tahkikat_raporu" ise bir İnceleme
// Raporu icin istenen UYGUN GORUS talebidir - onayla/reddet metinlerinde bu
// ayrima gore farkli kelime kullanilir.
function approvalActionNoun(kayitTuru: string) {
  return kayitTuru === 'tahkikat_raporu' ? 'uygun görüş' : 'yazdırma'
}

type SortKey = 'dosyaNo' | 'kisiAdi' | 'turAdi' | 'miktar' | 'talepEdenAdi' | 'talepTarihi'

const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'dosyaNo', label: 'Dosya' },
  { key: 'kisiAdi', label: 'Kişi' },
  { key: 'turAdi', label: 'Tür' },
  { key: 'miktar', label: 'Tutar' },
  { key: 'talepEdenAdi', label: 'Talep Eden' },
  { key: 'talepTarihi', label: 'Talep Tarihi' },
]

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ApprovalQueuePage() {
  const { addTab } = useTabs()
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [rows, setRows] = useState<ApprovalRequestRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [accessDenied, setAccessDenied] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('talepTarihi')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // "Detay" penceresi - "Uygun Görüş İste" (tahkikat_raporu) talepleri icin,
  // yazilan raporu VE o dosyaya ait henuz karar verilmemis muracaatlari
  // (istenen yardimlari) gosterir - bkz. openDetail/loadDetailApplications.
  const [detailRow, setDetailRow] = useState<ApprovalRequestRow | null>(null)
  const [detailApplications, setDetailApplications] = useState<PendingApplicationRow[]>([])
  const [detailAssistances, setDetailAssistances] = useState<ExistingAssistanceRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [convertingKey, setConvertingKey] = useState<string | null>(null)
  const [rejectingKey, setRejectingKey] = useState<string | null>(null)

  const loadRequests = useCallback(async (targetStatus: StatusFilter) => {
    setIsLoading(true)
    setError('')
    setAccessDenied(false)

    try {
      const response = await fetch(`/api/documents/approval-requests?status=${targetStatus}`, { cache: 'no-store' })
      const payload = await response.json()

      if (response.status === 401 || response.status === 403) {
        setAccessDenied(true)
        setRows([])
        return
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Onay talepleri alınamadı.')
      }

      setRows(Array.isArray(payload.data) ? payload.data : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Onay talepleri alınamadı.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRequests(status)
  }, [status, loadRequests])

  const openFile = (dosyaNo: string | null) => {
    if (!dosyaNo) return
    const query = new URLSearchParams({ search: dosyaNo })
    addTab({ title: `Dosya ${dosyaNo}`, path: `/documents?${query.toString()}` })
  }

  // Islem GERCEKTEN sunucuya kaydedildiyse true doner - "Detay" penceresi
  // kullanicinin acikca istegi uzerine SADECE bu durumda kapatilir (bkz.
  // asagidaki "Talebi Reddet"/"Uygun Görüş Talebini Onayla" butonlari) -
  // kullanici gerekce girmeden vazgecerse ya da sunucu hata donerse pencere
  // acik kalir.
  const decide = async (row: ApprovalRequestRow, action: 'approve' | 'reject'): Promise<boolean> => {
    let reason: string | null = null

    if (action === 'reject') {
      reason = await promptDialog(
        `${row.kisiAdi || 'Bu kayıt'} için "${row.turAdi}" ${approvalActionNoun(row.kayitTuru)} talebini reddetme gerekçenizi girin.`,
        { title: 'Talebi Reddet', placeholder: 'Örn: Ödeme günü zaten yaklaşıyor, bekleyin.', confirmLabel: 'Reddet', cancelLabel: 'Vazgeç' },
      )
      if (!reason || !reason.trim()) return false
    } else {
      const confirmed = await confirmDialog(`${row.kisiAdi || 'Bu kayıt'} için "${row.turAdi}" ${approvalActionNoun(row.kayitTuru)} talebini onaylıyor musunuz?`)
      if (!confirmed) return false
    }

    setBusyId(row.id)
    try {
      const response = await fetch(`/api/documents/approval-requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: reason || undefined }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'İşlem gerçekleştirilemedi.')

      await loadRequests(status)
      // Dosya Yönetimi AYNI sekmede (SPA icinde farkli bir "tab") acik
      // kalmis olabilir - bunun icin normal bir custom event yeterli.
      window.dispatchEvent(new CustomEvent('approval:updated'))
      // AMA "Onay Bekleyenler" GERÇEKTEN ayrı bir tarayıcı sekmesinde/
      // penceresinde acilmis olabilir - custom event'ler sekmeler arasi
      // GECMEZ. localStorage.setItem ise TUM diger sekmelerde "storage"
      // olayini tetikler (bu sekmenin KENDISINDE degil) - bu yuzden acik
      // dosyanin hangi sekmede oldugu FARK ETMEKSIZIN aninda haberdar olur
      // (bkz. app/(modules)/documents/page.tsx - "storage" dinleyicisi).
      try {
        window.localStorage.setItem('netsosyal:approval-updated', String(Date.now()))
      } catch {
        // localStorage erisilemezse (gizli sekme vb.) sessizce yoksay.
      }
      return true
    } catch (decisionError) {
      alert(decisionError instanceof Error ? decisionError.message : 'İşlem gerçekleştirilemedi.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  // Ayni tarayici sekmesindeki Dosya Yönetimi "tab"ina VE gercekten baska
  // sekme/pencerelerdeki Onay Bekleyenler/Dosya ekranlarina degisiklik
  // oldugunu haber verir - decide() ile ayni mekanizma (bkz. yukarisi).
  const broadcastApprovalUpdate = () => {
    window.dispatchEvent(new CustomEvent('approval:updated'))
    try {
      window.localStorage.setItem('netsosyal:approval-updated', String(Date.now()))
    } catch {
      // localStorage erisilemezse (gizli sekme vb.) sessizce yoksay.
    }
  }

  const loadDetailApplications = async (dosyaId: string) => {
    setDetailLoading(true)
    setDetailError('')
    try {
      const response = await fetch(`/api/documents/fetch?fileId=${dosyaId}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || 'Dosya bilgileri alınamadı.')
      // "Uygun Görüş İste" akışı sadece Ekmek/Gıda Bankası/Destek Paketi/
      // Hazır Yemek ile sınırlı (bkz. documents/page.tsx - "Dosya Yardımları"
      // paneliyle AYNI kısıt) - Giyim/Ayni-Nakdi/Dönem Dışı Gıda muracaat/
      // yardimlari yetkilinin onay ekraninda da GORUNMEZ.
      const applications = Array.isArray(payload.data.applications) ? payload.data.applications : []
      const assistances = Array.isArray(payload.data.assistances) ? payload.data.assistances : []
      setDetailApplications(applications.filter((row: PendingApplicationRow) => CONVERTIBLE_SOURCE_TABLES.has(row.sourceTable)))
      setDetailAssistances(assistances.filter((row: ExistingAssistanceRow) => CONVERTIBLE_SOURCE_TABLES.has(row.sourceTable)))
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : 'Dosya bilgileri alınamadı.')
      setDetailApplications([])
      setDetailAssistances([])
    } finally {
      setDetailLoading(false)
    }
  }

  // "Detay" butonu - bir "Uygun Görüş İste" talebinde, yazilan rapor ile
  // birlikte o dosyaya ait HENUZ karar verilmemis (durumu=0) muracaatlari
  // ("istenen yardimlar") gosterir - yetkili personel buradan tek tek
  // yardima donusturebilir (bkz. convertApplication).
  const openDetail = (row: ApprovalRequestRow) => {
    setDetailRow(row)
    setDetailApplications([])
    setDetailAssistances([])
    void loadDetailApplications(row.dosyaId)
  }

  const closeDetail = () => {
    setDetailRow(null)
    setDetailApplications([])
    setDetailAssistances([])
    setDetailError('')
  }

  // "Onayla" (istenen yardım satırı) - TEK bir uc kullanilir
  // (/api/documents/convert-application): Ekmek/Gıda Bankası/Destek Paketi/
  // Hazır Yemek icin müracaatı DOĞRUDAN yardıma dönüştürür ve dönemini acar
  // - kullanıcının acikca istegi "onaylanan yardımlar yetkilinin onayıyla
  // direk yardıma dönüşsün ve dönemleri açılsın" akışı. Donem/hareket kaydi
  // kavrami olmayan diger turlerde (Giyim, Dönem Dışı Gıda, Ayni/Nakdi) ayni
  // uc, sadece "aktif" durumuna (durumu=2) geciren daha basit bir yol izler
  // (bkz. convert-application/route.ts - SIMPLE_ACTIVATE_TABLES).
  const approveApplication = async (application: PendingApplicationRow) => {
    if (!detailRow) return
    const convertible = CONVERTIBLE_SOURCE_TABLES.has(application.sourceTable)
    const confirmed = await confirmDialog(
      convertible
        ? `"${application.type}" yardımını onaylayıp doğrudan aktif yardıma dönüştürmek istiyor musunuz? Dönemi otomatik açılacaktır.`
        : `"${application.type}" yardımını onaylayıp aktif hale getirmek istiyor musunuz?`,
    )
    if (!confirmed) return

    const key = `${application.sourceTable}:${application.recordId}`
    setConvertingKey(key)
    try {
      const response = await fetch('/api/documents/convert-application', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: detailRow.dosyaId, recordId: application.recordId, sourceTable: application.sourceTable }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Müracaat onaylanamadı.')

      await loadDetailApplications(detailRow.dosyaId)
      broadcastApprovalUpdate()
    } catch (approveError) {
      alert(approveError instanceof Error ? approveError.message : 'Müracaat onaylanamadı.')
    } finally {
      setConvertingKey(null)
    }
  }

  // "Onayla → Tekrar Aktif Et" (mevcut yardım satırı) - dosyada DAHA ÖNCE
  // açılmış ama şu an pasif/iptal/durmuş olan bir yardımı, VAR OLAN miktar/
  // dönem bilgisiyle TEK TIKLA tekrar aktif eder (bkz. convert-application
  // route - mode: 'reactivate'). Rapor "mevcut bir yardımın güncellenmesi"
  // icin yazilmissa bu akis kullanilir.
  const reactivateAssistance = async (assistance: ExistingAssistanceRow) => {
    if (!detailRow) return
    const confirmed = await confirmDialog(`"${assistance.type}" yardımını var olan bilgileriyle tekrar aktif etmek istiyor musunuz?`)
    if (!confirmed) return

    const key = `${assistance.sourceTable}:${assistance.recordId}`
    setConvertingKey(key)
    try {
      const response = await fetch('/api/documents/convert-application', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: detailRow.dosyaId, recordId: assistance.recordId, sourceTable: assistance.sourceTable, mode: 'reactivate' }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Yardım tekrar aktif edilemedi.')

      await loadDetailApplications(detailRow.dosyaId)
      broadcastApprovalUpdate()
    } catch (reactivateError) {
      alert(reactivateError instanceof Error ? reactivateError.message : 'Yardım tekrar aktif edilemedi.')
    } finally {
      setConvertingKey(null)
    }
  }

  // "Reddet" (istenen yardım satırı) - müracaatı iptal eder (durumu=3, bkz.
  // /api/documents/service-record) - "Onaylananlar" yerine dosyada "İptal
  // Edildi" olarak görünür, tur farketmeksizin tum yardim turlerinde calisir.
  const rejectApplication = async (application: PendingApplicationRow) => {
    if (!detailRow) return
    const confirmed = await confirmDialog(`"${application.type}" yardım talebini reddetmek istiyor musunuz? Kayıt "İptal Edildi" olarak işaretlenecek.`)
    if (!confirmed) return

    const key = `${application.sourceTable}:${application.recordId}`
    setRejectingKey(key)
    try {
      const response = await fetch('/api/documents/service-record', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: detailRow.dosyaId,
          recordId: application.recordId,
          sourceTable: application.sourceTable,
          status: 3,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Müracaat reddedilemedi.')

      await loadDetailApplications(detailRow.dosyaId)
      broadcastApprovalUpdate()
    } catch (rejectError) {
      alert(rejectError instanceof Error ? rejectError.message : 'Müracaat reddedilemedi.')
    } finally {
      setRejectingKey(null)
    }
  }

  // "İptal Et" (mevcut yardım satırı, HALEN AKTİF olan) - yetkili, rapor
  // dogrultusunda devam eden bir yardimin ARTIK durdurulmasi gerektigine
  // karar verirse buradan tek tikla iptal edebilir (durumu=3, bkz.
  // /api/documents/service-record) - "Onayla → Tekrar Aktif Et" ile ayni
  // satirin simetrigi.
  const cancelExistingAssistance = async (assistance: ExistingAssistanceRow) => {
    if (!detailRow) return
    const confirmed = await confirmDialog(`"${assistance.type}" yardımını iptal etmek istiyor musunuz? Kayıt "İptal Edildi" olarak işaretlenecek.`)
    if (!confirmed) return

    const key = `${assistance.sourceTable}:${assistance.recordId}`
    setRejectingKey(key)
    try {
      const response = await fetch('/api/documents/service-record', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: detailRow.dosyaId,
          recordId: assistance.recordId,
          sourceTable: assistance.sourceTable,
          status: 3,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Yardım iptal edilemedi.')

      await loadDetailApplications(detailRow.dosyaId)
      broadcastApprovalUpdate()
    } catch (cancelError) {
      alert(cancelError instanceof Error ? cancelError.message : 'Yardım iptal edilemedi.')
    } finally {
      setRejectingKey(null)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'talepTarihi' ? 'desc' : 'asc')
    }
  }

  const sortIcon = (key: SortKey) => (
    <span className="text-sm opacity-80">{sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
  )

  // "Akilli filtreleme" - tek bir arama kutusu; dosya no, kisi adi, turu,
  // talep eden/onaylayan adi ve aciklama METNI icinde ARAR (hangi alanda
  // eslesirse eslessin) - kullanicinin hangi kolonda arama yapmasi
  // gerektigini bilmesine gerek kalmaz. Ayrica tur bazinda ayri bir hizli
  // filtre de var (Gida Bankasi / Destek Paketi / Donem Disi Gida).
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('tr-TR')
  const filteredRows = rows.filter((row) => {
    if (typeFilter && row.kayitTuru !== typeFilter) return false
    if (!normalizedSearch) return true
    const haystack = [row.dosyaNo, row.kisiAdi, row.turAdi, row.talepEdenAdi, row.onaylayanAdi, row.aciklama, row.miktar]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('tr-TR')
    return haystack.includes(normalizedSearch)
  })

  const sortedRows = [...filteredRows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'talepTarihi') {
      return dir * (new Date(a.talepTarihi).getTime() - new Date(b.talepTarihi).getTime())
    }
    if (sortKey === 'miktar') {
      const aNum = Number(a.miktar) || 0
      const bNum = Number(b.miktar) || 0
      return dir * (aNum - bNum)
    }
    return dir * String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'tr-TR')
  })

  return (
    <div className="space-y-5 text-slate-950">
      <div className="rounded-lg border border-slate-300 shadow-sm ring-1 ring-slate-200 overflow-hidden">
        <div className="flex flex-col gap-4 bg-[#1E2A38] px-6 py-5 text-white md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75l2.25 2.25L15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-black uppercase tracking-wide text-white/90">Yardım Yönetimi</p>
              <h1 className="mt-1 text-3xl font-black leading-tight">Onay Bekleyenler</h1>
              <p className="mt-1.5 text-xl font-bold text-white/85">Ödeme penceresi dışındaki yazdırma taleplerini ve İnceleme Raporu uygun görüş taleplerini burada onaylayıp reddedebilirsiniz.</p>
            </div>
          </div>
        </div>

        {accessDenied ? (
          <div className="bg-white p-10 text-center">
            <p className="text-xl font-bold text-rose-600">Bu sayfayı görüntülemek için &quot;Yetkili Personel&quot; olmanız gerekir.</p>
            <p className="mt-1.5 text-lg font-semibold text-slate-500">Yetkili personel listesi Ayarlar &gt; Yetkili Personeller bölümünden yönetilir.</p>
          </div>
        ) : (
          <div className="space-y-4 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatus(tab.id)}
                  className={`rounded-lg px-5 py-2.5 text-xl font-black transition ${
                    status === tab.id
                      ? 'bg-[#1E2A38] text-white shadow-sm'
                      : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void loadRequests(status)}
                disabled={isLoading}
                className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-lg font-black text-slate-500 shadow-sm hover:border-[#1E2A38] hover:text-[#1E2A38] disabled:cursor-wait disabled:opacity-60"
              >
                {isLoading ? 'Yükleniyor...' : 'Listeyi Yenile'}
              </button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-lg font-black text-slate-600 outline-none focus:border-[#1E2A38]"
                >
                  <option value="">Tüm Türler</option>
                  <option value="yrd_gidabankasi">Gıda Bankası</option>
                  <option value="yrd_destekpaketi">Destek Paketi</option>
                  <option value="yrd_ddgidadosyali">Dönem Dışı Gıda</option>
                  <option value="tahkikat_raporu">İnceleme Raporu</option>
                </select>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                      <circle cx="9" cy="9" r="6" />
                      <path d="M17 17l-3.5-3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Dosya, kişi, tür, açıklama ara..."
                    className="w-64 rounded-lg border-2 border-slate-300 bg-white py-2.5 pl-9 pr-3 text-lg font-bold text-slate-800 outline-none focus:border-[#1E2A38]"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                        <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border-2 border-rose-200 bg-rose-50 px-4 py-3 text-xl font-bold text-rose-700">{error}</div>
            )}

            <div className="overflow-hidden rounded-xl border-2 border-slate-300 shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <span className="h-5 w-1.5 rounded-full bg-[#1E2A38]" />
                <span className="text-lg font-black uppercase text-slate-500">
                  {sortedRows.length}/{rows.length} kayıt gösteriliyor
                </span>
              </div>
              {/* Kullanici istegi (14 Eylul 2026): "mobilden gidiğimde onay
                  bekleyenler sayfası açılmıyor onay veremiyoruz" - bu alan
                  SADECE bir tablo (min-w-900px) idi, mobilde (md alti)
                  hicbir kart/dikey gorunum YOKTU - Onayla/Reddet butonlarina
                  ulasmak icin agir yatay kaydirma gerekiyordu. Digerine
                  benzer (workflow sayfalarindaki gibi) bir mobil kart
                  gorunumu eklendi, md ve uzerinde eski tablo AYNEN duruyor. */}
              <div className="max-h-[640px] space-y-2 overflow-y-auto p-3 md:hidden">
                {sortedRows.length > 0 ? (
                  sortedRows.map((row) => (
                    <div key={row.id} className="rounded-xl border-2 border-slate-300 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openFile(row.dosyaNo)}
                          className="min-w-0 text-left"
                        >
                          <span className="block font-black text-[#1E2A38] underline-offset-2 hover:underline">{row.dosyaNo || '-'}</span>
                          <span className="mt-1 block truncate text-xl font-extrabold text-slate-900">{row.kisiAdi || '-'}</span>
                        </button>
                        <span className={`shrink-0 rounded-full border px-3 py-1.5 text-base font-black ${KAYIT_TURU_BADGE[row.kayitTuru] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {row.turAdi}
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-lg font-bold">
                        <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-700">
                          <div className="text-base font-black uppercase text-slate-400">Tutar</div>
                          {row.miktar || '-'}
                        </div>
                        <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-700">
                          <div className="text-base font-black uppercase text-slate-400">Talep Tarihi</div>
                          {formatDateTime(row.talepTarihi)}
                        </div>
                      </div>
                      <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-lg font-black text-[#1E2A38] ring-1 ring-slate-300">
                        {row.talepEdenAdi || '-'}
                      </div>
                      {row.aciklama && (
                        <p className="mt-2 line-clamp-2 text-lg font-semibold leading-6 text-slate-600">{row.aciklama}</p>
                      )}
                      {status !== 'pending' && (
                        <p className="mt-2 text-lg font-bold">
                          {row.durum === 1 ? (
                            <span className="text-emerald-700">{row.onaylayanAdi || '-'} · {formatDateTime(row.onayTarihi)}</span>
                          ) : row.durum === 2 ? (
                            <span className="text-rose-700">{row.onaylayanAdi || '-'} · {formatDateTime(row.onayTarihi)}</span>
                          ) : row.durum === 3 ? (
                            <span className="text-slate-500">{row.talepEdenAdi || '-'} tarafından iptal edildi</span>
                          ) : (
                            <span className="text-amber-700">Beklemede</span>
                          )}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openDetail(row)}
                          className="h-11 flex-1 rounded-lg border border-teal-200 bg-teal-50 text-lg font-black text-teal-700 hover:bg-teal-100"
                        >
                          Detay
                        </button>
                        {row.durum === 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => void decide(row, 'approve')}
                              disabled={busyId === row.id}
                              className="h-11 flex-1 rounded-lg border border-emerald-200 bg-emerald-50 text-lg font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              Onayla
                            </button>
                            <button
                              type="button"
                              onClick={() => void decide(row, 'reject')}
                              disabled={busyId === row.id}
                              className="h-11 flex-1 rounded-lg border border-rose-200 bg-rose-50 text-lg font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              Reddet
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-xl font-bold text-slate-500">
                    {isLoading ? 'Yükleniyor...' : rows.length === 0 ? 'Kayıt bulunamadı.' : 'Aramanızla eşleşen kayıt bulunamadı.'}
                  </div>
                )}
              </div>

              <div className="hidden max-h-[640px] overflow-auto md:block">
                <table className="w-full min-w-[1000px] border-collapse text-left text-lg">
                  <thead className="sticky top-0 bg-[#1E2A38] text-base font-black uppercase text-white shadow-sm">
                    <tr>
                      {SORTABLE_COLUMNS.map((column) => (
                        <th key={column.key} className="px-4 py-3">
                          <button type="button" onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1.5 hover:text-violet-200">
                            {column.label} {sortIcon(column.key)}
                          </button>
                        </th>
                      ))}
                      <th className="px-4 py-3">Açıklama</th>
                      {status !== 'pending' && <th className="px-4 py-3">Karar</th>}
                      <th className="px-4 py-3 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {sortedRows.length > 0 ? (
                      sortedRows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => openFile(row.dosyaNo)}
                          className="cursor-pointer hover:bg-violet-50/50"
                          title="Dosya detay sayfasını açmak için tıklayın"
                        >
                          <td className="px-4 py-3">
                            <span className="font-black text-[#1E2A38] hover:underline">
                              {row.dosyaNo || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-800">{row.kisiAdi || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full border px-3 py-1.5 text-base font-black ${KAYIT_TURU_BADGE[row.kayitTuru] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                              {row.turAdi}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-700">{row.miktar || '-'}</td>
                          <td className="px-4 py-3 text-base font-bold text-slate-500">{row.talepEdenAdi || '-'}</td>
                          <td className="px-4 py-3 text-base font-bold text-slate-500">{formatDateTime(row.talepTarihi)}</td>
                          <td className="px-4 py-3 max-w-[220px] truncate text-base font-semibold text-slate-500" title={row.aciklama || ''}>{row.aciklama || '-'}</td>
                          {status !== 'pending' && (
                            <td className="px-4 py-3 text-base font-bold text-slate-500">
                              {row.durum === 1 ? (
                                <span className="text-emerald-700">{row.onaylayanAdi || '-'} · {formatDateTime(row.onayTarihi)}</span>
                              ) : row.durum === 2 ? (
                                <span className="text-rose-700" title={row.redAciklama || ''}>{row.onaylayanAdi || '-'} · {formatDateTime(row.onayTarihi)}</span>
                              ) : row.durum === 3 ? (
                                <span className="text-slate-500">{row.talepEdenAdi || '-'} tarafından iptal edildi</span>
                              ) : (
                                <span className="text-amber-700">Beklemede</span>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openDetail(row)}
                                className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-base font-black text-teal-700 hover:bg-teal-100"
                              >
                                Detay
                              </button>
                              {row.durum === 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void decide(row, 'approve')}
                                    disabled={busyId === row.id}
                                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-base font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                                  >
                                    Onayla
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void decide(row, 'reject')}
                                    disabled={busyId === row.id}
                                    className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-base font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                                  >
                                    Reddet
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={status !== 'pending' ? 9 : 8} className="px-4 py-10 text-center text-xl font-bold text-slate-500">
                          {isLoading ? 'Yükleniyor...' : rows.length === 0 ? 'Kayıt bulunamadı.' : 'Aramanızla eşleşen kayıt bulunamadı.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* "Detay" Penceresi - "Uygun Görüş İste" (tahkikat_raporu) talebinde
          yazilan raporu ve o dosyaya ait HENUZ karar verilmemis
          muracaatlari ("istenen yardimlar") gosterir - her biri tek tek
          "Onayla" ile dogrudan aktif yardima donusturulup donemi acilir
          (bkz. convertApplication / /api/documents/convert-application). */}
      {detailRow && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-900/70 p-2 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 bg-[#1E2A38] px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30 text-2xl">💬</span>
                <div>
                  <p className="text-lg font-black uppercase tracking-[0.14em] text-white/80">{detailRow.turAdi} - Talep Detayı</p>
                  <h3 className="mt-1 text-2xl font-black leading-tight">
                    Dosya {detailRow.dosyaNo || '-'} · {detailRow.talepEdenAdi || '-'}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-white p-6">
              {(detailRow.raporIcerik || detailRow.raporKonu) && (
                <div className="rounded-xl border-2 border-teal-200 bg-teal-50/50 p-5">
                  <p className="text-xl font-black uppercase tracking-wide text-teal-800">
                    İlgili İnceleme Raporu {detailRow.raporKonu ? `- ${detailRow.raporKonu}` : ''}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-xl font-semibold leading-relaxed text-slate-800">
                    {detailRow.raporIcerik || 'Rapor içeriği bulunamadı.'}
                  </p>
                </div>
              )}

              {detailRow.aciklama && (
                <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-5">
                  <p className="text-xl font-black uppercase tracking-wide text-slate-600">Talep Notu</p>
                  <p className="mt-2 whitespace-pre-wrap text-xl font-semibold leading-relaxed text-slate-700">{detailRow.aciklama}</p>
                </div>
              )}

              <div>
                <p className="mb-2 text-xl font-black uppercase tracking-wide text-slate-600">
                  İstenen Yardımlar {detailApplications.length > 0 ? `(${detailApplications.length})` : ''}
                </p>
                {detailError && (
                  <div className="mb-2 rounded-lg border-2 border-rose-200 bg-rose-50 px-4 py-3 text-xl font-bold text-rose-700">{detailError}</div>
                )}
                {detailLoading ? (
                  <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center text-xl font-bold text-slate-400">
                    Yükleniyor...
                  </div>
                ) : detailApplications.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center text-xl font-bold text-slate-500">
                    Bu dosyada henüz karara bağlanmamış bir müracaat bulunmuyor.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detailApplications.map((application) => {
                      const key = `${application.sourceTable}:${application.recordId}`
                      const convertible = CONVERTIBLE_SOURCE_TABLES.has(application.sourceTable)
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-lg border-2 border-amber-200 bg-amber-50/50 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-xl font-black text-slate-800">
                              {application.type} <span className="font-bold text-slate-500">· {application.amount || '-'}</span>
                            </p>
                            <p className="mt-1 text-lg font-semibold text-slate-500">
                              Müracaat: {application.applicationDate || '-'} · Dönem: {application.period || '-'} · {assistanceStatusLabel(application.status)}
                            </p>
                            {application.description && application.description !== '-' && (
                              <p className="mt-1 truncate text-lg font-semibold text-slate-400" title={application.description}>{application.description}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => void approveApplication(application)}
                              disabled={convertingKey === key || rejectingKey === key}
                              title={convertible ? 'Doğrudan aktif yardıma dönüştürür ve dönemini açar.' : 'Bu kaydı aktif hale getirir.'}
                              className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-lg font-black text-white shadow-sm hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                            >
                              {convertingKey === key ? 'İşleniyor...' : convertible ? 'Onayla → Yardım Yap' : 'Onayla'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void rejectApplication(application)}
                              disabled={convertingKey === key || rejectingKey === key}
                              className="rounded-lg border border-rose-300 bg-rose-50 px-5 py-2.5 text-lg font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              {rejectingKey === key ? 'İşleniyor...' : 'Reddet'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {detailAssistances.length > 0 && (
                <div>
                  <p className="mb-2 text-xl font-black uppercase tracking-wide text-slate-600">
                    Mevcut Yardımlar (Aktif/Pasif) ({detailAssistances.length})
                  </p>
                  <p className="mb-2 text-lg font-semibold text-slate-500">
                    Rapor, var olan bir yardımın güncellenmesi (ör. süre uzatımı) için yazılmış olabilir - dosyanın güncel yardım durumu aşağıdadır.
                  </p>
                  <div className="space-y-2">
                    {detailAssistances.map((assistance) => {
                      const key = `${assistance.sourceTable}:${assistance.recordId}`
                      const isActive = assistance.status === '2'
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-xl font-black text-slate-800">
                              {assistance.type} <span className="font-bold text-slate-500">· {assistance.amount || '-'}</span>
                              <span className="ml-2 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-base font-black uppercase text-slate-600">{assistanceStatusLabel(assistance.status)}</span>
                            </p>
                            <p className="mt-1 text-lg font-black text-emerald-800">
                              Talep Edilen Dönem: {requestedPeriodLabel(assistance.startDate, assistance.endDate, assistance.periodInfo)}
                            </p>
                            <p className="mt-1 text-lg font-semibold text-slate-500">
                              Başlangıç: {assistance.startDate || '-'} · Yeni Bitiş Tarihi: <span className="font-black text-slate-700">{assistance.endDate || 'belirtilmemiş'}</span>
                            </p>
                          </div>
                          {isActive ? (
                            <button
                              type="button"
                              onClick={() => void cancelExistingAssistance(assistance)}
                              disabled={rejectingKey === key}
                              title="Devam eden bu yardımı iptal eder."
                              className="shrink-0 rounded-lg border border-rose-300 bg-rose-50 px-5 py-2.5 text-lg font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              {rejectingKey === key ? 'İşleniyor...' : 'İptal Et'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void reactivateAssistance(assistance)}
                              disabled={convertingKey === key}
                              title="Var olan miktar/dönem bilgisiyle tekrar aktif eder."
                              className="shrink-0 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-lg font-black text-white shadow-sm hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                            >
                              {convertingKey === key ? 'İşleniyor...' : 'Onayla → Tekrar Aktif Et'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeDetail}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-lg font-black text-slate-600 hover:bg-slate-100"
                >
                  Kapat
                </button>
                <button
                  type="button"
                  onClick={() => openFile(detailRow.dosyaNo)}
                  title="Onaya gönderilen müracaatı güncellemek için dosyayı açar."
                  className="inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-5 py-2.5 text-lg font-black text-sky-700 hover:bg-sky-100"
                >
                  Dosyayı Aç
                </button>
              </div>
              {detailRow.durum === 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await decide(detailRow, 'reject')
                      if (ok) closeDetail()
                    }}
                    disabled={busyId === detailRow.id}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-2.5 text-lg font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    Talebi Reddet
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await decide(detailRow, 'approve')
                      if (ok) closeDetail()
                    }}
                    disabled={busyId === detailRow.id}
                    className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-lg font-black text-white shadow-sm hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                  >
                    Talebi Onayla
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
