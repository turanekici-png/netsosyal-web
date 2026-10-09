'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTabs } from '@/lib/context/TabContext'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  findPredefinedCategoryByCandidates,
  type PredefinedValue,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'

export const dynamic = 'force-dynamic'

type InvestigationFile = {
  fileId: string
  fileNo: string
  applicantName: string
  phone: string
  neighborhood: string
  address: string
  statusDate: string | null
  statusDescription: string
  updatedAt: string | null
  userName: string
  assignedUserId: string | null
  assignedUserName: string | null
  assignedSeen: boolean | null
  // Kullanici istegi (2026-10-08, 2. tur): "65 mahalleyi paketlere
  // ayiralim, paketleri personele tanimlayalim, her ay otomatik degissin,
  // personel birbirinin dosyasini gormesin" - o ayki paket rotasyonundan
  // gelen "otomatik" sahip (manuel "Ata" YOKSA gecerli olan).
  zoneOwnerId: string | null
  zoneOwnerName: string | null
  effectiveOwnerId: string | null
}

// Kullanici istegi (2026-10-08): "yönetici özel olarak bir dosyayı istediği
// tahkikat görevlisine direk atayabilsin, atanan özel bir dosya var ise
// sekme üzerinde bildirim versin" - bkz. app/api/workflow/tahkikat/personnel,
// .../assign, .../mark-seen. SADECE Tahkikat sayfasinda (Ön İnceleme'de
// degil - bu bilesen ikisi arasinda paylasiliyor).
type TahkikatPersonnelEntry = {
  id: string
  name: string
  assignedCount: number
  unseenCount: number
}

type PredefinedValuesResponse = {
  success: boolean
  data?: {
    values: PredefinedValuesMap
    titles: PredefinedValueTitlesMap
  }
  error?: string
}

function findPredefinedOptions(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) {
  const category = findPredefinedCategoryByCandidates(values, titles, candidates)
  return category ? values[category] ?? [] : []
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function getTodayInputDate() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Kullanici istegi: listede goruntulenen "dosya durumu" bilgisi (Aciklama
// sutunu) diger listelerdeki gibi renklendirilsin. Gercek veride bu
// alanin buyuk cogunlugu ("Yardım tablolarında durumu=2 kayıt
// bulundu/yok") otomatik olusturulan, dosyanin AKTIF bir yardim kaydi
// olup olmadigini anlatan anlamli bir metin - bu yuzden anahtar kelime
// eslestirmesiyle uc renk kategorisine ayrildi (aktif yardim var / yok /
// bilinmeyen-diger metin). Documents sayfasindaki fileStatusMeta/
// getAssistanceStatusBadgeClass ile AYNI rozet (pill) gorsel dili
// kullanildi (renkli kenarlik + arka plan + metin, rounded-full).
function getStatusDescriptionBadgeClass(description: string) {
  const normalized = description.trim().toLocaleLowerCase('tr-TR')
  if (normalized.includes('kayıt bulundu')) {
    return 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
  }
  if (normalized.includes('kayıt yok')) {
    return 'border-slate-300 bg-slate-100 text-slate-600 ring-1 ring-slate-200'
  }
  if (normalized === '-' || !normalized) {
    return 'border-slate-200 bg-white text-slate-400 ring-1 ring-slate-100'
  }
  return 'border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-200'
}

// Duz liste ve mahalleye-gore-gruplu liste AYNI satir gorunumunu kullansin
// diye ayri bir bilesene cikarildi (kullanici istegi 13 Eylul 2026: ön
// inceleme sayfasindaki telefon/mahalle/adres + mahalle secici desenin
// aynisi tahkikat sayfasina da uygulandi).
function TahkikatTableRow({ row, index, workflowLabel, canAssign, onOpenFile, onOpenReport, onAssign }: {
  row: InvestigationFile
  index: number
  workflowLabel: string
  canAssign: boolean
  onOpenFile: (row: InvestigationFile) => void
  onOpenReport: (row: InvestigationFile) => void
  onAssign: (row: InvestigationFile) => void
}) {
  return (
    <tr className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} transition hover:bg-sky-50`}>
      <td className="border-b border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={() => onOpenFile(row)}
          className="font-black text-[#0076b6] underline-offset-2 hover:underline"
        >
          {row.fileNo}
        </button>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-extrabold text-slate-900">
        <span className="line-clamp-2 block max-w-[220px]">{row.applicantName}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">
        <span className="line-clamp-2 block max-w-[150px]">{row.phone}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">
        <span className="line-clamp-2 block max-w-[170px]">{row.neighborhood}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-700">
        <span className="line-clamp-2 block max-w-[260px]">{row.address}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">{formatDate(row.statusDate)}</td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">{formatDateTime(row.updatedAt)}</td>
      <td className="border-b border-slate-100 px-4 py-3">
        <span className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-[17px] font-black text-orange-800 ring-1 ring-orange-200">
          {row.userName}
        </span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3">
        {canAssign ? (
          <button
            type="button"
            onClick={() => onAssign(row)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[17px] font-black transition ${
              row.assignedUserName
                ? 'border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                : row.zoneOwnerName
                  ? 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100'
                  : 'border-dashed border-slate-300 bg-white text-slate-400 hover:bg-slate-50'
            }`}
          >
            {row.assignedUserName || (row.zoneOwnerName ? `${row.zoneOwnerName} (oto)` : 'Ata')}
          </button>
        ) : row.assignedUserName ? (
          <span className="inline-flex rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[17px] font-black text-indigo-800">
            {row.assignedUserName}
          </span>
        ) : row.zoneOwnerName ? (
          <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-[17px] font-black text-sky-800">
            {row.zoneOwnerName} (oto)
          </span>
        ) : (
          <span className="text-[17px] font-bold text-slate-300">—</span>
        )}
      </td>
      <td className="border-b border-slate-100 px-4 py-3">
        <span className={`inline-flex max-w-[280px] rounded-full border px-2.5 py-1 text-[17px] font-black ${getStatusDescriptionBadgeClass(row.statusDescription)}`}>
          <span className="line-clamp-2">{row.statusDescription}</span>
        </span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenFile(row)}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[17px] font-black uppercase text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Dosyayı Aç
          </button>
          <button
            type="button"
            onClick={() => onOpenReport(row)}
            className="inline-flex items-center rounded-md border border-[#0076b6] bg-white px-3 py-1.5 text-[17px] font-black uppercase text-[#005f95] shadow-sm transition hover:bg-sky-50"
          >
            Rapor Ekle
          </button>
        </div>
      </td>
    </tr>
  )
}

