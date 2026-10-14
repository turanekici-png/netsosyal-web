'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { useFloatingPanel } from '@/lib/hooks/useFloatingPanel'
import { useHoldWorkflowRecord, useWorkflowLocks, workflowLockConfirmText, type WorkflowLock } from '@/lib/hooks/useWorkflowPresence'
import { WORKFLOW_LOCKED_ROW_CLASS, WorkflowLockNotice } from '@/components/workflow/WorkflowLockNotice'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  findPredefinedCategoryByCandidates,
  type PredefinedValue,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import type { SahaIncelemeKaydi } from '@/lib/constants/sahaIncelemeForm'
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
  // tahkikat raporu bilgiside görünsün" - en son Tahkikat Formu (2026-10-13'ten
  // beri "Hane Ziyareti ve Sosyal İnceleme Formu", saha_inceleme_formu) ozeti.
  lastTahkikatDate: string | null
  lastTahkikatAciliyet: string | null
  lastTahkikatZiyaretSonucu: string | null
  lastTahkikatOnDegerlendirme: string | null
  tcKimlikNo?: string | null
  birthDate?: string | null
  householdCount?: number | null
}

// Aciliyet degerine gore rozet rengi (Acil = kirmizi, Öncelikli = amber).
function aciliyetSinifi(aciliyet: string | null): string {
  const n = (aciliyet || '').toLocaleLowerCase('tr-TR')
  if (n.startsWith('acil')) return 'border-rose-300 bg-rose-50 text-rose-700'
  if (n.startsWith('öncelikli')) return 'border-amber-300 bg-amber-50 text-amber-800'
  return 'border-slate-300 bg-slate-50 text-slate-700'
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
type TahkikatFormOzet = SahaIncelemeKaydi

// Dosya Yönetimi > Raporlar ve Tahkikatlar > İnceleme / Onay sekmelerindeki
// raporlar (/api/reports?requestId=) - 2026-10-14 Gecmis Raporlar'da da gorunur.
type DosyaRaporu = {
  id: string
  date: string | null
  title: string | null
  content: string | null
  userName: string | null
  approverName: string | null
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
// 2026-10-14: "Kış Dönemi" - Dosya Yönetimi ile ayni kural (bkz.
// app/(modules)/documents/page.tsx KIS_DONEMI_PERIOD_LABEL ve
// lib/services/winterSeasonalAid.service.ts): 01 Kasim - 30 Nisan, sabit
// tarihler. Musracaat beklemede kalir, 01 Kasim'da otomatik yardima doner;
// zaten devam eden yardimda baslangic korunur, 30 Nisan'da otomatik kesilir.
// Bu sayfadaki 4 tur (visibleServiceTables) de Kış Dönemi destekler.
const KIS_DONEMI_PERIOD_LABEL = 'Kış Dönemi'
const getKisDonemiDates = () => {
  const yil = new Date().getFullYear()
  return { startDate: `${yil}-11-01`, endDate: `${yil + 1}-04-30` }
}
// Kış Dönemi müracaatı, baslangici henuz gelmediyse elle yardima
// donusturulmez - zamanlayici 01 Kasim'da kendisi acar.
const isKisDonemiBekleyen = (row: { periodInfo: string; formStartDate: string }) =>
  row.periodInfo === KIS_DONEMI_PERIOD_LABEL && !!row.formStartDate && row.formStartDate > getTodayInputDate()
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

// Siralama anahtari: "YYYY-MM-DD" (ISO zaman damgasi gelirse Turkiye gunune cevrilir)
function raporOnayMi(rapor: DosyaRaporu) {
  const konu = (rapor.title || '').toLocaleLowerCase('tr-TR')
  const onaylayan = (rapor.approverName || '').trim()
  return konu.includes('onay talebi') || (onaylayan !== '' && onaylayan !== '-')
}

function tarihAnahtari(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const tarih = new Date(text)
  if (Number.isNaN(tarih.getTime())) return text.slice(0, 10)
  return tarih.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })
}

async function panoyaKopyala(metin: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(metin)
      return true
    }
  } catch {
    /* yedek yonteme gec */
  }
  try {
    const alan = document.createElement('textarea')
    alan.value = metin
    alan.setAttribute('readonly', '')
    alan.style.position = 'fixed'
    alan.style.opacity = '0'
    document.body.appendChild(alan)
    alan.select()
    const tamam = document.execCommand('copy')
    document.body.removeChild(alan)
    return tamam
  } catch {
    return false
  }
}

