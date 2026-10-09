'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import {
  PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY,
  normalizePreliminaryReviewFieldType,
  type PreliminaryReviewFormTemplate,
} from '@/lib/constants/preliminaryReviewForm'
import {
  UPDATE_FORM_TEMPLATE_SETTING_KEY,
  type UpdateFormTemplate,
} from '@/lib/constants/updateForm'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  findPredefinedCategoryByCandidates,
  normalizePredefinedText,
  type PredefinedValuesMap,
  type PredefinedValueTitlesMap,
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
}

interface SettingResponse<T> {
  success: boolean
  data?: {
    value?: T
  }
  error?: string
}

type GuncellemeFormuRecord = {
  id: string
  dosyaid: string | null
  formTarihi: string | null
  cevaplar: Record<string, string | string[]>
  aciklama: string | null
  islemtarihi: string | null
}

interface GuncellemeFormuListResponse {
  success: boolean
  data?: GuncellemeFormuRecord[]
  error?: string
}

interface PredefinedValuesResponse {
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

// Dosya "Ön İnceleme Yapılmış" durumuna alınırken (Dosya Durumu ekranından) doldurulan
// Güncelleme Formu'ndaki secimleri, secenek id'lerinden okunabilir etiketlere cevirir.
function resolveUpdateFormAnswers(template: UpdateFormTemplate, cevaplar: Record<string, string | string[]>) {
  return template
    .map((section) => {
      const selected = cevaplar[section.id]
      const selectedIds = Array.isArray(selected) ? selected : selected ? [selected] : []
      const labels = selectedIds
        .map((optionId) => section.options.find((option) => option.id === optionId)?.label)
        .filter((label): label is string => Boolean(label))

      return { title: section.title, labels }
    })
    .filter((item) => item.labels.length > 0)
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

// Duz liste ve mahalleye-gore-gruplu liste AYNI satir gorunumunu
// kullansin diye ayri bir bilesene cikarildi (kullanici istegi
// 13 Eylul 2026: mahalleye gore gruplama + telefon/mahalle/adres).
function OnIncelemeTableRow({ row, index, onOpenFile, onOpenReport }: {
  row: InvestigationFile
  index: number
  onOpenFile: (row: InvestigationFile) => void
  onOpenReport: (row: InvestigationFile) => void
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
        <span className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-800 ring-1 ring-orange-200">
          {row.userName}
        </span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-700">
        <span className="line-clamp-2 block max-w-[280px]">{row.statusDescription}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onOpenReport(row)}
          className="inline-flex items-center rounded-md border border-[#0076b6] bg-white px-3 py-2 text-xs font-black uppercase text-[#005f95] shadow-sm transition hover:bg-sky-50"
        >
          Rapor Ekle
        </button>
      </td>
    </tr>
  )
}

function OnIncelemeMobileCard({ row, onOpenFile, onOpenReport }: {
  row: InvestigationFile
  onOpenFile: (row: InvestigationFile) => void
  onOpenReport: (row: InvestigationFile) => void
}) {
  return (
    <div className="rounded-lg border border-orange-100 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenFile(row)}
            className="text-[15px] font-black text-[#0076b6] underline-offset-2 hover:underline"
          >
            Dosya {row.fileNo}
          </button>
          <div className="mt-1 line-clamp-2 text-sm font-black uppercase leading-snug text-slate-950">{row.applicantName}</div>
        </div>
        <button
          type="button"
          onClick={() => onOpenReport(row)}
          className="shrink-0 rounded-md border border-[#0076b6] bg-[#0076b6] px-3 py-2 text-[11px] font-black uppercase text-white shadow-sm"
        >
          Rapor
        </button>
      </div>
      <div className="mt-2 space-y-1 rounded-md bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-700">
        <div><span className="text-[9px] font-black uppercase text-slate-400">Telefon: </span>{row.phone}</div>
        <div><span className="text-[9px] font-black uppercase text-slate-400">Mahalle: </span>{row.neighborhood}</div>
        <div className="line-clamp-2"><span className="text-[9px] font-black uppercase text-slate-400">Adres: </span>{row.address}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
        <div className="rounded-md bg-orange-50 px-2 py-1.5 text-orange-900">
          <div className="text-[9px] font-black uppercase text-orange-600">Ön İnceleme</div>
          {formatDate(row.statusDate)}
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5 text-slate-700">
          <div className="text-[9px] font-black uppercase text-slate-400">Güncelleme</div>
          {formatDateTime(row.updatedAt)}
        </div>
      </div>
      <div className="mt-2 inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-black text-orange-800 ring-1 ring-orange-200">
        {row.userName}
      </div>
      {/* Kullanici istegi (13 Eylul 2026): Sonuç Bekleyen mobil kartindaki
          gibi - rapor/aciklama metni artik kirpilmiyor, fontu buyutuldu.
          Masaustu tabloya (OnIncelemeTableRow) DOKUNULMADI, sadece bu mobil
          kart. */}
      <p className="mt-2 whitespace-pre-wrap text-[14px] font-semibold leading-relaxed text-slate-800">{row.statusDescription}</p>
    </div>
  )
}

export default function OnIncelemeWorkflowPage() {
  const [rows, setRows] = useState<InvestigationFile[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  // Kullanici istegi (13 Eylul 2026, 2. tur): telefon/mahalle/adres artik
  // HER ZAMAN gorunuyor (ayri bir ac/kapa dugmesine gerek kalmadi);
  // "kullanici hangi grubu secerse onlari gorsun" - mahalleye gore
  // GRUPLAMA yerine bir mahalle SECICI (chip listesi) kullaniliyor:
  // "Tümü" tum mahalleleri gruplu gosterir, bir mahalle secilince liste
  // SADECE o mahalledeki dosyalara daralir.
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string>('all')
  const [reportTarget, setReportTarget] = useState<InvestigationFile | null>(null)
  const [reportDate, setReportDate] = useState(getTodayInputDate())
  const [reportAnswers, setReportAnswers] = useState<Record<string, string>>({})
  const [reportDescription, setReportDescription] = useState('')
  const [reportStatus, setReportStatus] = useState<'idle' | 'saving'>('idle')
  const [reportError, setReportError] = useState('')
  const [formFields, setFormFields] = useState<PreliminaryReviewFormTemplate>([])
  const [formFieldsStatus, setFormFieldsStatus] = useState<'loading' | 'ready'>('loading')
  const [updateFormTemplate, setUpdateFormTemplate] = useState<UpdateFormTemplate>([])
  const [updateFormRecord, setUpdateFormRecord] = useState<GuncellemeFormuRecord | null>(null)
  const [updateFormRecordStatus, setUpdateFormRecordStatus] = useState<'loading' | 'ready'>('loading')
  const [notSuitableStatusId, setNotSuitableStatusId] = useState<string | null>(null)
  const { addTab } = useTabs()

  async function loadRows(isCancelled?: () => boolean) {
    setStatus('loading')
    setError('')
    try {
      const response = await fetch('/api/workflow-preliminary-review', { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Ön inceleme dosyaları alınamadı.')
      }

      if (!isCancelled?.()) {
        setRows(payload.data ?? [])
        setStatus('ready')
      }
    } catch (err) {
      if (!isCancelled?.()) {
        setError(err instanceof Error ? err.message : 'Ön inceleme listesi yüklenirken hata oluştu.')
        setStatus('error')
      }
    }
  }

  useEffect(() => {
    let isCancelled = false
    void loadRows(() => isCancelled)
    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    fetch(`/api/settings/${PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: SettingResponse<PreliminaryReviewFormTemplate>) => {
        if (isCancelled) return
        if (payload.success && Array.isArray(payload.data?.value)) {
          setFormFields(payload.data!.value!)
        }
      })
      .catch(() => {
        // Sorular alinamazsa bos liste ile devam edilir; asagida uyari gosterilir.
      })
      .finally(() => {
        if (!isCancelled) setFormFieldsStatus('ready')
      })

    return () => {
      isCancelled = true
    }
  }, [])

  // Dosyayi "Ön İnceleme Yapılmış" durumuna alan kullanicinin doldurdugu Guncelleme
  // Formu'ndaki secenek etiketlerini gosterebilmek icin form sablonunu (soru/cevap
  // basliklari) bir kez yukluyoruz.
  useEffect(() => {
    let isCancelled = false

    fetch(`/api/settings/${UPDATE_FORM_TEMPLATE_SETTING_KEY}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: SettingResponse<UpdateFormTemplate>) => {
        if (isCancelled) return
        if (payload.success && Array.isArray(payload.data?.value)) {
          setUpdateFormTemplate(payload.data!.value!)
        }
      })
      .catch(() => {
        // Sablon alinamazsa Guncelleme Formu ozeti gosterilmez, rapor formu normal calisir.
      })

    return () => {
      isCancelled = true
    }
  }, [])

  // "İncelemeye Uygun Değil" butonunun hangi dosya durumuna atlayacagini bulur -
  // sabit bir numara varsaymak yerine Ayarlar > Hazir Degerler > Dosya Durumu
  // listesindeki etikete gore (buyuk/kucuk harf ve Turkce karakterden bagimsiz)
  // eslesme arar; documents sayfasindaki ayni yaklasimla tutarlidir.
  useEffect(() => {
    let isCancelled = false

    fetch('/api/predefined-values', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: PredefinedValuesResponse) => {
        if (isCancelled) return
        if (!payload.success || !payload.data) throw new Error(payload.error || 'Hazir degerler alinamadi.')

        const options = findPredefinedOptions(payload.data.values, payload.data.titles, ['dosya durumu', 'ddurumu', 'dosyadurumu'])
        const match = options.find((option) => normalizePredefinedText(option.name).includes('yardimyapilamaz'))
        setNotSuitableStatusId(match?.id ?? null)
      })
      .catch(() => {
        if (isCancelled) return
        const options = findPredefinedOptions(DEFAULT_PREDEFINED_VALUES, DEFAULT_PREDEFINED_VALUE_TITLES, ['dosya durumu', 'ddurumu', 'dosyadurumu'])
        const match = options.find((option) => normalizePredefinedText(option.name).includes('yardimyapilamaz'))
        setNotSuitableStatusId(match?.id ?? null)
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const filteredRows = useMemo(() => {
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

  // Kullanici istegi (13 Eylul 2026): "kaç mahalleden kaç dosyaya ön
  // inceleme yapılacak üstte özet olarak da görünsün" + mahalleye göre
  // gruplama.
  const neighborhoodGroups = useMemo(() => {
    const map = new Map<string, InvestigationFile[]>()
    for (const row of filteredRows) {
      const key = row.neighborhood || 'Belirtilmemiş'
      const list = map.get(key)
      if (list) list.push(row)
      else map.set(key, [row])
    }
    return [...map.entries()]
      .map(([neighborhood, files]) => ({ neighborhood, files }))
      .sort((a, b) => b.files.length - a.files.length || a.neighborhood.localeCompare(b.neighborhood, 'tr-TR'))
  }, [filteredRows])

  // Secilen mahalleye gore daraltilmis liste - "Tümü" iken tum kayitlar
  // (gruplu gosterilecek), bir mahalle secilince SADECE o mahalledekiler.
  const displayedRows = useMemo(() => {
    if (selectedNeighborhood === 'all') return filteredRows
    return filteredRows.filter((row) => (row.neighborhood || 'Belirtilmemiş') === selectedNeighborhood)
  }, [filteredRows, selectedNeighborhood])

  // Secilen mahalle artik listede yoksa (arama sonucu degisti vb.) sessizce
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
    setReportTarget(row)
    setReportDate(getTodayInputDate())
    setReportAnswers({})
    setReportDescription('')
    setReportError('')
    setUpdateFormRecord(null)
    setUpdateFormRecordStatus('loading')

    // Dosyayi ön incelemeye alan kullanicinin Guncelleme Formu'nda yazdigi bilgileri
    // ve aciklamayi rapor formunun ustunde gosterebilmek icin en son kaydi cekiyoruz.
    fetch(`/api/documents/guncelleme-formu?dosyaId=${encodeURIComponent(row.fileId)}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: GuncellemeFormuListResponse) => {
        if (payload.success && Array.isArray(payload.data) && payload.data.length > 0) {
          setUpdateFormRecord(payload.data[0])
        }
      })
      .catch(() => {
        // Guncelleme formu bulunamazsa ozet bolumu gosterilmez, rapor formu normal calisir.
      })
      .finally(() => {
        setUpdateFormRecordStatus('ready')
      })
  }

  const closeReportModal = () => {
    if (reportStatus === 'saving') return
    setReportTarget(null)
    setReportError('')
  }

  // Raporu (cevaplar + aciklama) kaydeder ve dosya durumunu nextStatus'a gunceller.
  // nextStatus verilmezse rota varsayilan olarak dosyayi "Tahkikat"e (durumu = 1)
  // gecirir; "İncelemeye Uygun Değil" akisinda "Yardım Yapılamaz" durum kodu gonderilir.
  const submitReport = async (nextStatus?: string) => {
    if (!reportTarget) return

    if (!reportDate) {
      setReportError('Tarih bilgisi zorunludur.')
      return
    }

    setReportStatus('saving')
    setReportError('')
    try {
      const response = await fetch('/api/workflow/on-inceleme/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: reportTarget.fileId,
          date: reportDate,
          cevaplar: reportAnswers,
          aciklama: reportDescription,
          ...(nextStatus ? { nextStatus } : {}),
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Rapor kaydedilemedi.')
      }

      setReportTarget(null)
      await loadRows()
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Rapor kaydedilirken hata oluştu.')
    } finally {
      setReportStatus('idle')
    }
  }

  const saveReport = () => {
    void submitReport()
  }

  const handleMarkNotSuitable = () => {
    if (!reportDescription.trim()) {
      setReportError('İncelemeye uygun olmama gerekçesini açıklama alanına yazmalısınız.')
      return
    }

    if (!notSuitableStatusId) {
      setReportError('"Yardım Yapılamaz" dosya durumu tanımlı değil. Ayarlar > Hazır Değerler > Dosya Durumu listesine eklemelisiniz.')
      return
    }

    void submitReport(notSuitableStatusId)
  }

  return (
    <div className="space-y-5 text-slate-950">
      <div className="relative overflow-hidden rounded-lg border border-orange-200 bg-white px-5 py-4 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-orange-500 to-[#0076b6]" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[12px] font-black uppercase tracking-wide text-orange-700">İş Akışı</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-[34px]">Ön İnceleme Dosyaları</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">Dosya durumu ön inceleme olan kayıtlar</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-800 shadow-sm">
              Toplam {filteredRows.length} kayıt
            </div>
            {/* Kullanici istegi (13 Eylul 2026): "kaç mahalleden kaç dosyaya
                ön inceleme yapılacak üstte özet olarak da görünsün". */}
            <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-black text-sky-800 shadow-sm">
              {neighborhoodGroups.length} mahalleden {filteredRows.length} dosya
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-black uppercase text-[#005f95]">Ön İnceleme Listesi</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">Dosya no, sahip bilgisi, telefon, mahalle, adres, kullanıcı, tarih ve açıklama</p>
          </div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Dosya no, ad soyad, telefon, mahalle, adres, açıklama veya kullanıcı ara..."
            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-950 outline-none transition focus:border-[#0076b6] md:w-[420px]"
          />
        </div>

        {/* Kullanici istegi (13 Eylul 2026, 2. tur): "listeyi mahallelere
            göre gruplasın, kullanıcı hangi grubu seçerse onları görsün, kaç
            mahalleden kaç ön inceleme var sayısını göstersin" - mahalle
            secici chip listesi, her chip'te o mahallenin dosya sayisi. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setSelectedNeighborhood('all')}
            className={`rounded-full border px-3 py-1 text-xs font-black transition ${selectedNeighborhood === 'all' ? 'border-[#0076b6] bg-[#0076b6] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Tümü ({filteredRows.length})
          </button>
          {neighborhoodGroups.map((group) => (
            <button
              key={group.neighborhood}
              type="button"
              onClick={() => setSelectedNeighborhood(group.neighborhood)}
              className={`rounded-full border px-3 py-1 text-xs font-black transition ${selectedNeighborhood === group.neighborhood ? 'border-[#0076b6] bg-[#0076b6] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
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

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 p-3 md:hidden">
          {status === 'loading' ? (
            <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-8 text-center text-sm font-bold text-slate-500">
              Ön inceleme dosyaları yükleniyor...
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-8 text-center text-sm font-bold text-slate-500">
              {selectedNeighborhood === 'all' ? 'Ön inceleme durumunda dosya bulunamadı.' : `${selectedNeighborhood} mahallesinde ön inceleme durumunda dosya bulunamadı.`}
            </div>
          ) : selectedNeighborhood === 'all' ? (
            neighborhoodGroups.map((group) => (
              <div key={`grup-m-${group.neighborhood}`} className="space-y-2">
                <div className="rounded-md bg-sky-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-sky-900">
                  {group.neighborhood} — {group.files.length} dosya
                </div>
                {group.files.map((row) => (
                  <OnIncelemeMobileCard key={row.fileId} row={row} onOpenFile={openFile} onOpenReport={openReportModal} />
                ))}
              </div>
            ))
          ) : (
            displayedRows.map((row) => (
              <OnIncelemeMobileCard key={row.fileId} row={row} onOpenFile={openFile} onOpenReport={openReportModal} />
            ))
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1520px] border-collapse text-left text-sm">
            <thead className="bg-orange-50 text-[12px] font-black uppercase text-orange-900">
              <tr>
                <th className="border-b border-orange-100 px-4 py-3">Dosya No</th>
                <th className="border-b border-orange-100 px-4 py-3">Dosya Sahibi</th>
                <th className="border-b border-orange-100 px-4 py-3">Telefon</th>
                <th className="border-b border-orange-100 px-4 py-3">Mahalle</th>
                <th className="border-b border-orange-100 px-4 py-3">Adres</th>
                <th className="border-b border-orange-100 px-4 py-3">Ön İnceleme Tarihi</th>
                <th className="border-b border-orange-100 px-4 py-3">Son Güncelleme</th>
                <th className="border-b border-orange-100 px-4 py-3">Kullanıcı</th>
                <th className="border-b border-orange-100 px-4 py-3">Açıklama</th>
                <th className="border-b border-orange-100 px-4 py-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    Ön inceleme dosyaları yükleniyor...
                  </td>
                </tr>
              ) : displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    {selectedNeighborhood === 'all' ? 'Ön inceleme durumunda dosya bulunamadı.' : `${selectedNeighborhood} mahallesinde ön inceleme durumunda dosya bulunamadı.`}
                  </td>
                </tr>
              ) : selectedNeighborhood === 'all' ? (
                neighborhoodGroups.map((group) => (
                  <Fragment key={`grup-${group.neighborhood}`}>
                    <tr className="bg-sky-100">
                      <td colSpan={10} className="px-4 py-2 text-[12px] font-black uppercase tracking-wide text-sky-900">
                        {group.neighborhood} — {group.files.length} dosya
                      </td>
                    </tr>
                    {group.files.map((row, index) => (
                      <OnIncelemeTableRow key={row.fileId} row={row} index={index} onOpenFile={openFile} onOpenReport={openReportModal} />
                    ))}
                  </Fragment>
                ))
              ) : (
                displayedRows.map((row, index) => (
                  <OnIncelemeTableRow key={row.fileId} row={row} index={index} onOpenFile={openFile} onOpenReport={openReportModal} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reportTarget && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/70 p-2 backdrop-blur-sm md:p-4">
          <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-orange-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-orange-100 bg-orange-50 px-4 py-3 md:px-5 md:py-4">
              <div>
                <h3 className="text-lg font-black text-orange-900">Ön İnceleme Raporu Ekle</h3>
                <p className="mt-0.5 text-xs font-bold uppercase text-orange-700">
                  {reportTarget.fileNo} - {reportTarget.applicantName}
                </p>
              </div>
              <button
                type="button"
                onClick={closeReportModal}
                disabled={reportStatus === 'saving'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-wait disabled:opacity-60"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
              {reportError && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                  {reportError}
                </div>
              )}

              {updateFormRecordStatus === 'loading' ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-3 text-center text-xs font-bold text-indigo-700">
                  Güncelleme formu bilgileri yükleniyor...
                </div>
              ) : updateFormRecord ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
                  <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-indigo-700">
                    Dosyayı Ön İncelemeye Alan Kullanıcının Güncelleme Formu Bilgileri
                  </p>
                  {(() => {
                    const resolvedAnswers = resolveUpdateFormAnswers(updateFormTemplate, updateFormRecord.cevaplar)
                    return resolvedAnswers.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {resolvedAnswers.map((item) => (
                          <div key={item.title} className="rounded-md border border-indigo-100 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase text-indigo-500">{item.title}</div>
                            <div className="text-sm font-bold text-slate-800">{item.labels.join(', ')}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-500">Bu formda işaretlenmiş bir cevap bulunamadı.</p>
                    )
                  })()}
                  {updateFormRecord.aciklama && (
                    <div className="mt-2 rounded-md border border-indigo-100 bg-white px-3 py-2">
                      <div className="text-[10px] font-black uppercase text-indigo-500">Açıklama</div>
                      <p className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{updateFormRecord.aciklama}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500">
                  Bu dosya için kayıtlı bir Güncelleme Formu bulunamadı.
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold uppercase text-slate-600">Tarih</span>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                  className="w-full max-w-[220px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                />
              </label>

              {formFieldsStatus === 'loading' ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-500">
                  Sorular yükleniyor...
                </div>
              ) : formFields.length === 0 ? (
                <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-sm font-bold text-amber-800">
                  Ayarlar &gt; Sistem Ayarları &gt; &ldquo;Ön İnceleme Formu Tasarımı&rdquo; ekranından henüz soru
                  tanımlanmadı. Soru eklendikten sonra burada görünecektir.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {formFields.map((field) => (
                    <label key={field.id} className="flex flex-col gap-1.5">
                      <span className="text-xs font-extrabold uppercase text-slate-600">{field.label || 'Bilgi'}</span>
                      {normalizePreliminaryReviewFieldType(field) === 'var_yok' ? (
                        <select
                          value={reportAnswers[field.id] ?? ''}
                          onChange={(event) => setReportAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                        >
                          <option value="">Seçiniz</option>
                          <option value="Var">Var</option>
                          <option value="Yok">Yok</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={reportAnswers[field.id] ?? ''}
                          onChange={(event) => setReportAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                          placeholder={field.example || undefined}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold uppercase text-slate-600">Açıklama</span>
                <textarea
                  value={reportDescription}
                  onChange={(event) => setReportDescription(event.target.value)}
                  rows={4}
                  placeholder="Değerlendirme açıklaması yazın..."
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:justify-end md:px-5 md:py-4">
              <button
                type="button"
                onClick={closeReportModal}
                disabled={reportStatus === 'saving'}
                className="rounded border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleMarkNotSuitable}
                disabled={reportStatus === 'saving'}
                title="İncelemeye göndermeden dosyayı doğrudan 'Yardım Yapılamaz' durumuna alır"
                className="rounded border border-rose-600 bg-white px-4 py-2 text-sm font-extrabold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60"
              >
                İncelemeye Uygun Değil
              </button>
              <button
                type="button"
                onClick={saveReport}
                disabled={reportStatus === 'saving' || formFields.length === 0}
                className="rounded border border-orange-600 bg-orange-600 px-5 py-2 text-sm font-extrabold text-white shadow-sm hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60"
              >
                {reportStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