function TahkikatMobileCard({ row, onOpenFile, onOpenReport }: {
  row: InvestigationFile
  workflowLabel: string
  canAssign: boolean
  onOpenFile: (row: InvestigationFile) => void
  onOpenReport: (row: InvestigationFile) => void
  onAssign: (row: InvestigationFile) => void
}) {
  // Kullanici istegi (2026-10-08, 2. tur): "işaretli olan alanları
  // göstermesin (tahkikat/güncelleme tarihleri, kullanıcı/atama rozetleri,
  // durum açıklaması kutusu), buraya dosyayı aç butonu ekleyelim, daha
  // kurumsal ve profesyonel hale getirelim" - kart artik SADECE temel
  // kimlik + iletisim bilgisi + iki net aksiyon (Dosyayı Aç / Rapor Ekle)
  // gosteriyor, ikincil/teknik detaylar (atama, son guncelleme, durum
  // metni) kaldirildi - bunlar hala masaustu tabloda (TahkikatTableRow)
  // mevcut. canAssign/onAssign prop'lari cagiran taraflarla uyumlu kalmasi
  // icin imzada tutuldu, burada kullanilmiyor.
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpenFile(row)}
          className="text-[13px] font-black text-[#0076b6] underline-offset-2 hover:underline"
        >
          Dosya {row.fileNo}
        </button>
        <div className="mt-0.5 line-clamp-2 text-[13px] font-black uppercase leading-snug text-slate-900">{row.applicantName}</div>
      </div>
      <div className="mt-2 space-y-0.5 rounded-md bg-slate-50 px-2.5 py-2 text-[12px] font-semibold text-slate-700">
        <div><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Telefon: </span>{row.phone}</div>
        <div><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Mahalle: </span>{row.neighborhood}</div>
        <div className="line-clamp-2"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Adres: </span>{row.address}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => onOpenFile(row)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 shadow-sm"
        >
          Dosyayı Aç
        </button>
        <button
          type="button"
          onClick={() => onOpenReport(row)}
          className="rounded-md border border-[#0076b6] bg-[#0076b6] px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm"
        >
          Rapor Ekle
        </button>
      </div>
    </div>
  )
}