// 2026-10-14: Komisyon penceresinde dosya sahibi bilgileri - cift tiklayinca kopyalanir.
function KopyalanabilirBilgi({ etiket, deger, genis = false }: { etiket: string; deger: string; genis?: boolean }) {
  const [durum, setDurum] = useState<'' | 'tamam' | 'hata'>('')
  const bos = !deger || deger === '-'
  const kopyala = async () => {
    if (bos) return
    const sonuc = await panoyaKopyala(deger)
    setDurum(sonuc ? 'tamam' : 'hata')
    window.setTimeout(() => setDurum(''), 1400)
  }
  return (
    <div
      onDoubleClick={() => void kopyala()}
      title={bos ? undefined : 'Kopyalamak için çift tıklayın'}
      className={`relative min-w-0 select-text rounded-md border px-2.5 py-1.5 transition ${genis ? 'col-span-full' : ''} ${durum === 'tamam' ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50'} ${bos ? '' : 'cursor-copy'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{etiket}</span>
        {durum === 'tamam' && <span className="text-[11px] font-bold text-emerald-700">Kopyalandı ✓</span>}
        {durum === 'hata' && <span className="text-[11px] font-bold text-rose-700">Kopyalanamadı</span>}
      </div>
      <div className={`mt-0.5 break-words text-[14px] font-bold leading-snug ${bos ? 'text-slate-400' : 'text-slate-900'} ${etiket === 'T.C. Kimlik No' || etiket === 'Telefon' || etiket === 'Doğum Tarihi' ? 'tabular-nums' : ''}`}>
        {bos ? '—' : deger}
      </div>
    </div>
  )
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
// bilgiside görünsün" - dosyanin en son Tahkikat Formu kaydinin (tarih +
// aciliyet / ziyaret sonucu) kisa bir rozet metnine cevrilmesi. Kayit yoksa null.
function getTahkikatBadge(row: UpdateWorkflowFile): { text: string; className: string } | null {
  if (!row.lastTahkikatDate) return null
  const detay = row.lastTahkikatAciliyet ? `Aciliyet: ${row.lastTahkikatAciliyet}` : row.lastTahkikatZiyaretSonucu
  return {
    text: `${formatDate(row.lastTahkikatDate)}${detay ? ` — ${detay}` : ''}`,
    className: aciliyetSinifi(row.lastTahkikatAciliyet),
  }
}

// Duz liste ve mahalleye-gore-gruplu liste AYNI satir gorunumunu kullansin
// diye ayri bir bilesene cikarildi (kullanici istegi 13 Eylul 2026: Sonuç
// Bekleyen sayfasi da ön inceleme/tahkikat sayfalariyla AYNI telefon/
// mahalle/adres + mahalle secici duzenine getirildi).
function GuncellemeTableRow({ row, index, onOpenFile, onOpenReport, lock }: {
  row: UpdateWorkflowFile
  index: number
  lock?: WorkflowLock
  onOpenFile: (row: UpdateWorkflowFile) => void
  onOpenReport: (row: UpdateWorkflowFile) => void
}) {
  // Kullanici istegi (2026-10-14): "veriler çok küçük, okunamıyor ve
  // anlaşılmıyor" - yazilar buyutuldu (ns-tablo-sonuc), dar sutunlarda
  // kesilen metinler (adres, "Aciliyet: Rutin...", kullanici adi) artik
  // kesilmiyor; sutunlar genisletildi (kullanicinin "kucultme yerine
  // genislet" tercihi). Islev/veri DEGISMEDI.
  // 2026-10-14: "inceleme yapan kullanici ve son ev ziyareti tarihi
  // isaretli alana (kaydin ustundeki seride) yazilsin, diger alandan
  // kaldirilsin" - her dosyanin hemen ustunde, Adres + Son Ev Ziyareti
  // Bilgisi sutunlarinin uzerinde ince bir bilgi satiri; iki sutun kalkti.
  const zemin = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'
  return (
    <>
    <tr className={`ns-meta ${zemin} ${lock ? WORKFLOW_LOCKED_ROW_CLASS : ''}`}>
      <td colSpan={3} />
      <td colSpan={3}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-1 text-[17.5px] font-extrabold text-[#005f95] ring-1 ring-sky-300">
            <span className="font-semibold text-slate-500">İnceleme Yapan:</span> {row.visitUserName || '-'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 text-[17.5px] font-extrabold tabular-nums text-slate-800 ring-1 ring-slate-300">
            <span className="font-semibold text-slate-500">Son Ev Ziyareti:</span> {formatDate(row.lastVisitDate)}
          </span>
        </div>
      </td>
    </tr>
    <tr className={`${zemin} align-top transition hover:bg-sky-50 ${lock ? WORKFLOW_LOCKED_ROW_CLASS : ''}`}>
      <td className="whitespace-nowrap border-b border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={() => onOpenFile(row)}
          title="Dosyayı aç"
          className="text-[21px] font-black text-[#0076b6] underline decoration-sky-300 underline-offset-4 hover:decoration-[#0076b6]"
        >
          {row.fileNo}
        </button>
      </td>
      <td className="min-w-[200px] border-b border-slate-100 px-4 py-3 text-[20px] font-extrabold leading-snug text-slate-900">
        {row.applicantName}
        {lock && <WorkflowLockNotice lock={lock} genis />}
      </td>
      <td className="min-w-[160px] border-b border-slate-100 px-4 py-3 text-[18.5px] font-bold leading-snug text-slate-800">
        {row.neighborhood}
      </td>
      <td className="min-w-[280px] max-w-[340px] border-b border-slate-100 px-4 py-3 text-[17.5px] font-semibold leading-snug text-slate-800">
        {row.address}
      </td>
      {/* Kullanici istegi (13 Eylul 2026): "işaretli tahkikat raporu alanını
          genişletelim diğer alanları daraltalım, yazı fontunu büyütelim" -
          Tahkikat Formu kaydedilince ozet paragrafi artik bu koloni
          (Son Ev Ziyareti Bilgisi) doldurduğu icin diger kolonlar daraltilip
          bu genislikle (satir kirpma da kaldirilarak, metin tam okunabilsin
          diye) buyutuldu. */}
      <td className="min-w-[580px] border-b border-slate-100 px-4 py-3 text-[18.5px] font-medium leading-relaxed text-slate-900">
        <span className="block whitespace-pre-wrap">{row.lastVisitInfo}</span>
      </td>
      <td className="whitespace-nowrap border-b border-slate-100 px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onOpenReport(row)}
          className="inline-flex items-center rounded-md border border-[#6fb744] bg-[#f1faed] px-4 py-2 text-[16.5px] font-black uppercase text-[#3f7f28] shadow-sm transition hover:bg-[#e5f5dc]"
        >
          İnceleme Formları
        </button>
      </td>
    </tr>
    </>
  )
}

function GuncellemeMobileCard({ row, onOpenFile, onOpenReport, lock }: {
  row: UpdateWorkflowFile
  lock?: WorkflowLock
  onOpenFile: (row: UpdateWorkflowFile) => void
  onOpenReport: (row: UpdateWorkflowFile) => void
}) {
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${lock ? 'border-rose-300 bg-rose-100 shadow-[inset_5px_0_0_#e11d48]' : 'border-sky-100 bg-white'}`}>
      {lock && <WorkflowLockNotice lock={lock} className="mb-2 mt-0" />}
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
  // 2026-10-14: baska kullanicida acik kayitlar (kirmizi) + benim actigim kaydi tut
  const kilitler = useWorkflowLocks('guncelleme')
  useHoldWorkflowRecord('guncelleme', resultTarget?.fileId)
  const [resultForm, setResultForm] = useState({ date: getTodayInputDate(), title: 'Komisyon Raporu', content: '' })
  const [resultStatus, setResultStatus] = useState<'idle' | 'saving' | 'opening'>('idle')
  const [resultError, setResultError] = useState('')
  const [evaluationForms, setEvaluationForms] = useState<IncelemeFormRecord[]>([])
  const [evaluationFormsStatus, setEvaluationFormsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [evaluationFormsError, setEvaluationFormsError] = useState('')
  const [tahkikatFormlari, setTahkikatFormlari] = useState<TahkikatFormOzet[]>([])
  const [tahkikatFormlariStatus, setTahkikatFormlariStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [tahkikatFormlariError, setTahkikatFormlariError] = useState('')
  const [dosyaRaporlari, setDosyaRaporlari] = useState<DosyaRaporu[]>([])
  const [dosyaRaporlariStatus, setDosyaRaporlariStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [dosyaRaporlariError, setDosyaRaporlariError] = useState('')
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
  // 2026-10-14: gecmis tahkikat / ev ziyareti / inceleme formlari ayri pencerede
  const [gecmisAcik, setGecmisAcik] = useState(false)
  // 2026-10-14: iki pencere de tasinabilir / boyutlandirilabilir / ekrani
  // kaplayip kuculebilir; Ctrl + tekerlek icerigi buyutur (bkz. useFloatingPanel)
  // 2026-10-14: ref'ler hook nesnesinden ayrildi - React derleyici kurali
  // ref iceren nesnenin TUM alanlarini (panelStyle, isMaximized...) render
  // sirasinda "ref okuma" sayiyordu. Davranis AYNI.
  const { overlayRef: anaOverlayRef, panelRef: anaPanelRef, ...anaPencere } = useFloatingPanel({ startMaximized: true, restoreWidthRatio: 0.86, restoreHeightRatio: 0.86, minWidth: 640, minHeight: 420 })
  const { overlayRef: gecmisOverlayRef, panelRef: gecmisPanelRef, ...gecmisPencere } = useFloatingPanel({ startMaximized: false, restoreWidthRatio: 0.62, maxRestoreWidth: 980, restoreHeightRatio: 0.8, minWidth: 460, minHeight: 300 })
  const [gecmisSekme, setGecmisSekme] = useState<'tumu' | 'inceleme'>('tumu')
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
  // 2026-10-14: efekt yerine React'in onerdigi "render sirasinda korumali
  // ayar" - ayni sonuc, bir ara bos cizim (titreme) olmadan.
  if (selectedNeighborhood !== 'all' && !neighborhoodGroups.some((group) => group.neighborhood === selectedNeighborhood)) {
    setSelectedNeighborhood('all')
  }

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

  const openResultForm = async (row: UpdateWorkflowFile) => {
    const kilit = kilitler.get(row.fileId)
    if (kilit && !(await confirmDialog(workflowLockConfirmText(kilit), 'Yine de Aç', 'Vazgeç'))) return
    setResultTarget(row)
    setResultForm({ date: getTodayInputDate(), title: 'Komisyon Raporu', content: '' })
    setResultError('')
    setIsQuickAddOpen(false)
    setQuickAddError('')
    setQuickAddForm(createDefaultQuickAssistanceForm())
    void loadAssistances(row.fileId)
    void loadEvaluationForms(row.fileId)
    void loadTahkikatFormlari(row.fileId)
    void loadDosyaRaporlari(row.fileId)
    void loadEvZiyaretleri(row.fileId)
  }

  const closeResultForm = () => {
    if (resultStatus !== 'idle' || quickAddStatus === 'saving') return
    setGecmisAcik(false)
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
    setDosyaRaporlari([])
    setDosyaRaporlariStatus('idle')
    setDosyaRaporlariError('')
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
  // api/documents/saha-inceleme), yukaridaki eski/dead loadEvaluationForms
  // (inceleme_formu) ile KARISTIRILMASIN.
  const loadDosyaRaporlari = async (fileId: string) => {
    setDosyaRaporlariStatus('loading')
    setDosyaRaporlariError('')
    try {
      const response = await fetch(`/api/reports?requestId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
        throw new Error(payload?.error || 'İnceleme raporları alınamadı.')
      }
      setDosyaRaporlari((payload.data as Array<Record<string, unknown>>).map((rapor) => ({
        id: String(rapor.id ?? ''),
        date: rapor.date ? String(rapor.date) : null,
        title: rapor.title ? String(rapor.title) : null,
        content: rapor.content ? String(rapor.content) : null,
        userName: rapor.userName ? String(rapor.userName) : null,
        approverName: rapor.approverName ? String(rapor.approverName) : null,
      })))
      setDosyaRaporlariStatus('ready')
    } catch (error) {
      setDosyaRaporlari([])
      setDosyaRaporlariStatus('error')
      setDosyaRaporlariError(error instanceof Error ? error.message : 'İnceleme raporları alınamadı.')
    }
  }

  const loadTahkikatFormlari = async (fileId: string) => {
    setTahkikatFormlariStatus('loading')
    setTahkikatFormlariError('')
    try {
      const response = await fetch(`/api/documents/saha-inceleme?dosyaId=${encodeURIComponent(fileId)}`, { cache: 'no-store' })
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
    if (periodInfo === KIS_DONEMI_PERIOD_LABEL) {
      // Devam eden yardimda baslangic korunur (kesintisiz surer), digerlerinde 01 Kasim
      const kis = getKisDonemiDates()
      const devamEdiyor = row.kind === 'assistance' && row.status === '2'
      updateAssistanceRow(rowKey, {
        periodInfo,
        formStartDate: devamEdiyor && row.formStartDate ? row.formStartDate : kis.startDate,
        formEndDate: kis.endDate,
      })
      return
    }

    const monthCount = getPeriodMonthCount(periodInfo)
    const startDate = row.formStartDate || getTodayInputDate()

    updateAssistanceRow(rowKey, {
      periodInfo,
      formStartDate: monthCount > 0 && !row.formStartDate ? startDate : row.formStartDate,
      formEndDate: monthCount > 0 ? addMonthsToInputDate(startDate, monthCount) : row.formEndDate,
    })
  }

  const updateAssistanceStartDate = (row: ServiceRecordFormRow, rowKey: string, startDate: string) => {
    if (row.periodInfo === KIS_DONEMI_PERIOD_LABEL) return // sabit tarihler
    const monthCount = getPeriodMonthCount(row.periodInfo)

    updateAssistanceRow(rowKey, {
      formStartDate: startDate,
      formEndDate: monthCount > 0 ? addMonthsToInputDate(startDate, monthCount) : row.formEndDate,
    })
  }

  const updateQuickAddPeriod = (period: string) => {
    if (period === KIS_DONEMI_PERIOD_LABEL) {
      setQuickAddForm((current) => ({ ...current, period, ...getKisDonemiDates() }))
      return
    }

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

      for (const row of assistanceRows) {
        // Kış Dönemi müracaati 01 Kasim'dan once acilmaz - beklemede (0) kalir
        const isApplicationApproved = row.kind === 'application' && row.status === '2'
        const shouldConvertApplication = isApplicationApproved && !isKisDonemiBekleyen(row)
        const detailsPayload: Record<string, string> = {
          mode: 'details',
          sourceTable: row.sourceTable,
          recordId: row.recordId,
          fileId,
          status: isApplicationApproved ? '0' : (row.status || '0'),
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

      // 2026-10-14: durum sunucuda VERITABANINDAKI aktif yardima gore
      // belirlenir (Gida/Donem Disi Gida/Destek Paketi/Ekmek/Hazir Yemek
      // durumu=2 -> 3 Yardim Yapilabilir, yoksa 4 Yardim Yapilamaz). Aktif
      // yardimlara dokunulmaz, bitis tarihlerine kadar devam ederler.
      const fileStatusResponse = await fetch('/api/documents/file-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          date: resultForm.date,
          autoByActiveAssistance: true,
          description: resultForm.content,
        }),
      })
      const fileStatusPayload = await fileStatusResponse.json()

      if (!fileStatusResponse.ok || !fileStatusPayload.success) {
        throw new Error(fileStatusPayload.error || 'Dosya durumu guncellenemedi.')
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
        const kisBekleyen = isKisDonemiBekleyen(row)
        const detailsPayload: Record<string, string> = {
          mode: 'details',
          sourceTable: row.sourceTable,
          recordId: row.recordId,
          fileId,
          status: kisBekleyen ? '0' : (row.status || '0'),
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

        // Kış Dönemi: kaydedildi, 01 Kasim'da zamanlayici yardima donusturur
        if (kisBekleyen) continue

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
  // En son tahkikat (Hane Ziyareti) formu - pencerede ozet kartin basliginda
  const sonTahkikat = [...tahkikatFormlari].sort((a, b) => b.tarih.localeCompare(a.tarih) || Number(b.id) - Number(a.id))[0] ?? null
  // 2026-10-14: Gecmis Raporlar - tahkikat formlari + ev ziyareti raporlari TEK
  // listede, yeniden eskiye. Her tahkikat formu kayitta kendi Ev Ziyareti
  // satirini da olusturur (evziyaretiId) - o satir ayrica GOSTERILMEZ (tekrar).
  const formunEvZiyaretleri = new Set(tahkikatFormlari.map((form) => form.evziyaretiId).filter(Boolean) as string[])
  const gecmisKayitlari = [
    ...tahkikatFormlari.map((form) => ({ tur: 'tahkikat' as const, anahtar: 't-' + form.id, tarih: tarihAnahtari(form.tarih), id: Number(form.id) || 0, form })),
    ...(canViewHomeVisits ? evZiyaretleri : [])
      .filter((kayit) => !formunEvZiyaretleri.has(String(kayit.id)))
      .map((kayit) => ({ tur: 'ev' as const, anahtar: 'e-' + kayit.id, tarih: tarihAnahtari(kayit.date), id: Number(kayit.id) || 0, kayit })),
    // Dosya Yönetimi > Raporlar ve Tahkikatlar (İnceleme + Onay) - ayni sekilde
    ...dosyaRaporlari.map((rapor) => ({ tur: 'rapor' as const, anahtar: 'r-' + rapor.id, tarih: tarihAnahtari(rapor.date), id: Number(rapor.id) || 0, rapor })),
  ].sort((a, b) => b.tarih.localeCompare(a.tarih) || (a.tur === b.tur ? b.id - a.id : a.tur === 'tahkikat' ? -1 : b.tur === 'tahkikat' ? 1 : 0))
  const gecmisToplam = gecmisKayitlari.length + evaluationForms.length

  const serviceColumnWidths = useMemo(() => ({
    process: getColumnWidth(assistanceRows.map((row) => (row.kind === 'application' ? 'Muracaat' : 'Yardim')), 9, 12),
    type: getColumnWidth(assistanceRows.map((row) => row.type), 10, 18),
    // 2026-10-14: sutunlar icerik kadar - sadece satirda GORUNEN deger (+ ok)
    period: getColumnWidth(assistanceRows.map((row) => (row.periodInfo === 'Sureli' ? 'Süreli (Tek Seferlik)' : row.periodInfo) || 'Periyot seçiniz...'), 12, 26),
    startDate: '15ch',
    endDate: '15ch',
    amount: getColumnWidth(assistanceRows.map((row) => row.amount || 'Miktar'), 8, 16),
    status: getColumnWidth(assistanceRows.map((row) => {
      const secenek = assistanceStatusOptions.find((option) => option.id === row.status)
      return secenek ? `${secenek.id} - ${secenek.name}` : getStatusDisplayValue(row.status, assistanceStatusOptions) || '-'
    }), 8, 26),
    action: '9ch',
  }), [assistanceRows, assistanceStatusOptions])

  return (
    <div className="space-y-5 text-slate-950">
      <div className="ns-sayfa-baslik relative overflow-hidden rounded-lg border border-sky-200 bg-white px-5 py-4 shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-[#0076b6] to-[#6fb744]" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[12px] font-black uppercase tracking-wide text-[#0076b6]">İş Akışı</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-[34px]">Güncelleme Dosyaları</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">Dosya durumu güncelleme olan kayıtlar</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-black text-[#005f95] shadow-sm">
              Toplam {filteredRows.length} kayıt
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
            <h2 className="text-[17px] font-black uppercase tracking-wide text-[#1E2A38]">Güncelleme Listesi</h2>
            <p className="mt-1 text-[15px] font-bold text-slate-500">Dosya no, sahip bilgisi, mahalle, adres, son ev ziyareti ve kullanıcı</p>
          </div>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Dosya no, ad soyad, telefon, mahalle, adres, ev ziyareti bilgisi veya kullanıcı ara..."
            className="h-11 w-full rounded-md border border-slate-200 px-3 text-[15px] font-bold text-slate-950 outline-none transition focus:border-[#0076b6] md:w-[460px]"
          />
        </div>

        {/* Kullanici istegi (13 Eylul 2026): mahalle secici chip listesi -
            ön inceleme/tahkikat sayfalarindaki AYNI desen. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setSelectedNeighborhood('all')}
            className={`rounded-full border px-4 py-1.5 text-[16px] font-black transition ${selectedNeighborhood === 'all' ? 'border-[#0076b6] bg-[#0076b6] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            Tümü ({filteredRows.length})
          </button>
          {neighborhoodGroups.map((group) => (
            <button
              key={group.neighborhood}
              type="button"
              onClick={() => setSelectedNeighborhood(group.neighborhood)}
              className={`rounded-full border px-4 py-1.5 text-[16px] font-black transition ${selectedNeighborhood === group.neighborhood ? 'border-[#0076b6] bg-[#0076b6] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
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
              Güncelleme dosyaları yükleniyor...
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-8 text-center text-sm font-bold text-slate-500">
              {selectedNeighborhood === 'all' ? 'Güncelleme durumunda dosya bulunamadı.' : `${selectedNeighborhood} mahallesinde güncelleme durumunda dosya bulunamadı.`}
            </div>
          ) : selectedNeighborhood === 'all' ? (
            neighborhoodGroups.map((group) => (
              <div key={`grup-m-${group.neighborhood}`} className="space-y-2">
                <div className="rounded-md bg-emerald-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-900">
                  {group.neighborhood} — {group.files.length} dosya
                </div>
                {group.files.map((row) => (
                  <GuncellemeMobileCard key={row.fileId} row={row} onOpenFile={openFile} onOpenReport={openResultForm} lock={kilitler.get(row.fileId)} />
                ))}
              </div>
            ))
          ) : (
            displayedRows.map((row) => (
              <GuncellemeMobileCard key={row.fileId} row={row} onOpenFile={openFile} onOpenReport={openResultForm} lock={kilitler.get(row.fileId)} />
            ))
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="ns-tablo ns-tablo-sonuc w-full min-w-[1400px] border-collapse text-left text-[15px]">
            <thead className="bg-sky-50 text-[12px] font-black uppercase text-[#005f95]">
              <tr>
                <th className="border-b border-sky-100 px-4 py-3">Dosya No</th>
                <th className="border-b border-sky-100 px-4 py-3">Adı Soyadı</th>
                <th className="border-b border-sky-100 px-4 py-3">Mahalle</th>
                <th className="border-b border-sky-100 px-4 py-3">Adres</th>
                <th className="border-b border-sky-100 px-4 py-3">Son Ev Ziyareti Bilgisi</th>
                <th className="border-b border-sky-100 px-4 py-3 text-right">İnceleme Formları</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    Güncelleme dosyaları yükleniyor...
                  </td>
                </tr>
              ) : displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center text-sm font-bold text-slate-500">
                    {selectedNeighborhood === 'all' ? 'Güncelleme durumunda dosya bulunamadı.' : `${selectedNeighborhood} mahallesinde güncelleme durumunda dosya bulunamadı.`}
                  </td>
                </tr>
              ) : selectedNeighborhood === 'all' ? (
                neighborhoodGroups.map((group) => (
                  <Fragment key={`grup-${group.neighborhood}`}>
                    <tr className="bg-emerald-100">
                      <td colSpan={6} className="border-l-4 border-l-emerald-600 px-4 py-2.5 text-[18.5px] font-black uppercase tracking-wide text-emerald-900">
                        {group.neighborhood} <span className="ml-2 rounded-full bg-white px-2.5 py-0.5 text-[15px] text-emerald-800 ring-1 ring-emerald-300">{group.files.length} dosya</span>
                      </td>
                    </tr>
                    {group.files.map((row, index) => (
                      <GuncellemeTableRow key={row.fileId} row={row} index={index} onOpenFile={openFile} onOpenReport={openResultForm} lock={kilitler.get(row.fileId)} />
                    ))}
                  </Fragment>
                ))
              ) : (
                displayedRows.map((row, index) => (
                  <GuncellemeTableRow key={row.fileId} row={row} index={index} onOpenFile={openFile} onOpenReport={openResultForm} lock={kilitler.get(row.fileId)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {resultTarget && (
        <div ref={anaOverlayRef} className="fixed inset-0 z-[2200] bg-slate-950/75 backdrop-blur-sm">
          <div ref={anaPanelRef} style={anaPencere.panelStyle} className="flex flex-col overflow-hidden rounded-lg border border-sky-200 bg-white shadow-2xl">
            <div
              {...anaPencere.resizeHandleProps}
              className="absolute bottom-0 right-0 z-30 h-5 w-5"
              aria-hidden="true"
            >
              <svg className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 8 8 18M18 13l-5 5" /></svg>
            </div>
            <div {...anaPencere.dragHandleProps} title="Taşımak için sürükleyin, çift tıklayın: ekranı kapla / küçült" className="flex shrink-0 select-none items-start justify-between border-b-2 border-[#b8860b] bg-gradient-to-r from-[#0b1f3f] via-[#12305f] to-[#1a4580] px-3 py-2 text-white md:items-center md:px-5">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D4B26A]">İş Akışı · Sonuç Bekleyen</p>
                <h3 className="mt-0.5 text-base font-bold uppercase leading-tight tracking-wide text-white md:truncate md:text-[18px]">Komisyon Değerlendirmesi ve Yardım Kayıtları</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="rounded border border-white/30 bg-white/10 px-2.5 py-1 text-[12px] text-white">Dosya {resultTarget.fileNo}</span>
                  <span className="rounded border border-white/30 bg-white px-2.5 py-1 text-[12px] text-[#0b1f3f]">{resultTarget.applicantName}</span>
                </div>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={anaPencere.toggleMaximize}
                  title={anaPencere.isMaximized ? 'Küçült (önceki boyut)' : 'Ekranı kapla'}
                  aria-label={anaPencere.isMaximized ? 'Küçült' : 'Ekranı kapla'}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/40 bg-white/10 text-white hover:bg-white/20"
                >
                  {anaPencere.isMaximized ? (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="7" y="3" width="14" height="14" rx="1.5" /><path d="M3 7v12a2 2 0 0 0 2 2h12" /></svg>
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /></svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openFile(resultTarget)}
                  title="Dosyayı Dosya Yönetimi'nde aç"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[12px] font-bold text-[#0b1f3f] shadow-sm hover:bg-slate-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
                  Dosyayı Aç
                </button>
              <button
                type="button"
                onClick={closeResultForm}
                disabled={resultStatus !== 'idle'}
                title="Kapat"
                className="inline-flex h-8 w-9 shrink-0 items-center justify-center rounded-md border border-white/40 bg-white/10 text-lg font-black text-white hover:bg-rose-600 disabled:cursor-wait disabled:opacity-60"
              >
                x
              </button>
              </div>
            </div>

            <div style={anaPencere.contentZoom !== 1 ? { zoom: anaPencere.contentZoom } : undefined} className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto bg-slate-100 p-2 md:gap-3 md:p-3 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] xl:grid-rows-[auto_minmax(220px,1fr)] xl:content-normal">
              {resultError && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 xl:col-span-2">
                  {resultError}
                </div>
              )}

              {/* 2026-10-14 kullanici istegi: pencere kurumsal/profesyonel -
                  sol sutun daraltildi (Son Tahkikat Raporu + Komisyon Raporu),
                  sag sutun (Muracaat ve Yardim Kayitlari) genisletildi; eski
                  "Son Hane Ziyareti..." buyuk kutusu kaldirildi, gecmis
                  tahkikat / ev ziyareti / inceleme formlari "Gecmis Raporlar"
                  penceresinde. */}
              <div className="flex min-w-0 flex-col gap-3">
                <section className="overflow-hidden rounded-xl border border-[#0E7C86]/40 border-l-[5px] border-l-[#0E7C86] bg-[#f0fafa] shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#b8860b] bg-[#0E7C86] px-4 py-2 text-white">
                    <h4 className="text-[14px] font-bold uppercase tracking-[0.06em]">Dosya Sahibi</h4>
                    <span className="text-[11px] font-semibold text-slate-300">Kopyalamak için bilginin üzerine çift tıklayın</span>
                  </div>
                  {/* 2026-10-14: TC, isim, telefon, hane tek satirda; altinda adres */}
                  <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,0.75fr)]">
                    <KopyalanabilirBilgi etiket="T.C. Kimlik No" deger={resultTarget.tcKimlikNo || ''} />
                    <KopyalanabilirBilgi etiket="Adı Soyadı" deger={resultTarget.applicantName} />
                    <KopyalanabilirBilgi etiket="Doğum Tarihi" deger={resultTarget.birthDate || ''} />
                    <KopyalanabilirBilgi etiket="Telefon" deger={resultTarget.phone} />
                    <KopyalanabilirBilgi etiket="Hanedeki Kişi Sayısı" deger={resultTarget.householdCount === null || resultTarget.householdCount === undefined ? '' : String(resultTarget.householdCount)} />
                    <KopyalanabilirBilgi etiket="Adres" deger={resultTarget.address} genis />
                  </div>
                </section>

                <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[#1a4580]/35 border-l-[5px] border-l-[#1a4580] bg-[#f5f8fd] shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#b8860b] bg-gradient-to-r from-[#0b1f3f] via-[#12305f] to-[#1a4580] px-4 py-2 text-white">
                    <div className="min-w-0">
                      <h4 className="text-[14px] font-bold uppercase tracking-[0.06em]">Son Tahkikat Raporu</h4>
                      <p className="mt-0.5 text-[12px] font-medium text-slate-200">
                        {sonTahkikat
                          ? `${formatDate(sonTahkikat.tarih)} — ${sonTahkikat.personel || 'Personel belirtilmemiş'}`
                          : 'Komisyon kararına esas inceleme özeti'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {sonTahkikat && (
                        <a
                          href={`/api/documents/saha-inceleme/yazdir?id=${encodeURIComponent(sonTahkikat.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center rounded-md border border-white/40 bg-white/10 px-3 text-[12px] font-bold text-white hover:bg-white/20"
                        >
                          Formun Tamamı
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => { setGecmisSekme('tumu'); setGecmisAcik(true) }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[12px] font-bold text-[#0b1f3f] shadow-sm hover:bg-slate-100"
                      >
                        Geçmiş Raporlar
                        <span className="rounded-full bg-[#0b1f3f] px-2 py-0.5 text-[11px] font-black text-white">{gecmisToplam}</span>
                      </button>
                    </div>
                  </div>

                  {sonTahkikat && (sonTahkikat.ziyaretSonucu || sonTahkikat.aciliyet || sonTahkikat.oncelikliIhtiyac) && (
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-1.5">
                      {sonTahkikat.ziyaretSonucu && (
                        <span className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-[12px] font-bold text-sky-800">{sonTahkikat.ziyaretSonucu}</span>
                      )}
                      {sonTahkikat.aciliyet && (
                        <span className={`rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${aciliyetSinifi(sonTahkikat.aciliyet)}`}>Aciliyet: {sonTahkikat.aciliyet}</span>
                      )}
                      {sonTahkikat.oncelikliIhtiyac && (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[12px] font-semibold text-slate-700">Öncelikli ihtiyaç: {sonTahkikat.oncelikliIhtiyac}</span>
                      )}
                    </div>
                  )}

                  {tahkikatFormlariStatus === 'loading' && (
                    <div className="border-b border-slate-100 px-4 py-2 text-[12px] font-semibold text-slate-500">Tahkikat bilgileri yükleniyor...</div>
                  )}
                  {tahkikatFormlariError && (
                    <div className="m-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">{tahkikatFormlariError}</div>
                  )}

                  <div className="min-h-[180px] flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-2.5 text-[14px] font-medium leading-6 text-slate-900 xl:max-h-[620px]">
                    {resultTarget.lastVisitInfo || 'Bu dosya için kayıtlı tahkikat raporu bulunamadı.'}
                  </div>
                  <p className="border-t border-slate-100 bg-slate-50 px-4 py-1 text-[11.5px] font-medium text-slate-500">
                    Salt okunur — inceleme görevlisinin raporudur. Eski raporlar için “Geçmiş Raporlar”.
                  </p>
                </section>

              </div>

              {/* 2026-10-14: Komisyon Raporu ile Muracaat ve Yardim Kayitlari yer degistirdi */}
              <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#166534]/35 border-l-[5px] border-l-[#166534] bg-[#f3faf5] shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#b8860b] bg-[#166534] px-4 py-2 text-white">
                  <div>
                    <h4 className="text-[14px] font-bold uppercase tracking-[0.06em]">Komisyon Raporu</h4>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-300">Kararınızı yazın, ardından sağdaki yardımları düzenleyin.</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-200 ring-1 ring-white/20">
                    {resultForm.content.trim().length} karakter
                  </span>
                </div>

                <div className="grid flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-[180px_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">Tarih</span>
                    <input
                      type="date"
                      value={resultForm.date}
                      onChange={(event) => setResultForm((current) => ({ ...current, date: event.target.value }))}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-[14px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">Konu</span>
                    <select
                      value={resultForm.title}
                      onChange={(event) => setResultForm((current) => ({ ...current, title: event.target.value }))}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-[14px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">Seçiniz</option>
                      {resultForm.title && !investigationSubjectOptions.some((option) => option.name === resultForm.title) && (
                        <option value={resultForm.title}>{resultForm.title}</option>
                      )}
                      {investigationSubjectOptions.map((option) => (
                        <option key={option.id} value={option.name}>{option.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-h-0 flex-col gap-1.5 md:col-span-2">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">Rapor Metni</span>
                      <button
                        type="button"
                        onClick={() => void toggleCommissionDictation()}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[11.5px] font-bold shadow-sm transition ${commissionDictationActive ? 'border-red-700 bg-red-600 text-white hover:bg-red-700' : 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700'}`}
                        title={commissionDictationActive ? 'Mikrofonu kapat' : 'Mikrofonla yaz'}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                      rows={5}
                      className="min-h-[180px] w-full flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2.5 text-[14px] font-medium leading-7 text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                      placeholder="Komisyon kararınızı ve gerekçesini buraya yazın..."
                    />
                  </label>
                </div>
              </section>

              {/* 2026-10-14: Muracaat ve Yardim Kayitlari altta, pencerenin tum genisliginde */}
              <section className="flex min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden rounded-xl border border-[#9a3412]/35 border-l-[5px] border-l-[#9a3412] bg-[#fffaf5] shadow-sm xl:col-span-2">
                <div className="flex shrink-0 flex-col gap-3 border-b-2 border-[#b8860b] bg-[#9a3412] px-3 py-2 text-white md:px-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h4 className="text-[14px] font-bold uppercase tracking-[0.06em]">Müracaat ve Yardım Kayıtları</h4>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-300">Ekmek, Gıda, Destek Paketi ve Hazır Yemek — satırda değiştirip “Güncelle” ile kaydedin</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-center">
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-300">Müracaat</div>
                      <div className="text-[15px] font-black text-white">{applicationCount}</div>
                    </div>
                    <div className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-center">
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-300">Yardım</div>
                      <div className="text-[15px] font-black text-white">{assistanceCount}</div>
                    </div>
                    <div className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-center">
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-300">Tür</div>
                      <div className="text-[15px] font-black text-white">{visibleServiceTypeCount}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsQuickAddOpen((current) => !current)
                        setQuickAddError('')
                      }}
                      disabled={quickAddStatus === 'saving'}
                      className="h-8 rounded-md border border-[#6fb744] bg-[#6fb744] px-3.5 text-[12px] font-bold text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
                    >
                      + Yardım Ekle
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadAssistances(resultTarget.fileId)}
                      disabled={assistanceStatus === 'loading' || Boolean(savingAssistanceKey)}
                      className="h-8 rounded-md border border-white/40 bg-white/10 px-3.5 text-[12px] font-bold text-white shadow-sm hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
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
                      <label className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">
                        Yardım Türü
                        <select
                          value={quickAddForm.type}
                          onChange={(event) => setQuickAddForm((current) => ({
                            ...current,
                            type: event.target.value as QuickAssistanceType,
                            breakfastAmount: '',
                          }))}
                          className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                        >
                          {quickAssistanceTypes.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">
                        Periyot
                        <select
                          value={quickAddForm.period}
                          onChange={(event) => updateQuickAddPeriod(event.target.value)}
                          className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                        >
                          {periodOptions.map((period) => (
                            <option key={period} value={period}>{period}</option>
                          ))}
                          <option value="Sureli">Süreli (Tek Seferlik)</option>
                          <option value="Periyodik">Periyodik</option>
                          <option value={KIS_DONEMI_PERIOD_LABEL}>{KIS_DONEMI_PERIOD_LABEL}</option>
                        </select>
                      </label>
                      <label className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">
                        Miktar
                        <input
                          value={quickAddForm.amount}
                          onChange={(event) => setQuickAddForm((current) => ({ ...current, amount: event.target.value }))}
                          className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
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
                        className="h-8 rounded-md border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        Vazgec
                      </button>
                      <button
                        type="button"
                        onClick={() => void createQuickAssistance()}
                        disabled={quickAddStatus === 'saving'}
                        className="h-8 rounded-md border border-[#6fb744] bg-[#6fb744] px-4 text-xs font-black text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
                      >
                        {quickAddStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                      </button>
                    </div>
                  </div>
                )}

                {assistanceStatus === 'loading' ? (
                  <div className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    Kayıtlar yükleniyor...
                  </div>
                ) : assistanceRows.length === 0 ? (
                  <div className="min-h-0 overflow-auto px-5 py-5">
                    <div className="mx-auto max-w-4xl rounded-lg border border-dashed border-sky-200 bg-sky-50/50 p-5 text-left">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h5 className="text-[14px] font-bold uppercase text-[#1E2A38]">Kayıt bulunamadı</h5>
                          <p className="mt-1 text-[13px] font-medium text-slate-600">
                            Bu dosyada Ekmek, Gıda, Destek Paketi veya Hazır Yemek müracaatı/yardımı yok. Yeni yardım için “+ Yardım Ekle”.
                          </p>
                        </div>
                      </div>

                      {false && isQuickAddOpen && (
                        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_minmax(120px,0.6fr)]">
                            <label className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">
                              Yardım Türü
                              <select
                                value={quickAddForm.type}
                                onChange={(event) => setQuickAddForm((current) => ({
                                  ...current,
                                  type: event.target.value as QuickAssistanceType,
                                  breakfastAmount: event.target.value === 'Hazır Yemek' ? current.breakfastAmount : '',
                                }))}
                                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                              >
                                {quickAssistanceTypes.map((type) => (
                                  <option key={type} value={type}>{type}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">
                              Periyot
                              <select
                                value={quickAddForm.period}
                                onChange={(event) => updateQuickAddPeriod(event.target.value)}
                                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                              >
                                {periodOptions.map((period) => (
                                  <option key={period} value={period}>{period}</option>
                                ))}
                                <option value="Sureli">Süreli (Tek Seferlik)</option>
                                <option value="Periyodik">Periyodik</option>
                                <option value={KIS_DONEMI_PERIOD_LABEL}>{KIS_DONEMI_PERIOD_LABEL}</option>
                              </select>
                            </label>
                            <label className="text-[11.5px] font-bold uppercase tracking-wide text-slate-600">
                              Miktar
                              <input
                                value={quickAddForm.amount}
                                onChange={(event) => setQuickAddForm((current) => ({ ...current, amount: event.target.value }))}
                                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-950 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
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
                              className="h-8 rounded-md border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              Vazgec
                            </button>
                            <button
                              type="button"
                              onClick={() => void createQuickAssistance()}
                              disabled={quickAddStatus === 'saving'}
                              className="h-8 rounded-md border border-[#6fb744] bg-[#6fb744] px-4 text-xs font-black text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
                            >
                              {quickAddStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydet'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
                    {/* Kullanici istegi (14 Eylul 2026, 2. tur): "alanlar tek
                        satırda normal görünsün, sığmıyor ise kaydırma
                        çubuğu ile bu alanı yana kaydıralım" - bir onceki
                        turde eklenen mobil dikey kart gorunumu (kullanici
                        istemedi) KALDIRILDI, tek tabloya donuldu; disaridaki
                        "overflow-auto" sarmalayici zaten yatay kaydirmayi
                        sagliyor. */}
                    <table className="w-full min-w-max border-collapse text-left text-[14px]">
                      <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[12px] font-bold uppercase tracking-wide text-[#1E2A38] shadow-sm">
                        <tr>
                          <th style={{ width: serviceColumnWidths.process }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Süreç</th>
                          <th style={{ width: serviceColumnWidths.type }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Yardım</th>
                          <th style={{ width: serviceColumnWidths.period }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Periyot</th>
                          <th style={{ width: serviceColumnWidths.startDate }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Başlangıç</th>
                          <th style={{ width: serviceColumnWidths.endDate }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Bitiş</th>
                          <th style={{ width: serviceColumnWidths.amount }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Miktar</th>
                          <th style={{ width: serviceColumnWidths.status }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5">Durum</th>
                          <th style={{ width: serviceColumnWidths.action }} className="whitespace-nowrap border-b-2 border-slate-300 px-2.5 py-1.5 text-right">İşlem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assistanceRows.map((row, index) => {
                          const rowKey = `${row.kind}:${row.sourceTable}:${row.recordId}`
                          const isSavingRow = savingAssistanceKey === rowKey

                          return (
                            <tr key={rowKey} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} hover:bg-sky-50/70`}>
                              <td style={{ width: serviceColumnWidths.process }} className="whitespace-nowrap border-b border-slate-100 px-3 py-1 align-middle">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase ring-1 ${
                                  row.kind === 'application'
                                    ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                                }`}>
                                  {row.kind === 'application' ? 'Müracaat' : 'Yardım'}
                                </span>
                              </td>
                              <td style={{ width: serviceColumnWidths.type }} className="whitespace-nowrap border-b border-slate-100 px-3 py-1 align-middle">
                                <div className="text-[14.5px] font-black text-slate-900">{row.type}</div>
                              </td>
                              <td style={{ width: serviceColumnWidths.period }} className="border-b border-slate-100 px-3 py-1 align-middle">
                                <select
                                  value={row.periodInfo}
                                  onChange={(event) => updateAssistancePeriod(row, rowKey, event.target.value)}
                                  style={{ width: serviceColumnWidths.period }}
                                  className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                                >
                                  <option value="">Periyot seçiniz...</option>
                                  {row.periodInfo && !periodOptions.includes(row.periodInfo) && !['Sureli', 'Periyodik', KIS_DONEMI_PERIOD_LABEL].includes(row.periodInfo) && (
                                    <option value={row.periodInfo}>{row.periodInfo}</option>
                                  )}
                                  {periodOptions.map((period) => (
                                    <option key={period} value={period}>{period}</option>
                                  ))}
                                  <option value="Sureli">Süreli (Tek Seferlik)</option>
                                  <option value="Periyodik">Periyodik</option>
                                  <option value={KIS_DONEMI_PERIOD_LABEL}>{KIS_DONEMI_PERIOD_LABEL}</option>
                                </select>
                                {isKisDonemiBekleyen(row) && row.kind === 'application' && (
                                  <div className="mt-0.5 text-[10.5px] font-bold text-amber-700">01 Kasım’da otomatik açılır</div>
                                )}
                              </td>
                              <td style={{ width: serviceColumnWidths.startDate }} className="border-b border-slate-100 px-3 py-1 align-middle">
                                <input
                                  type="date"
                                  value={row.formStartDate}
                                  onChange={(event) => updateAssistanceStartDate(row, rowKey, event.target.value)}
                                  readOnly={row.periodInfo === KIS_DONEMI_PERIOD_LABEL}
                                  title={row.periodInfo === KIS_DONEMI_PERIOD_LABEL ? 'Kış Dönemi tarihleri sabittir' : undefined}
                                  style={{ width: serviceColumnWidths.startDate }}
                                  className="h-8 rounded-md border border-slate-300 bg-white read-only:bg-slate-100 px-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                                />
                              </td>
                              <td style={{ width: serviceColumnWidths.endDate }} className="border-b border-slate-100 px-3 py-1 align-middle">
                                <input
                                  type="date"
                                  value={row.formEndDate}
                                  onChange={(event) => updateAssistanceRow(rowKey, { formEndDate: event.target.value })}
                                  readOnly={row.periodInfo === KIS_DONEMI_PERIOD_LABEL}
                                  title={row.periodInfo === KIS_DONEMI_PERIOD_LABEL ? 'Kış Dönemi tarihleri sabittir' : undefined}
                                  style={{ width: serviceColumnWidths.endDate }}
                                  className="h-8 rounded-md border border-slate-300 bg-white read-only:bg-slate-100 px-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                                />
                              </td>
                              <td style={{ width: serviceColumnWidths.amount }} className="border-b border-slate-100 px-3 py-1 align-middle">
                                <input
                                  value={row.amount}
                                  onChange={(event) => updateAssistanceRow(rowKey, { amount: event.target.value })}
                                  style={{ width: serviceColumnWidths.amount }}
                                  className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
                                />
                              </td>
                              <td style={{ width: serviceColumnWidths.status }} className="border-b border-slate-100 px-3 py-1 align-middle">
                                <select
                                  value={row.status}
                                  onChange={(event) => updateAssistanceRow(rowKey, { status: event.target.value })}
                                  style={{ width: serviceColumnWidths.status }}
                                  className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-[14px] font-semibold text-slate-900 outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100"
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
                              <td style={{ width: serviceColumnWidths.action }} className="whitespace-nowrap border-b border-slate-100 px-3 py-1 text-right align-middle">
                                <button
                                  type="button"
                                  onClick={() => void saveAssistanceRow(row)}
                                  disabled={Boolean(savingAssistanceKey)}
                                  className="h-8 rounded-md border border-[#6fb744] bg-[#f1faed] px-3.5 text-[12.5px] font-bold uppercase text-[#3f7f28] hover:bg-[#e5f5dc] disabled:cursor-wait disabled:opacity-60"
                                >
                                  {isSavingRow ? 'Kaydediliyor...' : 'Güncelle'}
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

            {/* 2026-10-14: Gecmis Raporlar penceresi - eski tahkikat formlari,
                ev ziyareti raporlari ve (eski puanli) inceleme formlari. */}
            {gecmisAcik && (
              <div ref={gecmisOverlayRef} className="fixed inset-0 z-[2300] bg-slate-950/60" onClick={() => setGecmisAcik(false)}>
                <div ref={gecmisPanelRef} style={gecmisPencere.panelStyle} className="flex flex-col overflow-hidden rounded-xl border border-[#1E2A38]/30 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <div
              {...gecmisPencere.resizeHandleProps}
              className="absolute bottom-0 right-0 z-30 h-5 w-5"
              aria-hidden="true"
            >
              <svg className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 8 8 18M18 13l-5 5" /></svg>
            </div>
                  <div {...gecmisPencere.dragHandleProps} title="Taşımak için sürükleyin, çift tıklayın: ekranı kapla / küçült" className="flex shrink-0 select-none items-start justify-between gap-3 border-b-2 border-[#b8860b] bg-gradient-to-r from-[#0b1f3f] via-[#12305f] to-[#1a4580] px-5 py-2.5 text-white">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D4B26A]">Dosya {resultTarget.fileNo} · {resultTarget.applicantName}</p>
                      <h4 className="mt-0.5 text-[17px] font-bold uppercase tracking-wide">Geçmiş Raporlar</h4>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                  type="button"
                  onClick={gecmisPencere.toggleMaximize}
                  title={gecmisPencere.isMaximized ? 'Küçült (önceki boyut)' : 'Ekranı kapla'}
                  aria-label={gecmisPencere.isMaximized ? 'Küçült' : 'Ekranı kapla'}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/40 bg-white/10 text-white hover:bg-white/20"
                >
                  {gecmisPencere.isMaximized ? (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="7" y="3" width="14" height="14" rx="1.5" /><path d="M3 7v12a2 2 0 0 0 2 2h12" /></svg>
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /></svg>
                  )}
                </button>
                      <button
                  type="button"
                  onClick={() => openFile(resultTarget)}
                  title="Dosyayı Dosya Yönetimi'nde aç"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[12px] font-bold text-[#0b1f3f] shadow-sm hover:bg-slate-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
                  Dosyayı Aç
                </button>
                      <button
                        type="button"
                        onClick={() => setGecmisAcik(false)}
                        className="inline-flex h-8 shrink-0 items-center rounded-md border border-white/40 bg-white/10 px-3 text-[12px] font-bold text-white hover:bg-white/20"
                      >
                        Kapat
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 pt-2">
                    <div className="flex flex-wrap gap-1">
                      {([
                        ['tumu', 'Tüm Raporlar', gecmisKayitlari.length],
                        ['inceleme', 'İnceleme Formları', evaluationForms.length],
                      ] as const).map(([id, etiket, sayi]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setGecmisSekme(id)}
                          className={`-mb-px inline-flex items-center gap-2 rounded-t-lg border px-3.5 py-1.5 text-[12px] font-bold transition ${gecmisSekme === id ? 'border-slate-200 border-b-white bg-white text-[#0b1f3f] shadow-[inset_0_3px_0_#b8860b]' : 'border-transparent text-slate-600 hover:bg-white/70 hover:text-[#0b1f3f]'}`}
                        >
                          {etiket}
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${gecmisSekme === id ? 'bg-[#0b1f3f] text-white' : 'bg-slate-200 text-slate-700'}`}>{sayi}</span>
                        </button>
                      ))}
                    </div>
                    {gecmisSekme === 'tumu' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!resultTarget) return
                          void loadTahkikatFormlari(resultTarget.fileId)
                          void loadDosyaRaporlari(resultTarget.fileId)
                          if (canViewHomeVisits) void loadEvZiyaretleri(resultTarget.fileId)
                        }}
                        disabled={tahkikatFormlariStatus === 'loading' || evZiyaretleriStatus === 'loading' || dosyaRaporlariStatus === 'loading'}
                        className="mb-1.5 inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-[11.5px] font-bold text-[#0b1f3f] hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        {tahkikatFormlariStatus === 'loading' || evZiyaretleriStatus === 'loading' || dosyaRaporlariStatus === 'loading' ? 'Yükleniyor...' : 'Yenile'}
                      </button>
                    )}
                  </div>

                  <div style={gecmisPencere.contentZoom !== 1 ? { zoom: gecmisPencere.contentZoom } : undefined} className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-3.5">
                    {gecmisSekme === 'tumu' && (
                      <>
                        {(tahkikatFormlariError || evZiyaretleriError || dosyaRaporlariError) && (
                          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-bold text-rose-700">{tahkikatFormlariError || evZiyaretleriError || dosyaRaporlariError}</div>
                        )}
                        {gecmisKayitlari.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[12px] font-semibold text-slate-500">
                            {tahkikatFormlariStatus === 'loading' || evZiyaretleriStatus === 'loading' || dosyaRaporlariStatus === 'loading' ? 'Raporlar yükleniyor...' : 'Bu dosyada kayıtlı rapor bulunamadı.'}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {gecmisKayitlari.map((oge, sira) => (
                              <article key={oge.anahtar} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3.5 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[12px] font-black text-[#0b1f3f]">{formatDate(oge.tarih)}</span>
                                    <span className="text-[11.5px] font-semibold text-slate-600">
                                      — {oge.tur === 'tahkikat' ? (oge.form.personel || 'Personel belirtilmemiş') : oge.tur === 'ev' ? (oge.kayit.userName || 'Kullanıcı belirtilmemiş') : (oge.rapor.userName || 'Kullanıcı belirtilmemiş')}
                                    </span>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${oge.tur === 'tahkikat' ? 'bg-sky-50 text-sky-800 ring-sky-200' : oge.tur === 'ev' ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}>
                                      {oge.tur === 'tahkikat' ? 'Tahkikat Formu' : oge.tur === 'ev' ? 'Ev Ziyareti Raporu' : raporOnayMi(oge.rapor) ? 'Onay Raporu' : 'İnceleme Raporu'}
                                    </span>
                                    {sira === 0 && <span className="rounded-full bg-[#0b1f3f] px-2 py-0.5 text-[11px] font-bold text-white">En son</span>}
                                  </div>
                                  {oge.tur === 'tahkikat' && (
                                    <a
                                      href={`/api/documents/saha-inceleme/yazdir?id=${encodeURIComponent(oge.form.id)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-[11.5px] font-bold text-[#0b1f3f] hover:bg-slate-100"
                                    >
                                      Formun Tamamı
                                    </a>
                                  )}
                                </div>
                                {oge.tur === 'tahkikat' ? (
                                  <div className="space-y-2 px-3.5 py-2.5">
                                    {(oge.form.ziyaretSonucu || oge.form.aciliyet || oge.form.oncelikliIhtiyac) && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {oge.form.ziyaretSonucu && <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-800">{oge.form.ziyaretSonucu}</span>}
                                        {oge.form.aciliyet && <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${aciliyetSinifi(oge.form.aciliyet)}`}>Aciliyet: {oge.form.aciliyet}</span>}
                                        {oge.form.oncelikliIhtiyac && <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">Öncelikli ihtiyaç: {oge.form.oncelikliIhtiyac}</span>}
                                      </div>
                                    )}
                                    {oge.form.ozet && <p className="text-[12px] font-medium leading-6 text-slate-800">{oge.form.ozet}</p>}
                                    {oge.form.personelRaporu && (
                                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">
                                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">Personel</p>
                                        <p className="mt-0.5 whitespace-pre-wrap text-[12px] font-medium leading-6 text-slate-800">{oge.form.personelRaporu}</p>
                                      </div>
                                    )}
                                  </div>
                                ) : oge.tur === 'ev' ? (
                                  <div className="px-3.5 py-2.5">
                                    {oge.kayit.title && <p className="text-[11.5px] font-black text-slate-800">{oge.kayit.title}</p>}
                                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] font-medium leading-6 text-slate-800">{oge.kayit.content || '-'}</p>
                                  </div>
                                ) : (
                                  // Dosya Yönetimi "Raporlar ve Tahkikatlar" ile ayni: KONU + rapor metni
                                  <div className="px-3.5 py-2.5">
                                    {oge.rapor.title && <p className="text-[12px] font-black uppercase tracking-wide text-[#8a4b08]">{oge.rapor.title}</p>}
                                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] font-semibold leading-6 text-slate-900">{oge.rapor.content || '-'}</p>
                                    {oge.rapor.approverName && oge.rapor.approverName !== '-' && (
                                      <p className="mt-1 text-[11px] font-semibold text-slate-500">Onaylayan: {oge.rapor.approverName}</p>
                                    )}
                                  </div>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {gecmisSekme === 'inceleme' && (
                <div className="overflow-hidden rounded-xl border border-teal-200 bg-teal-50/70 shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-teal-100 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h5 className="text-[13.5px] font-black uppercase text-teal-900">Kayıtlı İnceleme Formları</h5>
                      <p className="mt-0.5 text-[12px] font-bold text-slate-500">İnceleme formu tablosundaki kayıtlar ve çıktı işlemleri</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => resultTarget && void loadEvaluationForms(resultTarget.fileId)}
                      disabled={evaluationFormsStatus === 'loading'}
                      className="h-8 rounded-md border border-teal-200 bg-teal-600 px-3 text-[11.5px] font-black uppercase text-white shadow-sm hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      {evaluationFormsStatus === 'loading' ? 'Yükleniyor...' : 'Yenile'}
                    </button>
                  </div>

                  {evaluationFormsError && (
                    <div className="m-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-bold text-rose-700">
                      {evaluationFormsError}
                    </div>
                  )}

                  {evaluationFormsStatus === 'loading' ? (
                    <div className="px-4 py-6 text-center text-[13.5px] font-bold text-slate-500">İnceleme formları yükleniyor...</div>
                  ) : evaluationForms.length === 0 ? (
                    <div className="px-4 py-6 text-center text-[13.5px] font-bold text-slate-500">Bu dosyada kayıtlı inceleme formu bulunamadı.</div>
                  ) : (
                    <div className="overflow-y-auto p-3">
                      <div className="grid gap-2">
                        {evaluationForms.map((record) => (
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
                                  <span className="rounded bg-teal-50 px-2 py-1 text-[11.5px] font-black uppercase text-teal-800 ring-1 ring-teal-100">
                                    {formatDate(cleanText(record.formTarihi))}
                                  </span>
                                  <span className="rounded bg-slate-50 px-2 py-1 text-[11.5px] font-black uppercase text-slate-700 ring-1 ring-slate-100">
                                    Puan {record.toplamPuan ?? 0} / 100
                                  </span>
                                </div>
                                <div className="mt-2 truncate text-[13.5px] font-black uppercase text-slate-950">
                                  {record.adSoyad || resultTarget.applicantName}
                                </div>
                                <p className="mt-1 line-clamp-2 text-[12.5px] font-bold leading-5 text-slate-600">
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
                                  className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[11.5px] font-black uppercase text-teal-800 shadow-sm hover:bg-teal-100"
                                >
                                  Görüntüle
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    printEvaluationForm(record)
                                  }}
                                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11.5px] font-black uppercase text-slate-700 shadow-sm hover:bg-slate-50"
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
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2 md:px-5">
              <button
                type="button"
                onClick={closeResultForm}
                disabled={resultStatus !== 'idle'}
                className="h-9 rounded-md border border-slate-300 bg-white px-5 text-[13px] font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void openAssistancesWithReport()}
                disabled={resultStatus !== 'idle' || quickAddStatus === 'saving'}
                className="h-9 rounded-md border border-[#6fb744] bg-[#6fb744] px-5 text-[13px] font-bold text-white shadow-sm hover:bg-[#5b9f35] disabled:cursor-wait disabled:opacity-60"
              >
                {resultStatus === 'opening' ? 'Yardımlar Açılıyor...' : 'Yardımları Aç'}
              </button>
              <button
                type="button"
                onClick={() => void saveResultReport()}
                disabled={resultStatus !== 'idle'}
                className="h-9 rounded-md border border-[#1E2A38] bg-[#1E2A38] px-6 text-[13px] font-bold text-white shadow-sm hover:bg-[#2A3B4D] disabled:cursor-wait disabled:opacity-60"
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
