'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  findPredefinedCategoryByCandidates,
  type PredefinedValue,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import { getKararRenk, KARAR_RENK_SINIFLARI } from '@/lib/constants/incelemeDegerlendirmeForm'
import {
  USER_PERMISSIONS_SETTING_KEY,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'

export const dynamic = 'force-dynamic'

// Kullanici istegi (14 Eylul 2026, 21. tur): "ev ziyareti raporunu sadece
// yetki verdigimiz kullanicilar gorebilsin, yetkisi kapali olan HICBIR
// SEKILDE goremesin". Asil guvenlik siniri API'da (requireApiAccess, bkz.
// app/api/home-visits/route.ts) - burada SADECE bu sayfadaki "Ev Ziyareti
// Raporlari" bolumunu yetkisiz kullanicidan gizlemek icin, documents/
// page.tsx'teki "canUseAction" ile BIREBIR AYNI mantik (bu sayfada daha
// once HICBIR action-bazli UI gizleme yoktu, o yuzden kucuk/bagimsiz bir
// kopya olarak eklendi - diger hicbir seye dokunmaz).
function computeCanViewHomeVisits(config: UserPermissionConfig | null): boolean {
  if (!config || config.isAdmin) return true
  if (config.isActive === false) return false
  if (!config.allowedActions?.length) return true
  return config.allowedActions.includes('documents.homeVisits.view')
}

type UpdateWorkflowFile = {
  fileId: string
  fileNo: string
  applicantName: string
  phone: string
  neighborhood: string
  address: string
  lastVisitDate: string | null
  lastVisitInfo: string
  visitUserName: string
  // Kullanici istegi (13 Eylul 2026): "bu alanda aynı zamanda en son yapılan
  // tahkikat raporu bilgiside görünsün" - en son Tahkikat Formu (inceleme_
  // degerlendirme_formu) kaydinin ozeti.
  lastTahkikatDate: string | null
  lastTahkikatKarar: string | null
  lastTahkikatPuan: number | null
  lastTahkikatMaksimumPuan: number | null
  lastTahkikatEliminasyon: string | null
}

type ServiceRecordKind = 'application' | 'assistance'

type AssistanceRow = {
  recordId: string
  sourceTable: string
  type: string
  date: string
  startDate: string
  endDate: string
  periodInfo: string
  label: string
  status: string
  amount: string
  description: string
}

type ApplicationRow = {
  recordId: string
  sourceTable: string
  type: string
  applicationDate: string
  startDate: string
  endDate: string
  period: string
  label: string
  stage: string
  status: string
  amount: string
  description: string
}

type ServiceRecordFormRow = {
  kind: ServiceRecordKind
  recordId: string
  sourceTable: string
  type: string
  date: string
  startDate: string
  endDate: string
  periodInfo: string
  label: string
  status: string
  amount: string
  description: string
  formDate: string
  formStartDate: string
  formEndDate: string
}

type IncelemeFormRecord = {
  id: string
  dosyaid: string | null
  formTarihi: string | null
  basvuruNo: string | null
  adSoyad: string | null
  tcKimlik: string | null
  telefon: string | null
  ilceMahalle: string | null
  adres: string | null
  haneKisiSayisi: string | number | null
  toplamGelir: string | number | null
  kisiBasiGelir: string | number | null
  toplamPuan: string | number | null
  otomatikSonuc: string | null
  sahaIncelemeOzeti: string | null
  ozelDurumGerekce: string | null
  komisyonKarari: string | null
  yardimTurleri: string[]
  yardimMiktarlari: Record<string, string | number | null>
  yardimSuresi: string | null
  inceleyenAdSoyad: string | null
  komisyonRaporu: string | null
  komisyonOnay: string | null
}

// Kullanici istegi (13 Eylul 2026): "sonuç bekleyen listesindeki kayıtlara
// kullanıcı girdiğinde en son yapılan tahkikat raporu özet bilgisi burada
// görünebilsin, karar verirken ev ziyareti raporunuda okuyabilsin" - bu iki
// tip, ASIL kullanilan (guncel) kaynaklardan gelir: Tahkikat Formu artik
// inceleme_degerlendirme_formu'na yaziyor (inceleme_formu DEGIL - o eski/
// yukaridaki IncelemeFormRecord dead sistem), Ev Ziyareti ise evziyareti
// tablosuna (hem eski "Ev Ziyareti Formu" girisinden hem de Tahkikat Formu
// kaydedilince otomatik eklenen ozetten, bkz. app/api/documents/inceleme-
// degerlendirme/route.ts POST).
type TahkikatFormOzet = {
  id: string
  tarih: string
  personel: string | null
  toplamPuan: number | null
  maksimumPuan: number
  karar: string | null
  yardimTuruOnerisi: string | null
  eliminasyonSonucu: 'KABUL' | 'RED' | null
  eliminasyonRedNedeni: string | null
  onayDurumu: string
}

type EvZiyaretiKaydi = {
  id: string
  requestId: string | null
  date: string | null
  title: string | null
  content: string | null
  userName?: string | null
}

type PredefinedValuesResponse = {
  success: boolean
  data?: {
    values: PredefinedValuesMap
    titles: PredefinedValueTitlesMap
  }
  error?: string
}

type QuickAssistanceType = 'Ekmek' | 'Gıda Bankası' | 'Destek Paketi' | 'Hazır Yemek'

const visibleServiceTables = new Set(['yrd_ekmek', 'yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_haziryemek'])

const serviceTypeLabels: Record<string, string> = {
  yrd_ekmek: 'Ekmek',
  yrd_gidabankasi: 'Gida',
  yrd_destekpaketi: 'Destek Paketi',
  yrd_haziryemek: 'Hazir Yemek',
}

const periodOptions = ['1 Ay', '2 Ay', '3 Ay', '4 Ay', '5 Ay', '6 Ay']
const quickAssistanceTypes: QuickAssistanceType[] = ['Ekmek', 'Gıda Bankası', 'Destek Paketi', 'Hazır Yemek']

function createDefaultQuickAssistanceForm() {
  const startDate = getTodayInputDate()

  return {
    type: 'Ekmek' as QuickAssistanceType,
    period: '1 Ay',
    startDate,
    endDate: addMonthsToInputDate(startDate, 1),
    amount: '1',
    breakfastAmount: '',
    description: '',
  }
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

function toInputDate(value: string) {
  if (!value || value === '-') return ''
  const trDate = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (trDate) {
    const [, day, month, year] = trDate
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function normalizeInputValue(value: string) {
  return value === '-' ? '' : value
}

function addMonthsToInputDate(value: string, months: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || months <= 0) return ''
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setMonth(date.getMonth() + months)

  if (Number.isNaN(date.getTime())) return ''

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function getPeriodMonthCount(value: string) {
  const match = value.match(/^(\d+)\s*Ay$/i)
  return match ? Number(match[1]) : 0
}

function getColumnWidth(values: string[], minimum: number, maximum = 28) {
  const longestValue = values.reduce((longest, value) => Math.max(longest, value.trim().length), 0)
  return `${Math.min(Math.max(longestValue + 3, minimum), maximum)}ch`
}

function getStatusDisplayValue(status: string, options: PredefinedValue[]) {
  const normalizedStatus = status.trim()
  if (!normalizedStatus) return '-'

  const label = options.find((option) => option.id === normalizedStatus)?.name
  return label ? `${normalizedStatus} - ${label}` : normalizedStatus
}

function findPredefinedOptions(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) {
  const category = findPredefinedCategoryByCandidates(values, titles, candidates)
  return category ? values[category] ?? [] : []
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function escapeHtml(value: unknown) {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function textBlock(value: unknown) {
  return escapeHtml(value || '-').replace(/\n/g, '<br />')
}

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognitionConstructor() {
  return (window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }).SpeechRecognition || (window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }).webkitSpeechRecognition
}

// Kullanici istegi (13 Eylul 2026): "en son yapılan tahkikat raporu
// bilgiside görünsün" - dosyanin en son Tahkikat Formu kaydinin (eliminasyon
// / karar+puan) kisa bir rozet metnine cevrilmesi. Kayit yoksa null doner.
function getTahkikatBadge(row: UpdateWorkflowFile): { text: string; className: string } | null {
  const hasRecord = Boolean(row.lastTahkikatDate || row.lastTahkikatKarar || row.lastTahkikatPuan !== null || row.lastTahkikatEliminasyon)
  if (!hasRecord) return null

  if (row.lastTahkikatEliminasyon === 'RED') {
    return {
      text: `${formatDate(row.lastTahkikatDate)} — ELİMİNASYON: RED`,
      className: 'border-rose-300 bg-rose-50 text-rose-700',
    }
  }

  const renk = getKararRenk(row.lastTahkikatPuan)
  const puanText = row.lastTahkikatPuan !== null ? ` (${row.lastTahkikatPuan}/${row.lastTahkikatMaksimumPuan ?? 100})` : ''
  return {
    text: `${formatDate(row.lastTahkikatDate)}${row.lastTahkikatKarar ? ` — ${row.lastTahkikatKarar}` : ''}${puanText}`,
    className: KARAR_RENK_SINIFLARI[renk],
  }
}

// Duz liste ve mahalleye-gore-gruplu liste AYNI satir gorunumunu kullansin
// diye ayri bir bilesene cikarildi (kullanici istegi 13 Eylul 2026: Sonuç
// Bekleyen sayfasi da ön inceleme/tahkikat sayfalariyla AYNI telefon/
// mahalle/adres + mahalle secici duzenine getirildi).
function GuncellemeTableRow({ row, index, onOpenFile, onOpenReport }: {
  row: UpdateWorkflowFile
  index: number
  onOpenFile: (row: UpdateWorkflowFile) => void
  onOpenReport: (row: UpdateWorkflowFile) => void
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
        <span className="line-clamp-2 block max-w-[150px]">{row.applicantName}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">
        <span className="line-clamp-2 block max-w-[110px]">{row.phone}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">
        <span className="line-clamp-2 block max-w-[120px]">{row.neighborhood}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-700">
        <span className="line-clamp-2 block max-w-[160px]">{row.address}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3">
        {(() => {
          const badge = getTahkikatBadge(row)
          return badge ? (
            <span className={`inline-flex max-w-[150px] rounded-full border px-2.5 py-1 text-xs font-black ${badge.className}`}>
              <span className="line-clamp-2">{badge.text}</span>
            </span>
          ) : (
            <span className="text-xs font-bold text-slate-300">-</span>
          )
        })()}
      </td>
      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-700">{formatDate(row.lastVisitDate)}</td>
      {/* Kullanici istegi (13 Eylul 2026): "işaretli tahkikat raporu alanını
          genişletelim diğer alanları daraltalım, yazı fontunu büyütelim" -
          Tahkikat Formu kaydedilince ozet paragrafi artik bu koloni
          (Son Ev Ziyareti Bilgisi) doldurduğu icin diger kolonlar daraltilip
          bu genislikle (satir kirpma da kaldirilarak, metin tam okunabilsin
          diye) buyutuldu. */}
      <td className="min-w-[420px] border-b border-slate-100 px-4 py-3 text-[14px] font-semibold leading-relaxed text-slate-800">
        <span className="block whitespace-pre-wrap">{row.lastVisitInfo}</span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3">
        <span className="inline-flex max-w-[110px] rounded-full bg-sky-50 px-2.5 py-1 text-xs font-black text-[#005f95] ring-1 ring-sky-200">
          <span className="truncate">{row.visitUserName}</span>
        </span>
      </td>
      <td className="border-b border-slate-100 px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onOpenReport(row)}
          className="inline-flex items-center rounded-md border border-[#6fb744] bg-[#f1faed] px-3 py-2 text-xs font-black uppercase text-[#3f7f28] shadow-sm transition hover:bg-[#e5f5dc]"
        >
          İnceleme Formları
        </button>
      </td>
    </tr>
  )
}

function GuncellemeMobileCard({ row, onOpenFile, onOpenReport }: {
  row: UpdateWorkflowFile
  onOpenFile: (row: UpdateWorkflowFile) => void
  onOpenReport: (row: UpdateWorkflowFile) => void
}) {
  return (
    <div className="rounded-lg border border-sky-100 bg-white p-3 shadow-sm">
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
          className="shrink-0 rounded-md border border-[#6fb744] bg-[#6fb744] px-3 py-2 text-[11px] font-black uppercase text-white shadow-sm"
        >
          İnceleme Formları
        </button>
      </div>
      {/* Kullanici istegi (14 Eylul 2026): "mobil ekranda... alanlar cok
          buyuk gorunuyor, yazi puntolarini kucult, daha optimize gorunsun" -
          bir onceki turda buyutulen rapor metni ve etiketler burada tekrar
          kompakt boyuta (10-11px) dondurulduy - satir kirpma/tam metin
          gosterimi (once istenen) KORUNDU, sadece font kucultuldu. */}
      <div className="mt-2 space-y-1 rounded-md bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-700">
        <div><span className="text-[9px] font-black uppercase text-slate-400">Telefon: </span>{row.phone}</div>
        <div><span className="text-[9px] font-black uppercase text-slate-400">Mahalle: </span>{row.neighborhood}</div>
        <div className="line-clamp-2"><span className="text-[9px] font-black uppercase text-slate-400">Adres: </span>{row.address}</div>
      </div>
      {(() => {
        const badge = getTahkikatBadge(row)
        return badge ? (
          <div className={`mt-2 inline-flex max-w-full rounded-full border px-2 py-1 text-[10px] font-black ${badge.className}`}>
            <span className="line-clamp-2">Son Tahkikat: {badge.text}</span>
          </div>
        ) : null
      })()}
      <div className="mt-3 rounded-md bg-sky-50 px-2 py-1.5 text-[11px] font-bold text-[#005f95]">
        <div className="text-[9px] font-black uppercase text-sky-600">Son Ev Ziyareti</div>
        {formatDate(row.lastVisitDate)}
      </div>
      <div className="mt-2 inline-flex rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-[#005f95] ring-1 ring-sky-200">
        {row.visitUserName}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[11px] font-semibold leading-5 text-slate-700">{row.lastVisitInfo}</p>
    </div>
  )
}

export default function GuncellemeWorkflowPage() {
  const [rows, setRows] = useState<UpdateWorkflowFile[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  // Kullanici istegi (13 Eylul 2026): ön inceleme/tahkikat sayfalarindaki
  // AYNI mahalle secici (chip) deseni.
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string>('all')
  const [resultTarget, setResultTarget] = useState<UpdateWorkflowFile | null>(null)
  const [resultForm, setResultForm] = useState({ date: getTodayInputDate(), title: 'Komisyon Raporu', content: '' })
  const [resultStatus, setResultStatus] = useState<'idle' | 'saving' | 'opening'>('idle')
  const [resultError, setResultError] = useState('')
  const [evaluationForms, setEvaluationForms] = useState<IncelemeFormRecord[]>([])
  const [evaluationFormsStatus, setEvaluationFormsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [evaluationFormsError, setEvaluationFormsError] = useState('')
  const [tahkikatFormlari, setTahkikatFormlari] = useState<TahkikatFormOzet[]>([])
  const [tahkikatFormlariStatus, setTahkikatFormlariStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [tahkikatFormlariError, setTahkikatFormlariError] = useState('')
  const [evZiyaretleri, setEvZiyaretleri] = useState<EvZiyaretiKaydi[]>([])
  const [evZiyaretleriStatus, setEvZiyaretleriStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [evZiyaretleriError, setEvZiyaretleriError] = useState('')
  // bkz. yukaridaki "computeCanViewHomeVisits" notu - varsayilan true (izin
  // yuklenene kadar kisa sureligine gizlenmesin, veri zaten API'da korunuyor).
  const [canViewHomeVisits, setCanViewHomeVisits] = useState(true)
  const [assistanceRows, setAssistanceRows] = useState<ServiceRecordFormRow[]>([])
  const [assistanceStatus, setAssistanceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [assistanceError, setAssistanceError] = useState('')
  const [savingAssistanceKey, setSavingAssistanceKey] = useState('')
  const [assistanceStatusOptions, setAssistanceStatusOptions] = useState<PredefinedValue[]>(DEFAULT_PREDEFINED_VALUES.assistanceStatus)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [quickAddStatus, setQuickAddStatus] = useState<'idle' | 'saving'>('idle')
  const [quickAddError, setQuickAddError] = useState('')
  const [quickAddForm, setQuickAddForm] = useState(createDefaultQuickAssistanceForm)
  const [investigationSubjectOptions, setInvestigationSubjectOptions] = useState<PredefinedValue[]>([])
  const [commissionDictationActive, setCommissionDictationActive] = useState(false)
  const commissionDictationRef = useRef<SpeechRecognitionInstance | null>(null)
  const commissionDictationShouldRunRef = useRef(false)
  const { addTab } = useTabs()

  useEffect(() => {
    let isCancelled = false

    const loadHomeVisitPermission = async () => {
      try {
        const userResponse = await fetch('/api/users/current')
        const userPayload = await userResponse.json()
        const userId = String(userPayload?.data?.id ?? '')
        if (!userResponse.ok || !userId) return

        const permissionResponse = await fetch(`/api/settings/${USER_PERMISSIONS_SETTING_KEY}`)
        if (!permissionResponse.ok) return

        const permissionPayload = await permissionResponse.json()
        const permissions = permissionPayload?.data?.value as UserPermissionsById | undefined
        const config = permissions?.[userId] ?? null

        if (!isCancelled) setCanViewHomeVisits(computeCanViewHomeVisits(config))
      } catch {
        // sessizce yoksay - varsayilan (gorunur) kalir, veri zaten API'da korunuyor
      }
    }

    void loadHomeVisitPermission()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    async function loadRows() {
      setStatus('loading')
      setError('')
      try {
        const response = await fetch('/api/workflow/guncelleme', { cache: 'no-store' })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Guncelleme dosyalari alinamadi.')
        }

        if (!isCancelled) {
          setRows(payload.data ?? [])
          setStatus('ready')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Guncelleme listesi yuklenirken hata olustu.')
          setStatus('error')
        }
      }
    }

    void loadRows()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    async function loadPredefinedValues() {
      try {
        const response = await fetch('/api/predefined-values', { cache: 'no-store' })
        const payload = (await response.json()) as PredefinedValuesResponse
        const options = payload?.data?.values?.assistanceStatus

        if (!isCancelled && response.ok && Array.isArray(options) && options.length > 0) {
          setAssistanceStatusOptions(options)
        }

        if (!isCancelled && response.ok && payload.success && payload.data) {
          setInvestigationSubjectOptions(
            findPredefinedOptions(payload.data.values, payload.data.titles, ['tahkikat konu', 'tahkikat konusu'])
          )
        }
      } catch {
        if (!isCancelled) {
          setAssistanceStatusOptions(DEFAULT_PREDEFINED_VALUES.assistanceStatus)
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

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase('tr-TR')
    if (!term) return rows

    return rows.filter((row) => (
      row.fileNo.toLocaleLowerCase('tr-TR').includes(term) ||
      row.applicantName.toLocaleLowerCase('tr-TR').includes(term) ||
      row.lastVisitInfo.toLocaleLowerCase('tr-TR').includes(term) ||
      row.visitUserName.toLocaleLowerCase('tr-TR').includes(term) ||
      row.neighborhood.toLocaleLowerCase('tr-TR').includes(term) ||
      row.phone.toLocaleLowerCase('tr-TR').includes(term) ||
      row.address.toLocaleLowerCase('tr-TR').includes(term)
    ))
  }, [rows, searchTerm])

  // Kullanici istegi (13 Eylul 2026): "hangi mahallede kaç dosya" - ön
  // inceleme/tahkikat sayfalarindaki AYNI mahalleye gore gruplama + secici.
  const neighborhoodGroups = useMemo(() => {
    const map = new Map<string, UpdateWorkflowFile[]>()
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

  const openFile = (row: UpdateWorkflowFile) => {
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

  const openResultForm = (row: UpdateWorkflowFile) => {
    setResultTarget(row)
    setResultForm({ date: getTodayInputDate(), title: 'Komisyon Raporu', content: '' })
    setResultError('')
    setIsQuickAddOpen(false)
    setQuickAddError('')
    setQuickAddForm(createDefaultQuickAssistanceForm())
    void loadAssistances(row.fileId)
    void loadEvaluationForms(row.fileId)
    void loadTahkikatFormlari(row.fileId)
    void loadEvZiyaretleri(row.fileId)
  }

  const closeResultForm = () => {
    if (resultStatus !== 'idle' || quickAddStatus === 'saving') return
    setResultTarget(null)
    setResultError('')
    setAssistanceRows([])
    setAssistanceStatus('idle')
    setAssistanceError('')
    setEvaluationForms([])
    setEvaluationFormsStatus('idle')
    setEvaluationFormsError('')
    setTahkikatFormlari([])
    setTahkikatFormlariStatus('idle')
    setTahkikatFormlariError('')
    setEvZiyaretleri([])
    setEvZiyaretleriStatus('idle')
    setEvZiyaretleriError('')
    setIsQuickAddOpen(false)
    setQuickAddError('')
    setQuickAddForm(createDefaultQuickAssistanceForm())
  }

  const mapServiceRecordRows = (applications: ApplicationRow[], assistances: AssistanceRow[]): ServiceRecordFormRow[] => {
    const applicationRows = applications
      .filter((row) => visibleServiceTables.has(row.sourceTable))
      .map((row): ServiceRecordFormRow => ({
        kind: 'application',
        recordId: row.recordId,
        sourceTable: row.sourceTable,
        type: serviceTypeLabels[row.sourceTable] ?? row.type,
        date: normalizeInputValue(row.applicationDate),
        startDate: normalizeInputValue(row.startDate),
        endDate: normalizeInputValue(row.endDate),
        periodInfo: normalizeInputValue(row.period),
        label: normalizeInputValue(row.label),
        status: normalizeInputValue(row.status),
        amount: normalizeInputValue(row.amount),
        description: normalizeInputValue(row.description),
        formDate: toInputDate(row.applicationDate),
        formStartDate: toInputDate(row.startDate),
        formEndDate: toInputDate(row.endDate),
      }))

    const assistanceRowsToMap = assistances
      .filter((row) => visibleServiceTables.has(row.sourceTable))
      .map((row): ServiceRecordFormRow => ({
        kind: 'assistance',
        recordId: row.recordId,
        sourceTable: row.sourceTable,
        type: serviceTypeLabels[row.sourceTable] ?? row.type,
        date: normalizeInputValue(row.date),
        startDate: normalizeInputValue(row.startDate),
        endDate: normalizeInputValue(row.endDate),
        periodInfo: normalizeInputValue(row.periodInfo),
        label: normalizeInputValue(row.label),
        status: normalizeInputValue(row.status),
        amount: normalizeInputValue(row.amount),
        description: normalizeInputValue(row.description),
        formDate: toInputDate(row.date),
        formStartDate: toInputDate(row.startDate),
        formEndDate: toInputDate(row.endDate),
      }))

    return [...applicationRows, ...assistanceRowsToMap]
  }

  const loadAssistances = async (fileId: string) => {
    setAssistanceStatus('loading')
    setAssistanceError('')
    try {
      const params = new URLSearchParams({ fileId })
      const response = await fetch(`/api/documents/fetch?${params.toString()}`, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Yardim listesi alinamadi.')
      }

      setAssistanceRows(mapServiceRecordRows(payload.data?.applications ?? [], payload.data?.assistances ?? []))
      setAssistanceStatus('ready')
    } catch (err) {
      setAssistanceRows([])
      setAssistanceError(err instanceof Error ? err.message : 'Yardim listesi yuklenirken hata olustu.')
      setAssistanceStatus('error')
    }
  }

  const loadEvaluationForms = async (fileId: string) => {
    setEvaluationFormsStatus('loading')
    setEvaluationFormsError('')
    try {
      const response = await fetch(`/api/documents/inceleme-formu?dosyaId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
      const payload = await response.json() as { success: boolean; data?: IncelemeFormRecord[]; error?: string }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Inceleme formlari alinamadi.')
      }

      setEvaluationForms(payload.data ?? [])
      setEvaluationFormsStatus('ready')
    } catch (err) {
      setEvaluationForms([])
      setEvaluationFormsError(err instanceof Error ? err.message : 'Inceleme formlari yuklenirken hata olustu.')
      setEvaluationFormsStatus('error')
    }
  }

  // Kullanici istegi (13 Eylul 2026): "en son yapılan tahkikat raporu özet
  // bilgisi burada görünebilsin" - GUNCEL Tahkikat Formu sistemi (bkz. app/
  // api/documents/inceleme-degerlendirme), yukaridaki eski/dead loadEvaluationForms
  // (inceleme_formu) ile KARISTIRILMASIN.
  const loadTahkikatFormlari = async (fileId: string) => {
    setTahkikatFormlariStatus('loading')
    setTahkikatFormlariError('')
    try {
      const response = await fetch(`/api/documents/inceleme-degerlendirme?dosyaId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
      const payload = await response.json() as { success: boolean; data?: TahkikatFormOzet[]; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Tahkikat formlari alinamadi.')
      setTahkikatFormlari(payload.data ?? [])
      setTahkikatFormlariStatus('ready')
    } catch (err) {
      setTahkikatFormlari([])
      setTahkikatFormlariError(err instanceof Error ? err.message : 'Tahkikat formlari yuklenirken hata olustu.')
      setTahkikatFormlariStatus('error')
    }
  }

  // Kullanici istegi (13 Eylul 2026, devami): "karar verirken burada ev
  // ziyarete raporunuda okuyabilsin" - evziyareti tablosu (bkz. app/api/
  // home-visits/route.ts) hem elle girilen Ev Ziyareti Formlarini, hem de
  // Tahkikat Formu kaydedilince otomatik eklenen ozet satirini icerir.
  const loadEvZiyaretleri = async (fileId: string) => {
    setEvZiyaretleriStatus('loading')
    setEvZiyaretleriError('')
    try {
      const response = await fetch(`/api/home-visits?requestId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
      const payload = await response.json() as { success: boolean; data?: EvZiyaretiKaydi[]; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Ev ziyareti raporlari alinamadi.')
      setEvZiyaretleri(payload.data ?? [])
      setEvZiyaretleriStatus('ready')
    } catch (err) {
      setEvZiyaretleri([])
      setEvZiyaretleriError(err instanceof Error ? err.message : 'Ev ziyareti raporlari yuklenirken hata olustu.')
      setEvZiyaretleriStatus('error')
    }
  }

  const printEvaluationForm = (record: IncelemeFormRecord, shouldPrint = true) => {
    const aidRows = (record.yardimTurleri ?? []).map((type) => {
      const amount = record.yardimMiktarlari?.[type]
      return `<tr><td>${escapeHtml(type)}</td><td>${escapeHtml(amount || '-')}</td></tr>`
    }).join('')
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(`Inceleme Formu ${record.basvuruNo || resultTarget?.fileNo || ''}`)}</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; background: #f8fafc; color: #0f172a; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .sheet { max-width: 210mm; margin: 0 auto; background: #fff; padding: 12mm; }
            .header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; border-bottom: 3px solid #0f766e; padding-bottom: 14px; }
            .eyebrow { color: #0f766e; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
            h1 { margin: 4px 0 0; color: #042f2e; font-size: 23px; line-height: 1.2; }
            .sub { margin-top: 4px; color: #475569; font-size: 12px; font-weight: 700; }
            .score { min-width: 160px; border: 1px solid #99f6e4; border-radius: 12px; background: #ecfdf5; padding: 10px 14px; text-align: right; }
            .score small { display: block; color: #0f766e; font-size: 10px; font-weight: 900; text-transform: uppercase; }
            .score strong { color: #134e4a; font-size: 28px; line-height: 1; }
            .score span { display: block; margin-top: 4px; color: #334155; font-size: 11px; font-weight: 800; }
            .section { margin-top: 14px; break-inside: avoid; }
            .section-title { border-left: 5px solid #0f766e; background: #f0fdfa; color: #134e4a; font-size: 13px; font-weight: 900; padding: 8px 10px; text-transform: uppercase; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
            .field { border: 1px solid #dbeafe; border-radius: 8px; background: #f8fafc; padding: 8px 10px; min-height: 46px; }
            .field.full { grid-column: 1 / -1; }
            .label { color: #64748b; font-size: 10px; font-weight: 900; text-transform: uppercase; }
            .value { margin-top: 4px; color: #0f172a; font-size: 13px; font-weight: 800; line-height: 1.35; overflow-wrap: anywhere; }
            .text-panel { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; color: #1e293b; font-size: 13px; font-weight: 700; line-height: 1.6; overflow-wrap: anywhere; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
            th { background: #f1f5f9; color: #475569; font-size: 10px; text-align: left; text-transform: uppercase; }
            th, td { border: 1px solid #e2e8f0; padding: 8px; vertical-align: top; }
            td { color: #0f172a; font-weight: 700; }
            .commission .section-title { border-left-color: #4f46e5; background: #eef2ff; color: #312e81; }
            @media print { body { background: #fff; } .sheet { margin: 0; padding: 0; max-width: none; } }
          </style>
        </head>
        <body>
          <main class="sheet">
            <header class="header">
              <div>
                <div class="eyebrow">Sosyal Yardım İnceleme Dosyası</div>
                <h1>Inceleme Formu ve Komisyon Raporu</h1>
                <div class="sub">${escapeHtml(record.adSoyad || resultTarget?.applicantName || '-')} - Dosya No: ${escapeHtml(record.basvuruNo || resultTarget?.fileNo || '-')}</div>
              </div>
              <div class="score">
                <small>Toplam Puan</small>
                <strong>${escapeHtml(record.toplamPuan ?? 0)} / 100</strong>
                <span>${escapeHtml(record.otomatikSonuc || '-')}</span>
              </div>
            </header>
            <section class="section">
              <div class="section-title">Başvuru ve Hane Bilgileri</div>
              <div class="grid">
                ${[
                  ['Form Tarihi', formatDate(cleanText(record.formTarihi))],
                  ['Ad Soyad', record.adSoyad],
                  ['T.C. Kimlik', record.tcKimlik],
                  ['Telefon', record.telefon],
                  ['Ilce / Mahalle', record.ilceMahalle],
                  ['Hane Kisi Sayisi', record.haneKisiSayisi],
                  ['Toplam Gelir', record.toplamGelir ? `${record.toplamGelir} TL` : ''],
                  ['Kisi Basi Gelir', record.kisiBasiGelir ? `${record.kisiBasiGelir} TL` : ''],
                  ['Incelemeyi Yapan', record.inceleyenAdSoyad],
                ].map(([label, value]) => `
                  <div class="field">
                    <div class="label">${escapeHtml(label)}</div>
                    <div class="value">${escapeHtml(value || '-')}</div>
                  </div>
                `).join('')}
                <div class="field full">
                  <div class="label">Adres</div>
                  <div class="value">${escapeHtml(record.adres || '-')}</div>
                </div>
              </div>
            </section>
            <section class="section">
              <div class="section-title">Saha Inceleme Ozeti</div>
              <div class="text-panel">${textBlock(record.sahaIncelemeOzeti)}</div>
            </section>
            <section class="section">
              <div class="section-title">Incelemeci Raporu</div>
              <div class="text-panel">${textBlock(record.ozelDurumGerekce)}</div>
            </section>
            <section class="section commission">
              <div class="section-title">Komisyon Raporu</div>
              <div class="text-panel">${textBlock(record.komisyonRaporu)}</div>
              <div class="grid">
                <div class="field">
                  <div class="label">Incelemeci Karari</div>
                  <div class="value">${escapeHtml(record.komisyonKarari || '-')}</div>
                </div>
                <div class="field">
                  <div class="label">Yardım Süresi</div>
                  <div class="value">${escapeHtml(record.yardimSuresi || '-')}</div>
                </div>
                <div class="field">
                  <div class="label">Komisyon Onay</div>
                  <div class="value">${escapeHtml(record.komisyonOnay || '-')}</div>
                </div>
              </div>
              ${aidRows ? `
                <table>
                  <thead><tr><th>Yardım Türü</th><th>Miktar</th></tr></thead>
                  <tbody>${aidRows}</tbody>
                </table>
              ` : ''}
            </section>
          </main>
          ${shouldPrint ? `<script>
            window.addEventListener('load', function () {
              window.focus();
              setTimeout(function () { window.print(); }, 250);
            });
          </script>` : ''}
        </body>
      </html>
    `
    const printWindow = window.open('', '_blank', 'width=980,height=1200')

    if (!printWindow) {
      setResultError('PDF veya yazdirma penceresi acilamadi. Tarayicida acilir pencere iznini kontrol edin.')
      return
    }

    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  const updateAssistanceRow = (rowKey: string, changes: Partial<ServiceRecordFormRow>) => {
    setAssistanceRows((currentRows) => currentRows.map((row) => (
      `${row.kind}:${row.sourceTable}:${row.recordId}` === rowKey ? { ...row, ...changes } : row
    )))
  }

  const updateAssistancePeriod = (row: ServiceRecordFormRow, rowKey: string, periodInfo: string) => {
    const monthCount = getPeriodMonthCount(periodInfo)
    const startDate = row.formStartDate || getTodayInputDate()

    updateAssistanceRow(rowKey, {
      periodInfo,
      formStartDate: monthCount > 0 && !row.formStartDate ? startDate : row.formStartDate,
      formEndDate: monthCount > 0 ? addMonthsToInputDate(startDate, monthCount) : row.formEndDate,
    })
  }

  const updateAssistanceStartDate = (row: ServiceRecordFormRow, rowKey: string, startDate: string) => {
    const monthCount = getPeriodMonthCount(row.periodInfo)

    updateAssistanceRow(rowKey, {
      formStartDate: startDate,
      formEndDate: monthCount > 0 ? addMonthsToInputDate(startDate, monthCount) : row.formEndDate,
    })
  }

  const updateQuickAddPeriod = (period: string) => {
    const monthCount = getPeriodMonthCount(period)
    const startDate = quickAddForm.startDate || getTodayInputDate()

    setQuickAddForm((current) => ({
      ...current,
      period,
      startDate: monthCount > 0 && !current.startDate ? startDate : current.startDate,
      endDate: monthCount > 0 ? addMonthsToInputDate(startDate, monthCount) : current.endDate,
    }))
  }

  const toggleCommissionDictation = async () => {
    if (commissionDictationActive) {
      commissionDictationShouldRunRef.current = false
      commissionDictationRef.current?.stop()
      commissionDictationRef.current = null
      setCommissionDictationActive(false)
      return
    }

    commissionDictationShouldRunRef.current = true
    setCommissionDictationActive(true)

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor()
    if (!SpeechRecognitionConstructor) {
      setResultError('Bu tarayıcı mikrofonla yazıya çevirme özelliğini desteklemiyor. Chrome veya Edge ile deneyin.')
      commissionDictationShouldRunRef.current = false
      setCommissionDictationActive(false)
      return
    }

    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    if (!window.isSecureContext && !isLocalhost) {
      setResultError('Mikrofon icin sayfayi http://localhost:3000 uzerinden ya da HTTPS ile acin. IP adresi uzerinden acilan guvensiz sayfalarda tarayici mikrofonu engeller.')
      commissionDictationShouldRunRef.current = false
      setCommissionDictationActive(false)
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setResultError('Tarayici mikrofon izni vermiyor. Chrome veya Edge ile, mikrofon izni acik sekilde deneyin.')
      commissionDictationShouldRunRef.current = false
      setCommissionDictationActive(false)
      return
    }

    const startCommissionRecognition = () => {
      const recognition = new SpeechRecognitionConstructor()
      let processedResultCount = 0
      recognition.lang = 'tr-TR'
      recognition.continuous = false
      recognition.interimResults = false
      recognition.onresult = (event) => {
        const spokenText = Array.from(event.results)
          .slice(processedResultCount)
          .map((result) => result[0]?.transcript?.trim())
          .filter(Boolean)
          .join(' ')
          .trim()

        if (!spokenText) return
        processedResultCount = event.results.length

        setResultForm((current) => ({
          ...current,
          content: current.content.trim() ? `${current.content.trim()}\n${spokenText}` : spokenText,
        }))
      }
      recognition.onerror = (event) => {
        const shouldStop = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(event.error || '')
        const errorText = event.error === 'no-speech'
          ? 'Mikrofon acik. Ses algilanmadiysa daha net ve yakindan konusun.'
          : event.error === 'not-allowed'
            ? 'Mikrofon izni verilmedi. Tarayici adres cubugundaki mikrofon iznini acin.'
            : `Mikrofonla yazma basarisiz oldu${event.error ? `: ${event.error}` : '.'}`
        setResultError(errorText)
        if (shouldStop) {
          commissionDictationShouldRunRef.current = false
          setCommissionDictationActive(false)
          commissionDictationRef.current = null
        }
      }
      recognition.onend = () => {
        if (!commissionDictationShouldRunRef.current) {
          setCommissionDictationActive(false)
          commissionDictationRef.current = null
          return
        }

        window.setTimeout(() => {
          if (commissionDictationShouldRunRef.current) startCommissionRecognition()
        }, 700)
      }

      try {
        recognition.start()
        commissionDictationRef.current = recognition
        setCommissionDictationActive(true)
        setResultError('Mikrofon dinliyor. Konusmaniz komisyon raporu alanina yazilacak.')
      } catch {
        commissionDictationShouldRunRef.current = false
        setCommissionDictationActive(false)
        commissionDictationRef.current = null
        setResultError('Mikrofon baslatilamadi. Tarayici mikrofon iznini kontrol edin.')
      }
    }

    startCommissionRecognition()
  }

  useEffect(() => {
    return () => {
      commissionDictationShouldRunRef.current = false
      commissionDictationRef.current?.stop()
    }
  }, [])

  const createQuickAssistance = async () => {
    if (!resultTarget || quickAddStatus === 'saving') return

    const isReadyMeal = quickAddForm.type === 'Hazır Yemek'
    if (!quickAddForm.type || !quickAddForm.period || !quickAddForm.startDate || !quickAddForm.endDate) {
      setQuickAddError('Yardim turu, periyot, baslangic ve bitis tarihi zorunludur.')
      return
    }

    if (!quickAddForm.amount.trim() && !(isReadyMeal && quickAddForm.breakfastAmount.trim())) {
      setQuickAddError(isReadyMeal ? 'Hazir Yemek icin yemek miktari veya kahvalti miktari girin.' : 'Miktar alani zorunludur.')
      return
    }

    setQuickAddStatus('saving')
    setQuickAddError('')
    setAssistanceError('')
    try {
      const createResponse = await fetch('/api/documents/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: resultTarget.fileId,
          type: quickAddForm.type,
          applicantName: resultTarget.applicantName,
          date: getTodayInputDate(),
          period: quickAddForm.period,
          startDate: quickAddForm.startDate,
          endDate: quickAddForm.endDate,
          amount: quickAddForm.amount,
          breakfastAmount: quickAddForm.breakfastAmount,
          description: quickAddForm.description,
        }),
      })
      const createPayload = await createResponse.json()

      if (!createResponse.ok || !createPayload.success || !createPayload.data?.id || !createPayload.data?.sourceTable) {
        throw new Error(createPayload.error || 'Muracaat kaydi olusturulamadi.')
      }

      await loadAssistances(resultTarget.fileId)
      setIsQuickAddOpen(false)
      setQuickAddForm(createDefaultQuickAssistanceForm())
    } catch (err) {
      setQuickAddError(err instanceof Error ? err.message : 'Yardim kaydi olusturulurken hata olustu.')
    } finally {
      setQuickAddStatus('idle')
    }
  }

  const saveAssistanceRow = async (row: ServiceRecordFormRow) => {
    if (!resultTarget || savingAssistanceKey) return

    const rowKey = `${row.kind}:${row.sourceTable}:${row.recordId}`
    const assistancePayload: Record<string, string> = {
      mode: 'details',
      sourceTable: row.sourceTable,
      recordId: row.recordId,
      fileId: resultTarget.fileId,
      status: row.status,
      startDate: row.formStartDate,
      endDate: row.formEndDate,
      period: row.periodInfo,
    }
    if (!row.amount.trim() || /^-?\d+(?:[,.]\d+)?$/.test(row.amount.trim())) {
      assistancePayload.amount = row.amount
    }

    setSavingAssistanceKey(rowKey)
    setAssistanceError('')
    try {
      const response = await fetch('/api/documents/service-record', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assistancePayload),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Yardim kaydi guncellenemedi.')
      }

      await loadAssistances(resultTarget.fileId)
    } catch (err) {
      setAssistanceError(err instanceof Error ? err.message : 'Yardim kaydi guncellenirken hata olustu.')
    } finally {
      setSavingAssistanceKey('')
    }
  }

  const saveResultReport = async () => {
    if (!resultTarget) return

    if (!resultForm.date || !resultForm.title.trim() || !resultForm.content.trim()) {
      setResultError('Tarih, konu ve rapor alanlari zorunludur.')
      return
    }

    setResultStatus('saving')
    setResultError('')
    try {
      const response = await fetch('/api/workflow/guncelleme/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: resultTarget.fileId,
          date: resultForm.date,
          title: resultForm.title,
          content: resultForm.content,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Sonuc raporu kaydedilemedi.')
      }

      const fileId = resultTarget.fileId
      const hasActiveAssistance = assistanceRows.some((row) => row.status === '2')

      for (const row of assistanceRows) {
        const shouldConvertApplication = row.kind === 'application' && row.status === '2'
        const detailsPayload: Record<string, string> = {
          mode: 'details',
          sourceTable: row.sourceTable,
          recordId: row.recordId,
          fileId,
          status: shouldConvertApplication ? '0' : (row.status || '0'),
          startDate: row.formStartDate,
          endDate: row.formEndDate,
          period: row.periodInfo,
        }
        if (!row.amount.trim() || /^-?\d+(?:[,.]\d+)?$/.test(row.amount.trim())) {
          detailsPayload.amount = row.amount
        }

        const detailsResponse = await fetch('/api/documents/service-record', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(detailsPayload),
        })
        const detailsResult = await detailsResponse.json()

        if (!detailsResponse.ok || !detailsResult.success) {
          throw new Error(detailsResult.error || `${row.type} yardim durumu kaydedilemedi.`)
        }

        if (shouldConvertApplication) {
          const convertResponse = await fetch('/api/documents/convert-application', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceTable: row.sourceTable,
              recordId: row.recordId,
              fileId,
            }),
          })
          const convertPayload = await convertResponse.json()

          if (!convertResponse.ok || !convertPayload.success) {
            throw new Error(convertPayload.error || `${row.type} yardimi baslatilamadi.`)
          }

          if (row.sourceTable === 'yrd_gidabankasi' || row.sourceTable === 'yrd_destekpaketi') {
            const periodResponse = await fetch('/api/documents/manual-period', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileId,
                recordId: row.recordId,
                sourceTable: row.sourceTable,
                periodDate: resultForm.date,
              }),
            })
            const periodPayload = await periodResponse.json()

            if (!periodResponse.ok && periodResponse.status !== 409) {
              throw new Error(periodPayload.error || `${row.type} yardim donemi olusturulamadi.`)
            }
          }
        }
      }

      const fileStatus = hasActiveAssistance ? '3' : '4'
      const fileStatusResponse = await fetch('/api/documents/file-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          date: resultForm.date,
          status: fileStatus,
          description: resultForm.content,
        }),
      })
      const fileStatusPayload = await fileStatusResponse.json()

      if (!fileStatusResponse.ok || !fileStatusPayload.success) {
        throw new Error(fileStatusPayload.error || `Dosya durumu ${fileStatus} yapilamadi.`)
      }

      setRows((currentRows) => currentRows.filter((row) => row.fileId !== fileId))
      setResultTarget(null)
      setResultForm({ date: getTodayInputDate(), title: 'Komisyon Raporu', content: '' })
    } catch (err) {
      setResultError(err instanceof Error ? err.message : 'Sonuc raporu kaydedilirken hata olustu.')
    } finally {
      setResultStatus('idle')
    }
  }

  const openAssistancesWithReport = async () => {
    if (!resultTarget) return

    if (!resultForm.date || !resultForm.title.trim() || !resultForm.content.trim()) {
      setResultError('Yardimlari acmadan once tarih, konu ve rapor alanlarini doldurun.')
      return
    }

    const applicationRows = assistanceRows.filter((row) => row.kind === 'application')
    if (applicationRows.length === 0) {
      setResultError('Yardima acilacak muracaat kaydi bulunamadi.')
      return
    }

    setResultStatus('opening')
    setResultError('')
    setAssistanceError('')
    try {
      const fileId = resultTarget.fileId
      const reportResponse = await fetch('/api/workflow/guncelleme/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          date: resultForm.date,
          title: resultForm.title,
          content: resultForm.content,
        }),
      })
      const reportPayload = await reportResponse.json()

      if (!reportResponse.ok || !reportPayload.success) {
        throw new Error(reportPayload.error || 'Sonuc raporu kaydedilemedi.')
      }

      for (const row of applicationRows) {
        const detailsPayload: Record<string, string> = {
          mode: 'details',
          sourceTable: row.sourceTable,
          recordId: row.recordId,
          fileId,
          status: row.status || '0',
          startDate: row.formStartDate,
          endDate: row.formEndDate,
          period: row.periodInfo,
        }
        if (!row.amount.trim() || /^-?\d+(?:[,.]\d+)?$/.test(row.amount.trim())) {
          detailsPayload.amount = row.amount
        }

        const detailsResponse = await fetch('/api/documents/service-record', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(detailsPayload),
        })
        const detailsResult = await detailsResponse.json()

        if (!detailsResponse.ok || !detailsResult.success) {
          throw new Error(detailsResult.error || `${row.type} muracaati acilamadi.`)
        }

        const response = await fetch('/api/documents/convert-application', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceTable: row.sourceTable,
            recordId: row.recordId,
            fileId,
          }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || `${row.type} yardima acilamadi.`)
        }

        if (row.sourceTable === 'yrd_gidabankasi' || row.sourceTable === 'yrd_destekpaketi') {
          const periodResponse = await fetch('/api/documents/manual-period', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId,
              recordId: row.recordId,
              sourceTable: row.sourceTable,
              periodDate: resultForm.date,
            }),
          })
          const periodPayload = await periodResponse.json()

          if (!periodResponse.ok && periodResponse.status !== 409) {
            throw new Error(periodPayload.error || `${row.type} manuel donemi olusturulamadi.`)
          }
        }
      }

      const fileStatusResponse = await fetch('/api/documents/file-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          date: resultForm.date,
          status: '3',
          description: resultForm.content,
        }),
      })
      const fileStatusPayload = await fileStatusResponse.json()

      if (!fileStatusResponse.ok || !fileStatusPayload.success) {
        throw new Error(fileStatusPayload.error || 'Dosya durumu 3 yapilamadi.')
      }

      setRows((currentRows) => currentRows.filter((row) => row.fileId !== fileId))
      setResultTarget(null)
      setResultForm({ date: getTodayInputDate(), title: 'Komisyon Raporu', content: '' })
      setIsQuickAddOpen(false)
      setQuickAddForm(createDefaultQuickAssistanceForm())
    } catch (err) {
      setResultError(err instanceof Error ? err.message : 'Yardimlar acilirken hata olustu.')
    } finally {
      setResultStatus('idle')
    }
  }

  const applicationCount = assistanceRows.filter((row) => row.kind === 'application').length
  const assistanceCount = assistanceRows.filter((row) => row.kind === 'assistance').length
  const visibleServiceTypeCount = new Set(assistanceRows.map((row) => row.sourceTable)).size
  const serviceColumnWidths = useMemo(() => ({
    process: getColumnWidth(assistanceRows.map((row) => (row.kind === 'application' ? 'Muracaat' : 'Yardim')), 9, 12),
    type: getColumnWidth(assistanceRows.map((row) => row.type), 10, 18),
    period: getColumnWidth([
      ...assistanceRows.map((row) => row.periodInfo || 'Periyot seciniz'),
      ...periodOptions,
      'Sureli (Tek Seferlik)',
      'Periyodik',
    ], 22, 32),
    startDate: getColumnWidth(assistanceRows.map((row) => row.formStartDate || 'Baslangic'), 13, 15),
    endDate: getColumnWidth(assistanceRows.map((row) => row.formEndDate || 'Bitis'), 13, 15),
    amount: getColumnWidth(assistanceRows.map((row) => row.amount || 'Miktar'), 14, 32),
    status: getColumnWidth([
      ...assistanceRows.map((row) => getStatusDisplayValue(row.status, assistanceStatusOptions)),
      ...assistanceStatusOptions.map((option) => `${option.id} - ${option.name}`),
    ], 12, 28),
    action: '9ch',
  }), [assistanceRows, assistanceStatusOptions])

  return (
    <div className="space-y-5 text-slate-950">
      <div className="relative overflow-hidden rounded-lg border border-sky-200 bg-white px-5 py-4 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-[#0076b6] to-[#6fb744]" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[12px] font-black uppercase tracking-wide text-[#0076b6]">Is Akisi</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-[34px]">Güncelleme Dosyaları</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">Dosya durumu guncelleme olan kayitlar</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-black text-[#005f95] shadow-sm">
              Toplam {filteredRows.length} kayit
            </div>
            {/* Kullanici istegi (13 Eylul 2026): "hangi mahallede kaç dosya
                var üstte özet olarak da görünsün" - ön inceleme/tahkikat
                sayfalarindaki AYNI ozet kutusu. */}
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800 shadow-sm">
              {neighborhoodGroups.length} mahalleden {filteredRows.length} dosya
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-black uppercase text-[#005f95]">Güncelleme Listesi</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">Dosya no, sahip bilgisi, telefon, mahalle, adres, son ev ziyareti ve kullanıcı</p>
          </div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Dosya no, ad soyad, telefon, mahalle, adres, ev ziyareti bilgisi veya kullanici ara..."
            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-950 outline-none transition focus:border-[#0076b6] md:w-[460px]"
          />
        </div>

        {/* Kullanici istegi (13 Eylul 2026): mahalle secici chip listesi -
            ön inceleme/tahkikat sayfalarindaki AYNI desen. */}
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
            <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-8 text-center text-sm font-bold text-slate-500">
              Guncelleme dosyalari yukleniyor...
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-8 text-center text-sm font-bold text-slate-500">
              {selectedNeighborhood === 'all' ? 'Guncelleme durumunda dosya bulunamadi.' : `${selectedNeighborhood} mahallesinde guncelleme durumunda dosya bulunamadi.`}
            </div>
          ) : selectedNeighborhood === 'all' ? (
            neighborhoodGroups.map((group) => (
              <div key={`grup-m-${group.neighborhood}`} className="space-y-2">
                <div className="rounded-md bg-emerald-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-900">
                  {group.neighborhood} — {group.files.length} dosya
                </div>
                {group.files.map((row) => (
                  <GuncellemeMobileCard key={row.fileId} row={row} onOpenFile={openFile} onOpenReport={openResultForm} />
                ))}
              </div>
            ))
          ) : (
            displayedRows.map((row) => (
              <GuncellemeMobileCard key={row.fileId} row={row} onOpenFile={openFile} onOpenReport={openResultForm} />
            ))
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1720px] border-collapse text-left text-sm">
            <thead className="bg-sky-50 text-[12px] font-black uppercase text-[#005f95]">
              <tr>
                <th className="border-b border-sky-100 px-4 py-3">Dosya No</th>
                <th className="border-b border-sky-100 px-4 py-3">Adi Soyadi</th>
                <th className="border-b border-sky-100 px-4 py-3">Telefon</th>
                <th className="border-b border-sky-100 px-4 py-3">Mahalle</th>
                <th className="border-b border-sky-100 px-4 py-3">Adres</th>
                <th className="border-b border-sky-100 px-4 py-3">Son Tahkikat Raporu</th>
                <th className="border-b border-sky-100 px-4 py-3">Son Ev Ziyareti Tarihi</th>
                <th className="border-b border-sky-100 px-4 py-3">Son Ev Ziyareti Bilgisi</th>
                <th className="border-b border-sky-100 px-4 py-3">Yapan Kullanici</th>
                <th className="border-b border-sky-100 px-4 py-3 text-right">İnceleme Formları</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    Guncelleme dosyalari yukleniyor...
                  </td>
                </tr>
              ) : displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    {selectedNeighborhood === 'all' ? 'Guncelleme durumunda dosya bulunamadi.' : `${selectedNeighborhood} mahallesinde guncelleme durumunda dosya bulunamadi.`}
                  </td>
                </tr>
              ) : selectedNeighborhood === 'all' ? (
                neighborhoodGroups.map((group) => (
                  <Fragment key={`grup-${group.neighborhood}`}>
                    <tr className="bg-emerald-100">
                      <td colSpan={10} className="px-4 py-2 text-[12px] font-black uppercase tracking-wide text-emerald-900">
                        {group.neighborhood} — {group.files.length} dosya
                      </td>
                    </tr>
                    {group.files.map((row, index) => (
                      <GuncellemeTableRow key={row.fileId} row={row} index={index} onOpenFile={openFile} onOpenReport={openResultForm} />
                    ))}
                  </Fragment>
                ))
              ) : (
                displayedRows.map((row, index) => (
                  <GuncellemeTableRow key={row.fileId} row={row} index={index} onOpenFile={openFile} onOpenReport={openResultForm} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {resultTarget && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-sm">
          <div className="flex h-[96vh] w-full max-w-[98vw] flex-col overflow-hidden rounded-lg border border-sky-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-3 py-3 md:items-center md:px-5">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase text-[#0076b6]">Güncelleme İnceleme Formları</p>
                <h3 className="mt-0.5 text-base font-black leading-tight text-slate-950 md:truncate md:text-xl">İnceleme Formları, Komisyon Raporu ve Yardım Kayıtları</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="rounded border border-sky-200 bg-sky-50 px-2.5 py-1 text-[#005f95]">Dosya {resultTarget.fileNo}</span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">{resultTarget.applicantName}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={closeResultForm}
                disabled={resultStatus !== 'idle'}
                className="ml-4 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-lg font-black text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-wait disabled:opacity-60"
              >
                x
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto bg-slate-100 p-2 md:gap-4 md:p-4 xl:grid-cols-[minmax(680px,1fr)_max-content] xl:overflow-hidden">
              {resultError && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 xl:col-span-2">
                  {resultError}
                </div>
              )}

              <div className="min-h-0 overflow-y-visible rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:p-4 xl:overflow-y-auto">
                <div className="mb-3 flex flex-col gap-1 border-b border-slate-100 pb-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h4 className="text-sm font-black uppercase text-[#005f95]">Incelemeci Raporu ve Komisyon Karari</h4>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">Komisyon gorevlisi karar verirken inceleme raporunu burada gorur.</p>
                  </div>
                  <div className="text-xs font-bold text-slate-400">
                    Komisyon raporu: {resultForm.content.trim().length} karakter
                  </div>
                </div>

                {/* Kullanici istegi (13 Eylul 2026): "en son yapılan tahkikat
                    raporu özet bilgisi burada görünebilsin, karar verirken
                    burada ev ziyarete raporunuda okuyabilsin" - komisyon
                    karar vermeden ONCE gorecegi sekilde en uste eklendi. */}
                {(() => {
                  const sonTahkikat = [...tahkikatFormlari].sort((a, b) => b.tarih.localeCompare(a.tarih))[0]
                  if (!sonTahkikat) return null
                  const eleme = sonTahkikat.eliminasyonSonucu === 'RED'
                  const renk = eleme ? 'kirmizi' : getKararRenk(sonTahkikat.toplamPuan)
                  return (
                    <div className={`mb-4 overflow-hidden rounded-xl border-2 shadow-sm ${eleme ? 'border-rose-300 bg-rose-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
                      <div className={`flex flex-wrap items-center justify-between gap-2 border-b-2 px-4 py-2.5 ${eleme ? 'border-rose-300 bg-rose-100' : 'border-emerald-200 bg-emerald-100'}`}>
                        <h5 className={`text-sm font-black uppercase ${eleme ? 'text-rose-900' : 'text-emerald-900'}`}>Son Tahkikat Raporu Özeti</h5>
                        <span className="text-[11px] font-bold text-slate-600">{formatDate(sonTahkikat.tarih)} — {sonTahkikat.personel || 'Personel belirtilmemiş'}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                        {eleme ? (
                          <span className="rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-black uppercase text-rose-700">Eleme: RED</span>
                        ) : (
                          <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${KARAR_RENK_SINIFLARI[renk]}`}>
                            {sonTahkikat.toplamPuan ?? '-'} / {sonTahkikat.maksimumPuan} — {sonTahkikat.karar}
                          </span>
                        )}
                        {sonTahkikat.yardimTuruOnerisi && (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">Öneri: {sonTahkikat.yardimTuruOnerisi}</span>
                        )}
                      </div>
                      {eleme && sonTahkikat.eliminasyonRedNedeni && (
                        <p className="px-4 pb-3 text-xs font-semibold text-rose-700">{sonTahkikat.eliminasyonRedNedeni}</p>
                      )}
                      {tahkikatFormlari.length > 1 && (
                        <p className="border-t border-slate-200/70 px-4 py-1.5 text-[10px] font-bold text-slate-500">
                          Bu dosya için toplam {tahkikatFormlari.length} Tahkikat Formu kaydı var, en yenisi gösteriliyor.
                        </p>
                      )}
                    </div>
                  )
                })()}
                {tahkikatFormlariStatus === 'loading' && (
                  <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xs font-bold text-slate-500">Tahkikat formu özeti yükleniyor...</div>
                )}
                {tahkikatFormlariError && (
                  <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{tahkikatFormlariError}</div>
                )}

                {/* Kullanici istegi (13 Eylul 2026): "alan penceresi sayfada
                    görünmüyor, sayfa tam optimize değil" - asil doldurulacak
                    rapor formu, altta uzun listeler (Ev Ziyareti Raporlari,
                    Kayıtlı İnceleme Formları) arkasinda kalip gorunmuyordu.
                    Form artik hemen buraya (ozet karttan sonra) tasindi,
                    gecmis kayitlar ise altta acilir/kapanir bir bolumde. */}
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-sky-300 bg-sky-50 shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-sky-200 bg-sky-100 px-4 py-3">
                      <div>
                        <h5 className="text-sm font-black uppercase text-[#005f95]">Inceleme Gorevlisinin Hazirladigi Rapor</h5>
                        <p className="mt-0.5 text-[11px] font-bold text-slate-600">Bu alan salt okunurdur; komisyon kararina esas inceleme bilgisidir.</p>
                      </div>
                      <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[10px] font-black uppercase text-[#005f95]">Inceleme</span>
                    </div>
                    <div className="max-h-[220px] min-h-[160px] overflow-y-auto whitespace-pre-wrap bg-white/70 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
                      {resultTarget.lastVisitInfo || '-'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 shadow-sm">
                    <div className="mb-3">
                      <h5 className="text-sm font-black uppercase text-emerald-800">Komisyon Gorevlisinin Yazacagi Rapor</h5>
                      <p className="mt-0.5 text-[11px] font-bold text-slate-500">Komisyon gorevlisi bu alana raporunu yazip yardimlari baglar.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-extrabold uppercase text-slate-600">Tarih</span>
                    <input
                      type="date"
                      value={resultForm.date}
                      onChange={(event) => setResultForm((current) => ({ ...current, date: event.target.value }))}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-extrabold uppercase text-slate-600">Konu</span>
                    <select
                      value={resultForm.title}
                      onChange={(event) => setResultForm((current) => ({ ...current, title: event.target.value }))}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                    >
                      <option value="">Seciniz</option>
                      {resultForm.title && !investigationSubjectOptions.some((option) => option.name === resultForm.title) && (
                        <option value={resultForm.title}>{resultForm.title}</option>
                      )}
                      {investigationSubjectOptions.map((option) => (
                        <option key={option.id} value={option.name}>{option.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5 md:col-span-2">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase text-slate-600">Komisyon Raporu</span>
                      <button
                        type="button"
                        onClick={() => void toggleCommissionDictation()}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-black shadow-sm transition ${commissionDictationActive ? 'border-red-700 bg-red-600 text-white hover:bg-red-700' : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100'}`}
                        title={commissionDictationActive ? 'Mikrofonu kapat' : 'Mikrofonla yaz'}
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <path d="M12 19v3" />
                          <path d="M8 22h8" />
                        </svg>
                        {commissionDictationActive ? 'Dinleniyor' : 'Mikrofon'}
                      </button>
                    </span>
                    <textarea
                      value={resultForm.content}
                      onChange={(event) => setResultForm((current) => ({ ...current, content: event.target.value }))}
                      rows={10}
                      className="min-h-[220px] w-full resize-none rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-bold leading-6 text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 md:min-h-[260px] xl:min-h-[320px]"
                      placeholder="Komisyon raporu..."
                    />
                  </label>
                    </div>
                  </div>
                </div>

                <details className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="cursor-pointer list-none px-4 py-3 text-xs font-black uppercase text-slate-500 hover:bg-slate-50">
                    Geçmiş Ev Ziyareti ve İnceleme Formu Kayıtlarını Görüntüle ▾
                  </summary>

                {canViewHomeVisits && (
                <div className="mb-4 overflow-hidden rounded-xl border border-indigo-200 bg-indigo-50/60 shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-indigo-100 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h5 className="text-sm font-black uppercase text-indigo-900">Ev Ziyareti Raporları</h5>
                      <p className="mt-0.5 text-[11px] font-bold text-slate-500">Dosya için kaydedilmiş tüm ev ziyareti/tahkikat raporları (en yeniden eskiye)</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => resultTarget && void loadEvZiyaretleri(resultTarget.fileId)}
                      disabled={evZiyaretleriStatus === 'loading'}
                      className="h-8 rounded-md border border-indigo-200 bg-indigo-600 px-3 text-[10px] font-black uppercase text-white shadow-sm hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      {evZiyaretleriStatus === 'loading' ? 'Yükleniyor...' : 'Yenile'}
                    </button>
                  </div>

                  {evZiyaretleriError && (
                    <div className="m-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{evZiyaretleriError}</div>
                  )}

                  {evZiyaretleriStatus === 'loading' ? (
                    <div className="px-4 py-6 text-center text-sm font-bold text-slate-500">Ev ziyareti raporları yükleniyor...</div>
                  ) : evZiyaretleri.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm font-bold text-slate-500">Bu dosyada kayıtlı ev ziyareti raporu bulunamadı.</div>
                  ) : (
                    <div className="max-h-[260px] space-y-2 overflow-y-auto p-3">
                      {evZiyaretleri.map((kayit) => (
                        <div key={kayit.id} className="rounded-lg border border-indigo-100 bg-white p-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="rounded bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase text-indigo-800 ring-1 ring-indigo-100">{formatDate(kayit.date)}</span>
                            {kayit.userName && <span className="text-[11px] font-bold text-slate-500">{kayit.userName}</span>}
                          </div>
                          {kayit.title && <p className="mt-1.5 text-xs font-black text-slate-800">{kayit.title}</p>}
                          <p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-600">{kayit.content || '-'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )}

                <div className="mb-4 overflow-hidden rounded-xl border border-teal-200 bg-teal-50/70 shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-teal-100 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h5 className="text-sm font-black uppercase text-teal-900">Kayıtlı İnceleme Formları</h5>
                      <p className="mt-0.5 text-[11px] font-bold text-slate-500">İnceleme formu tablosundaki kayıtlar ve çıktı işlemleri</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => resultTarget && void loadEvaluationForms(resultTarget.fileId)}
                      disabled={evaluationFormsStatus === 'loading'}
                      className="h-8 rounded-md border border-teal-200 bg-teal-600 px-3 text-[10px] font-black uppercase text-white shadow-sm hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      {evaluationFormsStatus === 'loading' ? 'Yukleniyor...' : 'Yenile'}
                    </button>
                  </div>

                  {evaluationFormsError && (
                    <div className="m-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                      {evaluationFormsError}
                    </div>
                  )}

                  {evaluationFormsStatus === 'loading' ? (
                    <div className="px-4 py-6 text-center text-sm font-bold text-slate-500">İnceleme formları yükleniyor...</div>
                  ) : evaluationForms.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm font-bold text-slate-500">Bu dosyada kayıtlı inceleme formu bulunamadı.</div>
                  ) : (
                    <div className="max-h-[260px] overflow-y-auto p-3">
                      <div className="grid gap-2">
                        {evaluationForms.slice(0, 2).map((record) => (
                          <div
                            key={record.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => printEvaluationForm(record, false)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                printEvaluationForm(record, false)
                              }
                            }}
                            className="cursor-pointer rounded-lg border border-teal-100 bg-white p-3 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-teal-400"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded bg-teal-50 px-2 py-1 text-[10px] font-black uppercase text-teal-800 ring-1 ring-teal-100">
                                    {formatDate(cleanText(record.formTarihi))}
                                  </span>
                                  <span className="rounded bg-slate-50 px-2 py-1 text-[10px] font-black uppercase text-slate-700 ring-1 ring-slate-100">
                                    Puan {record.toplamPuan ?? 0} / 100
                                  </span>
                                </div>
                                <div className="mt-2 truncate text-sm font-black uppercase text-slate-950">
                                  {record.adSoyad || resultTarget.applicantName}
                                </div>
                                <p className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-600">
                                  {record.otomatikSonuc || record.sahaIncelemeOzeti || '-'}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    printEvaluationForm(record, false)
                                  }}
                                  className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[10px] font-black uppercase text-teal-800 shadow-sm hover:bg-teal-100"
                                >
                                  Görüntüle
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    printEvaluationForm(record)
                                  }}
                                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 shadow-sm hover:bg-slate-50"
                                >
                                  Yazdır
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </details>
              </div>

              <section className="flex min-h-0 w-full max-w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm xl:w-max">
                <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 md:px-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h4 className="text-sm font-black uppercase text-[#005f95]">Müracaat ve Yardım Kayıtları</h4>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">Ekmek, Gida, Destek Paketi ve Hazir Yemek kayitlari</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="text-[9px] font-black uppercase text-slate-400">Mur.</div>
                      <div className="text-sm font-black text-slate-950">{applicationCount}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="text-[9px] font-black uppercase text-slate-400">Yrd.</div>
                      <div className="text-sm font-black text-slate-950">{assistanceCount}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="text-[9px] font-black uppercase text-slate-400">Tur</div>
                      <div className="text-sm font-black text-slate-950">{visibleServiceTypeCount}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsQuickAddOpen((current) => !current)
                        setQuickAddError('')
                      }}
                      disabled={quickAddStatus === 'saving'}
                      className="h-8 rounded border border-[#0076b6] bg-[#0076b6] px-3 text-[10px] font-black text-white shadow-sm hover:bg-[#005f95] disabled:cursor-wait disabled:opacity-60"
                    >
                      Yardim Ekle
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadAssistances(resultTarget.fileId)}
                      disabled={assistanceStatus === 'loading' || Boolean(savingAssistanceKey)}
                      className="h-8 rounded border border-sky-200 bg-white px-3 text-[10px] font-black text-[#005f95] shadow-sm hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      Yenile
                    </button>
                  </div>
                </div>

                {assistanceError && (
                  <div className="m-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                    {assistanceError}
                  </div>
                )}

                {isQuickAddOpen && (
                  <div className="m-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_minmax(120px,0.6fr)]">
                      <label className="text-[10px] font-black uppercase text-slate-600">
                        Yardim Turu
                        <select
                          value={quickAddForm.type}
                          onChange={(event) => setQuickAddForm((current) => ({
                            ...current,
                            type: event.target.value as QuickAssistanceType,
                            breakfastAmount: '',
                          }))}
                          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                        >
                          {quickAssistanceTypes.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] font-black uppercase text-slate-600">
                        Periyot
                        <select
                          value={quickAddForm.period}
                          onChange={(event) => updateQuickAddPeriod(event.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                        >
                          {periodOptions.map((period) => (
                            <option key={period} value={period}>{period}</option>
                          ))}
                          <option value="Sureli">Sureli (Tek Seferlik)</option>
                          <option value="Periyodik">Periyodik</option>
                        </select>
                      </label>
                      <label className="text-[10px] font-black uppercase text-slate-600">
                        Miktar
                        <input
                          value={quickAddForm.amount}
                          onChange={(event) => setQuickAddForm((current) => ({ ...current, amount: event.target.value }))}
                          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                        />
                      </label>
                    </div>

                    {quickAddError && (
                      <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                        {quickAddError}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsQuickAddOpen(false)
                          setQuickAddError('')
                          setQuickAddForm(createDefaultQuickAssistanceForm())
                        }}
                        disabled={quickAddStatus === 'saving'}
                        className="h-9 rounded-md border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        Vazgec
                      </button>
                      <button
                        type="button"
                        onClick={() => void createQuickAssistance()}
                        disabled={quickAddStatus === 'saving'}
                        className="h-9 rounded-md border border-[#6fb744] bg-[#6fb744] px-4 text-xs font-black text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
                      >
                        {quickAddStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                      </button>
                    </div>
                  </div>
                )}

                {assistanceStatus === 'loading' ? (
                  <div className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    Kayitlar yukleniyor...
                  </div>
                ) : assistanceRows.length === 0 ? (
                  <div className="min-h-0 flex-1 overflow-auto px-5 py-6">
                    <div className="mx-auto max-w-4xl rounded-lg border border-dashed border-sky-200 bg-sky-50/50 p-5 text-left">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h5 className="text-sm font-black uppercase text-[#005f95]">Kayıt bulunamadı</h5>
                          <p className="mt-1 text-xs font-bold text-slate-600">
                            Bu dosyada Ekmek, Gida, Destek Paketi veya Hazir Yemek muracaati/yardimi yok.
                          </p>
                        </div>
                      </div>

                      {false && isQuickAddOpen && (
                        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_minmax(120px,0.6fr)]">
                            <label className="text-[10px] font-black uppercase text-slate-600">
                              Yardim Turu
                              <select
                                value={quickAddForm.type}
                                onChange={(event) => setQuickAddForm((current) => ({
                                  ...current,
                                  type: event.target.value as QuickAssistanceType,
                                  breakfastAmount: event.target.value === 'Hazır Yemek' ? current.breakfastAmount : '',
                                }))}
                                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                              >
                                {quickAssistanceTypes.map((type) => (
                                  <option key={type} value={type}>{type}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-[10px] font-black uppercase text-slate-600">
                              Periyot
                              <select
                                value={quickAddForm.period}
                                onChange={(event) => updateQuickAddPeriod(event.target.value)}
                                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                              >
                                {periodOptions.map((period) => (
                                  <option key={period} value={period}>{period}</option>
                                ))}
                                <option value="Sureli">Sureli (Tek Seferlik)</option>
                                <option value="Periyodik">Periyodik</option>
                              </select>
                            </label>
                            <label className="text-[10px] font-black uppercase text-slate-600">
                              Miktar
                              <input
                                value={quickAddForm.amount}
                                onChange={(event) => setQuickAddForm((current) => ({ ...current, amount: event.target.value }))}
                                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                              />
                            </label>
                          </div>

                          {quickAddError && (
                            <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                              {quickAddError}
                            </div>
                          )}

                          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setIsQuickAddOpen(false)
                                setQuickAddError('')
                                setQuickAddForm(createDefaultQuickAssistanceForm())
                              }}
                              disabled={quickAddStatus === 'saving'}
                              className="h-9 rounded-md border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              Vazgec
                            </button>
                            <button
                              type="button"
                              onClick={() => void createQuickAssistance()}
                              disabled={quickAddStatus === 'saving'}
                              className="h-9 rounded-md border border-[#6fb744] bg-[#6fb744] px-4 text-xs font-black text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
                            >
                              {quickAddStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto">
                    {/* Kullanici istegi (14 Eylul 2026, 2. tur): "alanlar tek
                        satırda normal görünsün, sığmıyor ise kaydırma
                        çubuğu ile bu alanı yana kaydıralım" - bir onceki
                        turde eklenen mobil dikey kart gorunumu (kullanici
                        istemedi) KALDIRILDI, tek tabloya donuldu; disaridaki
                        "overflow-auto" sarmalayici zaten yatay kaydirmayi
                        sagliyor. */}
                    <table className="w-auto min-w-[760px] border-collapse text-left text-[11px]">
                      <thead className="sticky top-0 z-10 bg-sky-50 text-[10px] font-black uppercase text-[#005f95] shadow-sm">
                        <tr>
                          <th style={{ width: serviceColumnWidths.process }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Surec</th>
                          <th style={{ width: serviceColumnWidths.type }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Yardım</th>
                          <th style={{ width: serviceColumnWidths.period }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Periyot</th>
                          <th style={{ width: serviceColumnWidths.startDate }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Baslangic</th>
                          <th style={{ width: serviceColumnWidths.endDate }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Bitis</th>
                          <th style={{ width: serviceColumnWidths.amount }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Miktar</th>
                          <th style={{ width: serviceColumnWidths.status }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5">Durum</th>
                          <th style={{ width: serviceColumnWidths.action }} className="whitespace-nowrap border-b border-sky-100 px-1.5 py-1.5 text-right">Islem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assistanceRows.map((row, index) => {
                          const rowKey = `${row.kind}:${row.sourceTable}:${row.recordId}`
                          const isSavingRow = savingAssistanceKey === rowKey

                          return (
                            <tr key={rowKey} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} hover:bg-sky-50/70`}>
                              <td style={{ width: serviceColumnWidths.process }} className="whitespace-nowrap border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase ring-1 ${
                                  row.kind === 'application'
                                    ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                                }`}>
                                  {row.kind === 'application' ? 'Muracaat' : 'Yardim'}
                                </span>
                              </td>
                              <td style={{ width: serviceColumnWidths.type }} className="whitespace-nowrap border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <div className="font-black text-slate-900">{row.type}</div>
                              </td>
                              <td style={{ width: serviceColumnWidths.period }} className="border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <select
                                  value={row.periodInfo}
                                  onChange={(event) => updateAssistancePeriod(row, rowKey, event.target.value)}
                                  style={{ width: serviceColumnWidths.period }}
                                  className="h-7 rounded border border-slate-300 bg-white px-1 text-[10px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                >
                                  <option value="">Periyot seciniz...</option>
                                  {row.periodInfo && !periodOptions.includes(row.periodInfo) && !['Sureli', 'Periyodik'].includes(row.periodInfo) && (
                                    <option value={row.periodInfo}>{row.periodInfo}</option>
                                  )}
                                  {periodOptions.map((period) => (
                                    <option key={period} value={period}>{period}</option>
                                  ))}
                                  <option value="Sureli">Sureli (Tek Seferlik)</option>
                                  <option value="Periyodik">Periyodik</option>
                                </select>
                              </td>
                              <td style={{ width: serviceColumnWidths.startDate }} className="border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <input
                                  type="date"
                                  value={row.formStartDate}
                                  onChange={(event) => updateAssistanceStartDate(row, rowKey, event.target.value)}
                                  style={{ width: serviceColumnWidths.startDate }}
                                  className="h-7 rounded border border-slate-300 bg-white px-1 text-[10px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                              </td>
                              <td style={{ width: serviceColumnWidths.endDate }} className="border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <input
                                  type="date"
                                  value={row.formEndDate}
                                  onChange={(event) => updateAssistanceRow(rowKey, { formEndDate: event.target.value })}
                                  style={{ width: serviceColumnWidths.endDate }}
                                  className="h-7 rounded border border-slate-300 bg-white px-1 text-[10px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                              </td>
                              <td style={{ width: serviceColumnWidths.amount }} className="border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <input
                                  value={row.amount}
                                  onChange={(event) => updateAssistanceRow(rowKey, { amount: event.target.value })}
                                  style={{ width: serviceColumnWidths.amount }}
                                  className="h-7 rounded border border-slate-300 bg-white px-1 text-[10px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                />
                              </td>
                              <td style={{ width: serviceColumnWidths.status }} className="border-b border-slate-100 px-1.5 py-1.5 align-middle">
                                <select
                                  value={row.status}
                                  onChange={(event) => updateAssistanceRow(rowKey, { status: event.target.value })}
                                  style={{ width: serviceColumnWidths.status }}
                                  className="h-7 rounded border border-slate-300 bg-white px-1 text-[10px] font-bold text-slate-900 outline-none focus:border-[#0076b6]"
                                >
                                  <option value="">-</option>
                                  {row.status && !assistanceStatusOptions.some((option) => option.id === row.status) && (
                                    <option value={row.status}>{getStatusDisplayValue(row.status, assistanceStatusOptions)}</option>
                                  )}
                                  {assistanceStatusOptions.map((option) => (
                                    <option key={option.id} value={option.id}>{option.id} - {option.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ width: serviceColumnWidths.action }} className="whitespace-nowrap border-b border-slate-100 px-1.5 py-1.5 text-right align-middle">
                                <button
                                  type="button"
                                  onClick={() => void saveAssistanceRow(row)}
                                  disabled={Boolean(savingAssistanceKey)}
                                  className="h-7 rounded border border-[#6fb744] bg-[#f1faed] px-1.5 text-[9px] font-black uppercase text-[#3f7f28] hover:bg-[#e5f5dc] disabled:cursor-wait disabled:opacity-60"
                                >
                                  {isSavingRow ? 'Kaydediliyor...' : 'Guncelle'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-3 md:px-5">
              <button
                type="button"
                onClick={closeResultForm}
                disabled={resultStatus !== 'idle'}
                className="h-10 rounded-md border border-slate-300 bg-white px-5 text-sm font-extrabold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                Vazgec
              </button>
              <button
                type="button"
                onClick={() => void openAssistancesWithReport()}
                disabled={resultStatus !== 'idle' || quickAddStatus === 'saving'}
                className="h-10 rounded-md border border-[#6fb744] bg-[#6fb744] px-5 text-sm font-extrabold text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
              >
                {resultStatus === 'opening' ? 'Yardimlar Aciliyor...' : 'Yardimlari Ac'}
              </button>
              <button
                type="button"
                onClick={() => void saveResultReport()}
                disabled={resultStatus !== 'idle'}
                className="h-10 rounded-md border border-[#0076b6] bg-[#0076b6] px-6 text-sm font-extrabold text-white shadow-sm hover:bg-[#005f95] disabled:cursor-wait disabled:opacity-60"
              >
                {resultStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