export default function TahkikatWorkflowPage() {
  const pathname = usePathname()
  const isPreliminaryReview = pathname === '/workflow/on-inceleme'
  const workflowLabel = isPreliminaryReview ? 'Ön İnceleme' : 'Tahkikat'
  const workflowLabelLower = isPreliminaryReview ? 'ön inceleme' : 'tahkikat'
  const listEndpoint = isPreliminaryReview ? '/api/workflow-preliminary-review' : '/api/workflow/tahkikat'
  const [rows, setRows] = useState<InvestigationFile[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  // Kullanici istegi: ustteki ozet kutucuklarindan (Toplam / Aktif
  // Yardımlı / Yardımsız) hangisine tiklanirsa alttaki liste SADECE o
  // gruba gore filtrelensin - tekrar tiklamak "Toplam"a (filtresiz) doner.
  const [statusFilter, setStatusFilter] = useState<'all' | 'withActiveAid' | 'withoutActiveAid'>('all')
  // Kullanici istegi (13 Eylul 2026): ön inceleme sayfasindaki telefon/
  // mahalle/adres + mahalle secici (chip) desenin aynisi burada da.
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string>('all')
  const [reportTarget, setReportTarget] = useState<InvestigationFile | null>(null)
  const [reportForm, setReportForm] = useState({ date: getTodayInputDate(), title: '', content: '' })
  const [reportStatus, setReportStatus] = useState<'idle' | 'saving'>('idle')
  const [reportError, setReportError] = useState('')
  const [investigationSubjectOptions, setInvestigationSubjectOptions] = useState<PredefinedValue[]>([])
  // Kullanici istegi (2026-10-08): "yönetici özel olarak bir dosyayı istediği
  // tahkikat görevlisine direk atayabilsin, atanan özel bir dosya var ise
  // sekme üzerinde bildirim versin" - SADECE Tahkikat'ta (bkz. isPreliminaryReview
  // kontrolleri asagida), Ön İnceleme'de bu ozellik gosterilmez/yuklenmez.
  const [personnel, setPersonnel] = useState<TahkikatPersonnelEntry[]>([])
  const [canAssign, setCanAssign] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('all')
  const [assignTarget, setAssignTarget] = useState<InvestigationFile | null>(null)
  const [assignSelectedUserId, setAssignSelectedUserId] = useState('')
  const [assignStatus, setAssignStatus] = useState<'idle' | 'saving'>('idle')
  const [assignError, setAssignError] = useState('')
  const { addTab } = useTabs()

  async function loadRows(isCancelled?: () => boolean) {
    setStatus('loading')
    setError('')
    try {
      const response = await fetch(listEndpoint, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || `${workflowLabel} dosyaları alınamadı.`)
      }

      if (!isCancelled?.()) {
        setRows(payload.data ?? [])
        setStatus('ready')
      }
    } catch (err) {
      if (!isCancelled?.()) {
        setError(err instanceof Error ? err.message : `${workflowLabel} listesi yüklenirken hata oluştu.`)
        setStatus('error')
      }
    }
  }

  async function loadPersonnel(isCancelled?: () => boolean) {
    if (isPreliminaryReview) return
    try {
      const response = await fetch('/api/workflow/tahkikat/personnel', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.success) return

      if (!isCancelled?.()) {
        setPersonnel(payload.data?.personnel ?? [])
        setCanAssign(Boolean(payload.data?.canAssign))
        setCurrentUserId(payload.data?.currentUserId ?? '')
      }
    } catch {
      // Personel sekmesi opsiyonel bir ozellik - yuklenemezse sessizce
      // gosterilmez, ana liste (loadRows) etkilenmez.
    }
  }

  useEffect(() => {
    let isCancelled = false

    void loadRows(() => isCancelled)

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listEndpoint, workflowLabel])

  useEffect(() => {
    let isCancelled = false

    void loadPersonnel(() => isCancelled)

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreliminaryReview])

  useEffect(() => {
    let isCancelled = false

    const loadPredefinedValues = async () => {
      try {
        const response = await fetch('/api/predefined-values', { cache: 'no-store' })
        const payload = (await response.json()) as PredefinedValuesResponse

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Hazir degerler alinamadi.')
        }

        if (!isCancelled) {
          setInvestigationSubjectOptions(
            findPredefinedOptions(payload.data.values, payload.data.titles, ['tahkikat konu', 'tahkikat konusu'])
          )
        }
      } catch {
        if (!isCancelled) {
          setInvestigationSubjectOptions(
            findPredefinedOptions(DEFAULT_PREDEFINED_VALUES, DEFAULT_PREDEFINED_VALUE_TITLES, ['tahkikat konu', 'tahkikat konusu'])
          )
        }
      }
    }

    void loadPredefinedValues()

    return () => {
      isCancelled = true
    }
  }, [])

  const searchFilteredRows = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase('tr-TR')
    if (!term) return rows

    return rows.filter((row) => (
      row.fileNo.toLocaleLowerCase('tr-TR').includes(term) ||
      row.applicantName.toLocaleLowerCase('tr-TR').includes(term) ||
      row.statusDescription.toLocaleLowerCase('tr-TR').includes(term) ||
      row.userName.toLocaleLowerCase('tr-TR').includes(term) ||
      row.neighborhood.toLocaleLowerCase('tr-TR').includes(term) ||
      row.phone.toLocaleLowerCase('tr-TR').includes(term) ||
      row.address.toLocaleLowerCase('tr-TR').includes(term)
    ))
  }, [rows, searchTerm])

  // Kullanici istegi: sayfa "daha profesyonel" olsun - toplam kayit
  // sayisinin yaninda, dosya durumu aciklamasina (renk kodlamasiyla AYNI
  // anahtar kelime mantigi) gore hizli bir kirilim gosterilir. Arama
  // metnine gore filtrelenmis TAM kumeden hesaplanir (statusFilter'dan
  // ONCE) - boylece kutucuklar HER ZAMAN gercek toplam dagilimi gosterir,
  // hangisi secili olursa olsun sayilar degismez.
  const statusSummary = useMemo(() => {
    let withActiveAid = 0
    let withoutActiveAid = 0
    for (const row of searchFilteredRows) {
      const normalized = row.statusDescription.trim().toLocaleLowerCase('tr-TR')
      if (normalized.includes('kayıt bulundu')) withActiveAid += 1
      else if (normalized.includes('kayıt yok')) withoutActiveAid += 1
    }
    return { withActiveAid, withoutActiveAid }
  }, [searchFilteredRows])

  // Kullanici istegi: ustteki kutucuklardan hangisine tiklanirsa alttaki
  // liste SADECE o gruba gore filtrelensin.
  const filteredRows = useMemo(() => {
    if (statusFilter === 'all') return searchFilteredRows
    return searchFilteredRows.filter((row) => {
      const normalized = row.statusDescription.trim().toLocaleLowerCase('tr-TR')
      if (statusFilter === 'withActiveAid') return normalized.includes('kayıt bulundu')
      return normalized.includes('kayıt yok')
    })
  }, [searchFilteredRows, statusFilter])

  // Kullanici istegi (2026-10-08): "yönetici özel olarak bir dosyayı
  // istediği tahkikat görevlisine direk atayabilsin" - personel
  // sekmelerinden biri secilince liste SADECE o gorevliye atanmis
  // dosyalara daralir (mahalle/arama/durum filtreleriyle BIRLIKTE calisir).
  // "effectiveOwnerId" kullanilir (SADECE "assignedUserId" DEGIL) - aksi
  // halde mahalle/paket rotasyonuyla otomatik o gorevliye dusen dosyalar
  // (manuel atanmamis olanlar) sekmede GORUNMEZDI (2026-10-08, 4. tur
  // duzeltmesi - "o mahalle sadece o kullanıcının listesinde görünsün").
  const personnelFilteredRows = useMemo(() => {
    if (selectedPersonnelId === 'all') return filteredRows
    return filteredRows.filter((row) => row.effectiveOwnerId === selectedPersonnelId)
  }, [filteredRows, selectedPersonnelId])

  // Kullanici istegi (13 Eylul 2026): "hangi mahallede kaç dosya tahkikat
  // yapılacak" - mahalleye gore gruplama + mahalle secici (ön inceleme
  // sayfasindaki AYNI desen).
  // Kullanici istegi (2026-10-07): "her mahallede tarih olarak en eski
  // tahkikat dosyasi o mahallede en ustte olacak sekilde listelensin" -
  // API zaten TUM listeyi tarihe gore DESC (en yeni once) donduruyordu
  // (bkz. route.ts ORDER BY ... DESC), bu yuzden gruplara dagitilan
  // dosyalar da DOGAL olarak en-yeniden-en-eskiye sirali geliyordu. Her
  // mahallenin kendi "files" dizisi burada AYRICA artan (ASC, en eski
  // once) tarihe gore siralanir - tarih bos olan kayitlar en sona atilir.
  const neighborhoodGroups = useMemo(() => {
    const map = new Map<string, InvestigationFile[]>()
    for (const row of personnelFilteredRows) {
      const key = row.neighborhood || 'Belirtilmemiş'
      const list = map.get(key)
      if (list) list.push(row)
      else map.set(key, [row])
    }
    const dateValue = (row: InvestigationFile) => {
      const raw = row.statusDate || row.updatedAt
      const time = raw ? new Date(raw).getTime() : NaN
      return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
    }
    return [...map.entries()]
      .map(([neighborhood, files]) => ({
        neighborhood,
        files: [...files].sort((a, b) => dateValue(a) - dateValue(b)),
      }))
      .sort((a, b) => b.files.length - a.files.length || a.neighborhood.localeCompare(b.neighborhood, 'tr-TR'))
  }, [personnelFilteredRows])

  // Secilen mahalleye gore daraltilmis liste - "Tümü" iken tum kayitlar
  // (gruplu gosterilecek), bir mahalle secilince SADECE o mahalledekiler.
  // Kullanici istegi (2026-10-07): tek mahalle secilince de AYNI "en eski
  // once" sirasi korunsun diye, zaten dogru sirali olan neighborhoodGroups
  // icinden okunur (filteredRows'u TEKRAR, sirasiz filtrelemek yerine).
  const displayedRows = useMemo(() => {
    if (selectedNeighborhood === 'all') return personnelFilteredRows
    return neighborhoodGroups.find((group) => group.neighborhood === selectedNeighborhood)?.files ?? []
  }, [personnelFilteredRows, neighborhoodGroups, selectedNeighborhood])

  // Secilen mahalle artik listede yoksa (arama/filtre degisti vb.) sessizce
  // "Tümü"ne don - bos ekranda takili kalinmasin.
  useEffect(() => {
    if (selectedNeighborhood === 'all') return
    if (!neighborhoodGroups.some((group) => group.neighborhood === selectedNeighborhood)) {
      setSelectedNeighborhood('all')
    }
  }, [neighborhoodGroups, selectedNeighborhood])

  const openFile = (row: InvestigationFile) => {
    const query = new URLSearchParams()
    if (row.fileId) {
      query.set('fileId', row.fileId)
    } else if (row.fileNo && row.fileNo !== '-') {
      query.set('search', row.fileNo)
    }

    addTab({
      title: row.fileNo && row.fileNo !== '-' ? `Dosya ${row.fileNo}` : 'Dosya Ara',
      path: query.toString() ? `/documents?${query.toString()}` : '/documents',
    })
  }

  const openReportModal = (row: InvestigationFile) => {
    const query = new URLSearchParams()
    if (row.fileId) {
      query.set('fileId', row.fileId)
      sessionStorage.setItem('netsosyal:tahkikat-evaluation-request', row.fileId)
    } else if (row.fileNo && row.fileNo !== '-') {
      query.set('search', row.fileNo)
    }
    query.set('openEvaluation', '1')
    query.set('workflow', 'tahkikat')

    addTab({
      title: row.fileNo && row.fileNo !== '-' ? `Inceleme ${row.fileNo}` : 'Inceleme Formu',
      path: `/documents?${query.toString()}`,
    })
  }

  const closeReportModal = () => {
    if (reportStatus === 'saving') return
    setReportTarget(null)
    setReportError('')
  }

  const saveReport = async () => {
    if (!reportTarget) return

    if (!reportForm.date || !reportForm.title.trim() || !reportForm.content.trim()) {
      setReportError('Tarih, konu ve rapor alanlari zorunludur.')
      return
    }

    setReportStatus('saving')
    setReportError('')
    try {
      const response = await fetch('/api/workflow/tahkikat/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: reportTarget.fileId,
          date: reportForm.date,
          title: reportForm.title,
          content: reportForm.content,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Rapor kaydedilemedi.')
      }

      setReportTarget(null)
      setReportForm({ date: getTodayInputDate(), title: '', content: '' })
      await loadRows()
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Rapor kaydedilirken hata olustu.')
    } finally {
      setReportStatus('idle')
    }
  }

  // Kullanici istegi (2026-10-08): bir personel sekmesine tiklaninca liste o
  // gorevliye daralir; eger tiklanan sekme OTURUM SAHIBININ KENDISIYSE, ona
  // ozel atanmis ve henuz gorulmemis dosyalar "gorundu" isaretlenir (bildirim
  // rozeti kaybolur) - baskasinin sekmesine bakmak onun bildirimini silmez.
  const handleSelectPersonnel = (id: string) => {
    setSelectedPersonnelId(id)
    if (id !== 'all' && id === currentUserId) {
      fetch('/api/workflow/tahkikat/mark-seen', { method: 'POST' })
        .then(() => void loadPersonnel())
        .catch(() => {})
    }
  }

  const openAssignModal = (row: InvestigationFile) => {
    setAssignTarget(row)
    setAssignSelectedUserId(row.assignedUserId || '')
    setAssignError('')
  }

  const closeAssignModal = () => {
    if (assignStatus === 'saving') return
    setAssignTarget(null)
    setAssignError('')
  }

  const saveAssignment = async () => {
    if (!assignTarget) return

    setAssignStatus('saving')
    setAssignError('')
    try {
      const response = await fetch('/api/workflow/tahkikat/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: assignTarget.fileId,
          userId: assignSelectedUserId || null,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Atama kaydedilemedi.')
      }

      setAssignTarget(null)
      await loadRows()
      await loadPersonnel()
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Atama kaydedilirken hata olustu.')
    } finally {
      setAssignStatus('idle')
    }
  }

  return (
    <div className="space-y-5 text-slate-950">
      <div className="relative overflow-hidden rounded-lg border border-orange-200 bg-white px-5 py-4 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-orange-500 to-[#0076b6]" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[13px] lg:text-[17px] font-black uppercase tracking-wide text-orange-700">Is Akisi</p>
            <h1 className="mt-1 text-[22px] font-black leading-tight tracking-normal text-slate-950 lg:text-[34px]">{workflowLabel} Dosyaları</h1>
            <p className="mt-1 text-[13px] lg:text-[17px] font-bold text-slate-500">Dosya durumu {workflowLabelLower} olan kayıtlar</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Kullanici istegi: bu kutucuklar tiklanabilir birer filtre -
                hangisine tiklanirsa alttaki liste SADECE o gruba gore
                filtrelenir; secili olan halka (ring) ile vurgulanir. */}
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-md border px-4 py-2 text-[13px] lg:text-[17px] font-black shadow-sm transition ${
                statusFilter === 'all'
                  ? 'border-orange-500 bg-orange-100 text-orange-900 ring-2 ring-orange-300'
                  : 'border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100'
              }`}
            >
              Toplam {searchFilteredRows.length} kayıt
            </button>
            {/* Kullanici istegi (13 Eylul 2026): "hangi mahallede kaç dosya
                tahkikat yapılacak üstte özet olarak da görünsün". */}
            <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-[13px] lg:text-[17px] font-black text-sky-800 shadow-sm">
              {neighborhoodGroups.length} mahalleden {personnelFilteredRows.length} dosya
            </div>
            {statusSummary.withActiveAid > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter((prev) => (prev === 'withActiveAid' ? 'all' : 'withActiveAid'))}
                className={`rounded-md border px-3 py-2 text-[13px] lg:text-[17px] font-black shadow-sm transition ${
                  statusFilter === 'withActiveAid'
                    ? 'border-emerald-600 bg-emerald-100 text-emerald-900 ring-2 ring-emerald-300'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {statusSummary.withActiveAid} aktif yardımlı
              </button>
            )}
            {statusSummary.withoutActiveAid > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter((prev) => (prev === 'withoutActiveAid' ? 'all' : 'withoutActiveAid'))}
                className={`rounded-md border px-3 py-2 text-[13px] lg:text-[17px] font-black shadow-sm transition ${
                  statusFilter === 'withoutActiveAid'
                    ? 'border-slate-500 bg-slate-200 text-slate-900 ring-2 ring-slate-300'
                    : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {statusSummary.withoutActiveAid} yardımsız
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[13px] lg:text-[17px] font-black uppercase text-[#005f95]">{workflowLabel} Listesi</h2>
            <p className="mt-1 text-[13px] lg:text-[17px] font-bold text-slate-500">Dosya no, sahip bilgisi, kullanici, tarih ve aciklama</p>
          </div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Dosya no, ad soyad, aciklama veya kullanici ara..."
            className="h-9 w-full rounded-md border border-slate-200 px-3 text-[13px] lg:text-[17px] font-bold text-slate-950 outline-none transition focus:border-[#0076b6] md:w-[420px]"
          />
        </div>

        {/* Kullanici istegi (2026-10-08): "tahkikat personelinin sekmesi
            olsun, yönetici özel olarak bir dosyayı istediği tahkikat
            görevlisine direk atayabilsin, atanan özel bir dosya var ise
            sekme üzerinde bildirim versin". Personel listesi bos donerse
            (henuz kimse "/workflow/tahkikat" yetkisine sahip degilse) satir
            hic gosterilmez. */}
        {!isPreliminaryReview && canAssign && personnel.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            <span className="mr-1 text-[11px] font-black uppercase tracking-wide text-slate-400 lg:text-[14px]">Görevli:</span>
            <button
              type="button"
              onClick={() => handleSelectPersonnel('all')}
              className={`rounded-full border px-3 py-1 text-[13px] lg:text-[17px] font-black transition ${selectedPersonnelId === 'all' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Tümü
            </button>
            {personnel.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => handleSelectPersonnel(person.id)}
                className={`relative rounded-full border px-3 py-1 text-[13px] lg:text-[17px] font-black transition ${selectedPersonnelId === person.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {person.name} ({person.assignedCount})
                {person.unseenCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-rose-600 px-1 text-[10px] font-black text-white">
                    {person.unseenCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Kullanici istegi (13 Eylul 2026): "mahalleye göre gruplayalım" -
            mahalle secici chip listesi, her chip'te o mahallenin dosya
            sayisi (ön inceleme sayfasindaki AYNI desen). */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setSelectedNeighborhood('all')}
            className={`rounded-full border px-3 py-1 text-[13px] lg:text-[17px] font-black transition ${selectedNeighborhood === 'all' ? 'border-[#0076b6] bg-[#0076b6] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Tümü ({personnelFilteredRows.length})
          </button>
          {neighborhoodGroups.map((group) => (
            <button
              key={group.neighborhood}
              type="button"
              onClick={() => setSelectedNeighborhood(group.neighborhood)}
              className={`rounded-full border px-3 py-1 text-[13px] lg:text-[17px] font-black transition ${selectedNeighborhood === group.neighborhood ? 'border-[#0076b6] bg-[#0076b6] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {group.neighborhood} ({group.files.length})
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {/* Kullanici istegi (2026-10-08): "mobil görünümde... daha profesyonel
          ve anlaşılır yapalım" - ekran goruntusunde uygulama kabugu (hamburger
          menu, bkz. header.tsx) ZATEN mobil moddaydı (lg altinda) ama bu
          sayfanin kart/tablo esigi hala "md" idi (768px) - 768-1024px
          arasindaki (ör. tablet, yatay telefon) genislikte kabuk mobil
          gorunurken bu sayfa hala sikisik MASAUSTU TABLOSUNU gosteriyordu.
          Esik artik kabukla AYNI (lg, 1024px) - uygulamanin her yerinde
          "mobil" ayni genislikte baslıyor. */}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 p-3 lg:hidden">
          {status === 'loading' ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-8 text-center text-sm font-bold text-slate-500">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-orange-300 border-t-orange-600" />
              {workflowLabel} dosyaları yükleniyor...
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-8 text-center text-sm font-bold text-slate-500">
              {selectedNeighborhood === 'all' ? `${workflowLabel} durumunda dosya bulunamadı.` : `${selectedNeighborhood} mahallesinde ${workflowLabelLower} durumunda dosya bulunamadı.`}
            </div>
          ) : selectedNeighborhood === 'all' ? (
            neighborhoodGroups.map((group, groupIndex) => (
              <div key={`grup-m-${group.neighborhood}`} className="space-y-2">
                <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#0a3a57] via-[#0d4f6e] to-[#0076b6] px-2.5 py-1.5 shadow-sm">
                  <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[9px] font-black text-white ring-1 ring-white/25">{groupIndex + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-black uppercase tracking-wide text-white">{group.neighborhood}</span>
                  <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/25">{group.files.length} dosya</span>
                  {group.files[0]?.statusDate && (
                    <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">En eski: {formatDate(group.files[0].statusDate)}</span>
                  )}
                </div>
                {group.files.map((row) => (
                  <TahkikatMobileCard key={row.fileId} row={row} workflowLabel={workflowLabel} canAssign={canAssign} onOpenFile={openFile} onOpenReport={openReportModal} onAssign={openAssignModal} />
                ))}
              </div>
            ))
          ) : (
            displayedRows.map((row) => (
              <TahkikatMobileCard key={row.fileId} row={row} workflowLabel={workflowLabel} canAssign={canAssign} onOpenFile={openFile} onOpenReport={openReportModal} onAssign={openAssignModal} />
            ))
          )}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1520px] border-collapse text-left text-[17px]">
            <thead className="bg-orange-50 text-[17px] font-black uppercase text-orange-900">
              <tr>
                <th className="border-b border-orange-100 px-4 py-3">Dosya No</th>
                <th className="border-b border-orange-100 px-4 py-3">Dosya Sahibi</th>
                <th className="border-b border-orange-100 px-4 py-3">Telefon</th>
                <th className="border-b border-orange-100 px-4 py-3">Mahalle</th>
                <th className="border-b border-orange-100 px-4 py-3">Adres</th>
                <th className="border-b border-orange-100 px-4 py-3">{workflowLabel} Tarihi</th>
                <th className="border-b border-orange-100 px-4 py-3">Son Güncelleme</th>
                <th className="border-b border-orange-100 px-4 py-3">{workflowLabel} Kullanıcısı</th>
                <th className="border-b border-orange-100 px-4 py-3">Atanan Görevli</th>
                <th className="border-b border-orange-100 px-4 py-3">Aciklama</th>
                <th className="border-b border-orange-100 px-4 py-3 text-right">Islem</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' ? (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <span className="h-7 w-7 animate-spin rounded-full border-2 border-orange-300 border-t-orange-600" />
                      {workflowLabel} dosyaları yükleniyor...
                    </div>
                  </td>
                </tr>
              ) : displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    {selectedNeighborhood === 'all' ? `${workflowLabel} durumunda dosya bulunamadı.` : `${selectedNeighborhood} mahallesinde ${workflowLabelLower} durumunda dosya bulunamadı.`}
                  </td>
                </tr>
              ) : selectedNeighborhood === 'all' ? (
                neighborhoodGroups.map((group, groupIndex) => (
                  <Fragment key={`grup-${group.neighborhood}`}>
                    <tr>
                      <td colSpan={11} className="bg-gradient-to-r from-[#0a3a57] via-[#0d4f6e] to-[#0076b6] px-4 py-2.5 shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-black text-white ring-1 ring-white/25">{groupIndex + 1}</span>
                          <span className="text-[17px] font-black uppercase tracking-wide text-white">{group.neighborhood}</span>
                          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[17px] font-black text-white ring-1 ring-white/25">{group.files.length} dosya</span>
                          {group.files[0]?.statusDate && (
                            <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[17px] font-black text-amber-950">En eski {workflowLabelLower} tarihi: {formatDate(group.files[0].statusDate)}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {group.files.map((row, index) => (
                      <TahkikatTableRow key={row.fileId} row={row} index={index} workflowLabel={workflowLabel} canAssign={canAssign} onOpenFile={openFile} onOpenReport={openReportModal} onAssign={openAssignModal} />
                    ))}
                  </Fragment>
                ))
              ) : (
                displayedRows.map((row, index) => (
                  <TahkikatTableRow key={row.fileId} row={row} index={index} workflowLabel={workflowLabel} canAssign={canAssign} onOpenFile={openFile} onOpenReport={openReportModal} onAssign={openAssignModal} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reportTarget && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/70 p-2 backdrop-blur-sm md:p-4">
          <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-orange-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-orange-100 bg-orange-50 px-4 py-3 md:px-5 md:py-4">
              <div>
                <h3 className="text-[17px] font-black text-orange-900">Rapor Ekle</h3>
                <p className="mt-0.5 text-[17px] font-bold uppercase text-orange-700">
                  {reportTarget.fileNo} - {reportTarget.applicantName}
                </p>
              </div>
              <button
                type="button"
                onClick={closeReportModal}
                disabled={reportStatus === 'saving'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-wait disabled:opacity-60"
              >
                x
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
              {reportError && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[17px] font-bold text-rose-700">
                  {reportError}
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-[17px] font-extrabold uppercase text-slate-600">Tarih</span>
                <input
                  type="date"
                  value={reportForm.date}
                  onChange={(event) => setReportForm((current) => ({ ...current, date: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[17px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[17px] font-extrabold uppercase text-slate-600">Konu</span>
                <select
                  value={reportForm.title}
                  onChange={(event) => setReportForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[17px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                >
                  <option value="">Seciniz</option>
                  {reportForm.title && !investigationSubjectOptions.some((option) => option.name === reportForm.title) && (
                    <option value={reportForm.title}>{reportForm.title}</option>
                  )}
                  {investigationSubjectOptions.map((option) => (
                    <option key={option.id} value={option.name}>{option.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[17px] font-extrabold uppercase text-slate-600">Rapor</span>
                <textarea
                  value={reportForm.content}
                  onChange={(event) => setReportForm((current) => ({ ...current, content: event.target.value }))}
                  rows={8}
                  className="min-h-[220px] w-full resize-none rounded-lg border border-slate-200 px-3 py-1.5 text-[17px] font-bold text-slate-950 outline-none focus:border-[#0076b6] md:min-h-0"
                  placeholder="Ev ziyareti raporu..."
                />
              </label>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 md:px-5 md:py-4">
              <button
                type="button"
                onClick={closeReportModal}
                disabled={reportStatus === 'saving'}
                className="rounded border border-slate-200 bg-white px-4 py-1.5 text-[17px] font-extrabold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                Vazgec
              </button>
              <button
                type="button"
                onClick={() => void saveReport()}
                disabled={reportStatus === 'saving'}
                className="rounded border border-orange-600 bg-orange-600 px-5 py-1.5 text-[17px] font-extrabold text-white shadow-sm hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60"
              >
                {reportStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignTarget && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/70 p-2 backdrop-blur-sm md:p-4">
          <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-indigo-100 bg-indigo-50 px-4 py-3 md:px-5 md:py-4">
              <div>
                <h3 className="text-[14px] font-black text-indigo-900">Tahkikat Görevlisi Ata</h3>
                <p className="mt-0.5 text-[14px] font-bold uppercase text-indigo-700">
                  {assignTarget.fileNo} - {assignTarget.applicantName}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAssignModal}
                disabled={assignStatus === 'saving'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-wait disabled:opacity-60"
              >
                x
              </button>
            </div>

            <div className="space-y-4 p-4 md:p-5">
              {assignError && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-700">
                  {assignError}
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] font-extrabold uppercase text-slate-600">Tahkikat Görevlisi</span>
                <select
                  value={assignSelectedUserId}
                  onChange={(event) => setAssignSelectedUserId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[14px] font-bold text-slate-950 outline-none focus:border-indigo-500"
                >
                  <option value="">Atanmadı (boş bırak)</option>
                  {personnel.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 md:px-5 md:py-4">
              <button
                type="button"
                onClick={closeAssignModal}
                disabled={assignStatus === 'saving'}
                className="rounded border border-slate-200 bg-white px-4 py-1.5 text-[14px] font-extrabold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                Vazgec
              </button>
              <button
                type="button"
                onClick={() => void saveAssignment()}
                disabled={assignStatus === 'saving'}
                className="rounded border border-indigo-600 bg-indigo-600 px-5 py-1.5 text-[14px] font-extrabold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
              >
                {assignStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
