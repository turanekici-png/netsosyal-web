'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTabs } from '@/lib/context/TabContext'
import { DashboardGrid, type DashboardWidget } from '@/components/shared/DashboardGrid'
import { AssistanceDistributionMap } from '@/components/shared/AssistanceDistributionMap'
import { useCanUseAction } from '@/lib/hooks/useCanUseAction'
import type { Layout } from 'react-grid-layout'

export const dynamic = 'force-dynamic'

interface ChartDatum {
  label: string
  value: number
  amount?: number
  stages?: Array<{ label: string; value: number }>
  // "Dosya Durum Bilgisi" gibi listelerde, bu satirin filtre linki kurmak
  // icin gereken HAM (Turkce etiket DEGIL) durum kodu - bkz. app/api/dashboard/route.ts.
  code?: number | string
}

interface CashPeriodAidDatum {
  year: string
  period: string
  type: string
  people: number
  amount: number
}

interface AidPaymentPeriodDatum {
  year: string
  period: string
  type: string
  count: number
  amount: number
  // Kullanici istegi: "Yardım Türü Ödeme Raporu"nda kartan odenen tutarin
  // yaninda GERCEKTEN fatura kesilen (alisveris) tutar da gorunsun - boylece
  // yil icinde bir yardim turu icin karttan ne kadar odendigi ile fiilen
  // ne kadarlik fatura kesildigi karsilastirilabilsin.
  shoppingAmount: number
}

interface AidCountPeriodDatum {
  year: string
  period: string
  type: string
  count: number
}

interface DailyAssistanceMovementDatum {
  date: string | null
  label: string
  group: string
  amount: number
}

interface ActiveTenderSummaryDatum {
  year: number
  type: string
  tenderAmount: number
  deliveredAmount: number
  remainingAmount: number
  progress: number
  startDate: string | null
  endDate: string | null
}

interface AssistanceAlert {
  id: string
  type: string
  fileNo: string
  applicant: string
  identityNumber: string
  startDate: string | null
  endDate: string | null
  amount: string
  statusCode: string
  statusVariant?: 'default' | 'dgn'
  status: string
}

interface RequestedDocument {
  id: string
  fileId: string | null
  requestedDate: string | null
  fileNo: string
  name: string
  documentTitle: string
  requestedBy: string
}

interface UserPerformanceDatum {
  userName: string
  daily: number
  weekly: number
  monthly: number
  lastActivity: string | null
}

interface DashboardData {
  totals: {
    files: number
    activeFiles: number
    statusTwoFiles: number
    beneficiaries: number
    assistedBeneficiaries: number
    assistances: number
    documents: number
    assistanceAmount: number
  }
  fileStatuses: ChartDatum[]
  fileStatusSummary: ChartDatum[]
  assistanceStatuses: ChartDatum[]
  assistanceTypes: ChartDatum[]
  assistanceFileReports: ChartDatum[]
  investigationStaffReports: ChartDatum[]
  cashPeriodMonthlyReports: ChartDatum[]
  cashPeriodYearlyReports: ChartDatum[]
  cashPeriodAidReports: CashPeriodAidDatum[]
  aidPaymentPeriodReports: AidPaymentPeriodDatum[]
  aidCountPeriodReports: AidCountPeriodDatum[]
  activeTenderSummary: ActiveTenderSummaryDatum[]
  userDailyPerformance: UserPerformanceDatum[]
  dailyAssistanceMovements: DailyAssistanceMovementDatum[]
  requestedDocuments: RequestedDocument[]
  assistanceAlerts: {
    recentStarts: AssistanceAlert[]
    endingSoon: AssistanceAlert[]
  }
}

const emptyDashboard: DashboardData = {
  totals: {
    files: 0,
    activeFiles: 0,
    statusTwoFiles: 0,
    beneficiaries: 0,
    assistedBeneficiaries: 0,
    assistances: 0,
    documents: 0,
    assistanceAmount: 0,
  },
  fileStatuses: [],
  fileStatusSummary: [],
  assistanceStatuses: [],
  assistanceTypes: [],
  assistanceFileReports: [],
  investigationStaffReports: [],
  cashPeriodMonthlyReports: [],
  cashPeriodYearlyReports: [],
  cashPeriodAidReports: [],
  aidPaymentPeriodReports: [],
  aidCountPeriodReports: [],
  activeTenderSummary: [],
  userDailyPerformance: [],
  dailyAssistanceMovements: [],
  requestedDocuments: [],
  assistanceAlerts: {
    recentStarts: [],
    endingSoon: [],
  },
}

function formatNumber(value: number | null | undefined) {
  const safeValue = Number(value ?? 0)
  return new Intl.NumberFormat('tr-TR').format(Number.isFinite(safeValue) ? safeValue : 0)
}

// Kullanici istegi: grafikler kendi alanini TAM doldursun, kenarlarda bosluk
// kalmasin. Ana Sayfa kutulari artik serbestce yeniden boyutlandirilabildigi
// icin (bkz. DashboardGrid) SVG grafiklerin sabit piksel genisligi (ör.
// 760px) konteynerden DAR/GENIS kaldiginda kenarlarda bosluk birakiyordu.
// "viewBox"i konteynerin GERCEK olculen genisligiyle esitleyerek (1:1 piksel
// eslesmesi) bu cozulur - preserveAspectRatio="none" ile ITMEK yerine, ki o
// yaklasim metin/etiketleri orantisiz sekilde gerip bozardi.
function useMeasuredSize(fallbackWidth: number, fallbackHeight: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: fallbackWidth, height: fallbackHeight })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(value)
}

function calculatePercent(part: number, total: number) {
  if (!total) return 0
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)))
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('tr-TR')
}

function formatInputDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDefaultMovementDateRange() {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - 29)

  return {
    startDate: formatInputDate(startDate),
    endDate: formatInputDate(endDate),
  }
}

function getAssistanceStatusBadgeClass(statusCode: string, variant: 'default' | 'dgn' = 'default') {
  const defaultClasses: Record<string, string> = {
    '0': 'border-amber-600 bg-gradient-to-r from-amber-500 to-orange-600 text-white ring-2 ring-amber-200 shadow-md shadow-amber-200/70',
    '2': 'border-emerald-600 bg-gradient-to-r from-emerald-500 to-green-600 text-white ring-2 ring-emerald-200 shadow-md shadow-emerald-200/70',
    '3': 'border-rose-600 bg-gradient-to-r from-rose-500 to-red-600 text-white ring-2 ring-rose-200 shadow-md shadow-rose-200/70',
    '4': 'border-sky-600 bg-gradient-to-r from-sky-500 to-blue-600 text-white ring-2 ring-sky-200 shadow-md shadow-sky-200/70',
  }
  const dgnClasses: Record<string, string> = {
    '0': 'border-amber-600 bg-gradient-to-r from-amber-500 to-orange-600 text-white ring-2 ring-amber-200 shadow-md shadow-amber-200/70',
    '1': 'border-rose-600 bg-gradient-to-r from-rose-500 to-red-600 text-white ring-2 ring-rose-200 shadow-md shadow-rose-200/70',
    '6': 'border-emerald-600 bg-gradient-to-r from-emerald-500 to-green-600 text-white ring-2 ring-emerald-200 shadow-md shadow-emerald-200/70',
  }
  const classes = variant === 'dgn' ? dgnClasses : defaultClasses

  return classes[statusCode] || defaultClasses['0']
}

function groupAlertsByType(data: AssistanceAlert[]) {
  return data.reduce<Array<{ type: string; items: AssistanceAlert[] }>>((groups, item) => {
    const existingGroup = groups.find((group) => group.type === item.type)
    if (existingGroup) {
      existingGroup.items.push(item)
      return groups
    }

    return [...groups, { type: item.type, items: [item] }]
  }, [])
}

function normalizeDashboardData(data: DashboardData): DashboardData {
  return {
    ...emptyDashboard,
    ...data,
    totals: {
      ...emptyDashboard.totals,
      ...data.totals,
    },
    fileStatusSummary: data.fileStatusSummary ?? emptyDashboard.fileStatusSummary,
    assistanceFileReports: data.assistanceFileReports ?? emptyDashboard.assistanceFileReports,
    cashPeriodMonthlyReports: data.cashPeriodMonthlyReports ?? emptyDashboard.cashPeriodMonthlyReports,
    cashPeriodYearlyReports: data.cashPeriodYearlyReports ?? emptyDashboard.cashPeriodYearlyReports,
    cashPeriodAidReports: data.cashPeriodAidReports ?? emptyDashboard.cashPeriodAidReports,
    aidPaymentPeriodReports: data.aidPaymentPeriodReports ?? emptyDashboard.aidPaymentPeriodReports,
    aidCountPeriodReports: data.aidCountPeriodReports ?? emptyDashboard.aidCountPeriodReports,
    activeTenderSummary: data.activeTenderSummary ?? emptyDashboard.activeTenderSummary,
    userDailyPerformance: data.userDailyPerformance ?? emptyDashboard.userDailyPerformance,
    requestedDocuments: data.requestedDocuments ?? emptyDashboard.requestedDocuments,
    assistanceAlerts: {
      ...emptyDashboard.assistanceAlerts,
      ...data.assistanceAlerts,
    },
  }
}

function StatCard({
  title,
  value,
  detail,
  tone,
  compact = false,
  onClick,
}: {
  title: string
  value: string
  detail: string
  tone: 'blue' | 'green' | 'amber' | 'rose'
  compact?: boolean
  onClick?: () => void
}) {
  const toneClass = {
    blue: 'border-sky-200 bg-sky-50 text-[#005f95]',
    green: 'border-[#bfe5ad] bg-[#f1faed] text-[#3f7f28]',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  }[tone]

  const className = `rounded-md border text-left shadow-sm ${compact ? 'p-3' : 'p-4'} ${toneClass} ${
    onClick ? 'transition hover:-translate-y-0.5 hover:shadow-md cursor-pointer' : ''
  }`
  const content = (
    <>
      <p className="text-[13px] font-extrabold uppercase tracking-wide opacity-80">{title}</p>
      <div className={`mt-1 font-black text-slate-950 ${compact ? 'text-2xl' : 'text-3xl'}`}>{value}</div>
      <p className={`${compact ? 'mt-0.5 text-xs' : 'mt-1 text-sm'} font-bold opacity-80`}>{detail}</p>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    )
  }

  return (
    <div className={className}>
      {content}
    </div>
  )
}

function SummaryPairCard({
  title,
  primaryLabel,
  primaryValue,
  primaryRawValue,
  secondaryLabel,
  secondaryValue,
  secondaryRawValue,
  tone,
  ratioLabel,
  onPrimaryClick,
  onSecondaryClick,
}: {
  title: string
  primaryLabel: string
  primaryValue: string
  primaryRawValue: number
  secondaryLabel: string
  secondaryValue: string
  secondaryRawValue: number
  tone: 'blue' | 'green'
  ratioLabel: string
  onPrimaryClick?: () => void
  onSecondaryClick?: () => void
}) {
  // Kullanici istegi: bu kart eskiden duz beyaz/gri basliga sahipti,
  // panodaki DIGER TUM kutular (Dosya Durum Bilgisi, Yardim Alan Dosya
  // Raporlari vb.) gibi RENKLI/degradeli baslik ile "profesyonel" bir
  // gorunume kavusturuldu - tone'a gore mavi/yesil degrade baslik + degerlerin
  // kendi kutularina hafif renk tonu/cerceve eklendi.
  const palette = {
    blue: {
      header: 'from-[#0076b6] via-[#0c6f9e] to-cyan-600',
      chip: 'bg-white/15 text-white ring-1 ring-white/30',
      value: 'text-[#0076b6]',
      bar: 'bg-gradient-to-r from-[#0076b6] to-cyan-500',
      box: 'border-sky-100 bg-sky-50/70 hover:border-sky-300 hover:bg-sky-50',
      boxLabel: 'text-sky-700',
    },
    green: {
      header: 'from-emerald-700 via-emerald-600 to-teal-600',
      chip: 'bg-white/15 text-white ring-1 ring-white/30',
      value: 'text-emerald-700',
      bar: 'bg-gradient-to-r from-emerald-600 to-teal-500',
      box: 'border-emerald-100 bg-emerald-50/70 hover:border-emerald-300 hover:bg-emerald-50',
      boxLabel: 'text-emerald-700',
    },
  }[tone]
  const percent = calculatePercent(secondaryRawValue, primaryRawValue)

  return (
    <div className="flex h-full min-h-[250px] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`dashboard-drag-handle flex items-center justify-between gap-1.5 bg-gradient-to-r px-3 py-3 text-white ${palette.header}`}>
        <p className="min-w-0 truncate text-[13.5px] font-black uppercase tracking-wide">{title}</p>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${palette.chip}`}>%{percent}</span>
      </div>
      <div className="flex flex-1 flex-col p-2.5">
        <div className="grid flex-1 grid-cols-1 grid-rows-2 gap-2">
          <button
            type="button"
            onClick={onPrimaryClick}
            className={`flex min-h-[64px] flex-col justify-center rounded-lg border px-2 py-2 text-center transition hover:shadow-sm ${palette.box}`}
          >
            <p className={`truncate text-[10px] font-black uppercase leading-tight tracking-wide ${palette.boxLabel}`}>{primaryLabel}</p>
            <div className={`mt-1 truncate text-[19px] font-black leading-none ${palette.value}`}>{primaryValue}</div>
          </button>
          <button
            type="button"
            onClick={onSecondaryClick}
            className={`flex min-h-[64px] flex-col justify-center rounded-lg border px-2 py-2 text-center transition hover:shadow-sm ${palette.box}`}
          >
            <p className={`truncate text-[10px] font-black uppercase leading-tight tracking-wide ${palette.boxLabel}`}>{secondaryLabel}</p>
            <div className={`mt-1 truncate text-[19px] font-black leading-none ${palette.value}`}>{secondaryValue}</div>
          </button>
        </div>
        <div className="mt-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-bold text-slate-600">
            <span className="truncate">{ratioLabel}</span>
            <span className="shrink-0 text-slate-900">%{percent}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full rounded-full ${palette.bar}`} style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// "asama" (dosyanin tahkikat asamasi) serbest metin oldugu icin (bkz.
// app/api/dashboard/route.ts) tam esitlik yerine bulanik (icerir)
// karsilastirma kullanilir - "Uygundur"/"Uygun degildir" gibi kucuk yazim
// farkliliklarini da yakalar. Stages dizisi SQL'de "count DESC" siralandigi
// icin ilk eleman (stages[0]) o personelin ATANAN dosyalarindaki EN BASKIN
// (en cok tekrar eden) asamadir - kullanicinin "en basinda olan durum"
// diye tarif ettigi budur.
function getDominantInvestigationTone(stages?: Array<{ label: string; value: number }>): 'suitable' | 'unsuitable' | 'rejected' | 'neutral' {
  const topLabel = stages?.[0]?.label?.trim().toLocaleLowerCase('tr-TR') ?? ''
  // Kullanici istegi: "Otomatik Red" da kendi rengiyle ayirt edilsin - diger
  // "uygun" iceren asamalardan ONCE kontrol edilir (otomatik red metninde
  // "uygun" gecmese de netlik icin ayri tutulur).
  if (topLabel.includes('otomatik red')) return 'rejected'
  if (!topLabel.includes('uygun')) return 'neutral'
  return topLabel.includes('değil') || topLabel.includes('degil') ? 'unsuitable' : 'suitable'
}

// Kullanici istegi: "incelenecek/uygun degil/uygundur" sutunlari HER
// PERSONELDE AYNI SIRADA (hizali) durmali - eskiden stages[0..2] o
// personelin KENDI en cok tekrar eden 3 asamasiydi, bu da personelden
// personele FARKLI sirada gorunmelerine (hizasiz durmasina) yol aciyordu.
// Bu fonksiyon, hangi sirada geldigine bakmaksizin ADINA gore ilgili
// asamayi bulur - bulunamazsa (o personelde o kategoriden hic kayit yoksa)
// null doner.
function findInvestigationStageValue(
  stages: Array<{ label: string; value: number }> | undefined,
  category: 'incelenecek' | 'uygunDegil' | 'uygundur' | 'otomatikRed',
): number | null {
  const match = (stages || []).find((stage) => {
    const label = stage.label.trim().toLocaleLowerCase('tr-TR')
    if (category === 'incelenecek') return label.includes('incelenecek') || label.includes('inceleme')
    if (category === 'uygunDegil') return label.includes('uygun değil') || label.includes('uygun degil')
    if (category === 'otomatikRed') return label.includes('otomatik red')
    return label.includes('uygun') && !label.includes('değil') && !label.includes('degil')
  })
  return match ? match.value : null
}

// Bazi kayitlarda "tahkikatpers" (atanan personel) alaninin kendisi
// yanlislikla "Uygun Degil"/"Uygundur" gibi bir DURUM metni olarak
// girilmis (gercek bir personel adi degil - bkz. app/api/dashboard/route.ts
// tahkikatpers gruplamasi). Bu satirlar GERCEK personel olmadigi icin
// kullanici istegi uzerine siralama rozetinde (1., 2. ...) numara ALMAZLAR -
// gercek personelin numaralandirmasi bu satirlardan etkilenmeden 1'den
// baslar.
function isInvestigationStatusLikeLabel(label: string): boolean {
  const normalized = label.trim().toLocaleLowerCase('tr-TR')
  return normalized === 'uygun değil' || normalized === 'uygun degil' || normalized === 'uygundur' || normalized === 'uygun' || normalized === 'otomatik red'
}

function Section({ title, children, fitWidth = false }: { title: string; children: React.ReactNode; fitWidth?: boolean }) {
  const tone = title.includes('Tahkikat')
    ? {
        shell: 'ring-violet-200 shadow-violet-950/10',
        header: 'border-violet-700 from-violet-800 via-fuchsia-700 to-pink-600',
        stripe: 'from-violet-700 via-fuchsia-500 to-pink-400',
        title: 'text-white',
        body: 'from-violet-50/70 via-white to-fuchsia-50/40',
      }
    : title.includes('Belge')
      ? {
          shell: 'ring-cyan-200 shadow-cyan-950/10',
          header: 'border-cyan-700 from-cyan-800 via-sky-700 to-blue-600',
          stripe: 'from-cyan-700 via-sky-500 to-blue-400',
          title: 'text-white',
          body: 'from-cyan-50/70 via-white to-sky-50/40',
        }
      : title.includes('Donem')
        ? {
            shell: 'ring-orange-200 shadow-orange-950/10',
            header: 'border-orange-700 from-orange-800 via-amber-700 to-yellow-600',
            stripe: 'from-orange-700 via-amber-500 to-yellow-400',
            title: 'text-white',
            body: 'from-orange-50/70 via-white to-amber-50/40',
          }
        : {
            shell: 'ring-emerald-200 shadow-emerald-950/10',
            header: 'border-emerald-700 from-emerald-800 via-teal-700 to-cyan-600',
            stripe: 'from-emerald-700 via-teal-500 to-cyan-400',
            title: 'text-white',
            body: 'from-emerald-50/70 via-white to-teal-50/40',
          }

  return (
    <section className={`flex h-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-white bg-white shadow-[0_18px_42px_rgba(15,23,42,0.09)] ring-1 ${fitWidth ? 'inline-flex w-fit' : 'w-full'} ${tone.shell}`}>
      <div className={`dashboard-drag-handle shrink-0 border-b bg-gradient-to-r px-4 py-3 ${tone.header}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-8 w-2 rounded-full bg-gradient-to-b shadow-sm ${tone.stripe}`} />
            <h2 className={`truncate text-[16px] font-black uppercase tracking-wide drop-shadow-sm ${tone.title}`}>
              {title}
            </h2>
          </div>
        </div>
      </div>
      <div className={`min-h-0 min-w-0 max-w-full flex-1 bg-gradient-to-br p-2.5 sm:p-4 ${tone.body}`}>{children}</div>
    </section>
  )
}

function SummaryListPanel({
  title,
  detail,
  data,
  tone = 'blue',
  isLoading = false,
  onItemClick,
  fill = false,
}: {
  title: string
  detail: string
  data: ChartDatum[]
  tone?: 'blue' | 'green'
  isLoading?: boolean
  onItemClick?: (item: ChartDatum) => void
  // Kullanici istegi (Agustos 2026): Ana Sayfa ust siradaki 6 ozet kutusu
  // "HEPSI ESIT BOYDA" gorunmeli - bu panel varsayilan olarak "h-auto"
  // (icerik kadar) durur, ama fill=true verildiginde SummaryPairCard gibi
  // kendisine ayrilan grid hucresinin TAMAMINI doldurur (altta bosluk kalmaz).
  fill?: boolean
}) {
  // NOT: Bu rozetler (etiket/deger) genel koyu-mod renk zincirine (globals.css)
  // birakildiginda "sky-50 bg + koyu lacivert metin" ikilisi, sayfanin genel
  // koyu lacivert zeminiyle yeterince ayrisamiyor ve "soluk/okunmuyor" gibi
  // goruluyordu - bu yuzden BURADA, dogrudan bilesen duzeyinde, arka planla
  // güçlü kontrast kuran ozel "dark:" renkleri tanimlandi. globals.css'teki
  // genel-gecer (katmansiz/unlayered) kurallar normalde HER Tailwind
  // utility'sinin (katmanli oldugu icin) ONUNE gecer - bu yuzden burada "!"
  // (important) on-eki KULLANILMASI ZORUNLU, aksi halde bu ozel renkler
  // sessizce yok sayilir ve genel gri-lacivert varsayilana geri doner.
  const toneClass = {
    blue: {
      header: 'bg-[#0076b6]',
      badge: 'bg-white/15 text-white ring-1 ring-white/30',
      row: 'border-slate-200 hover:border-[#0076b6] dark:!border-slate-700 dark:hover:!border-sky-500',
      label: 'bg-sky-50 text-[#005f95] ring-1 ring-sky-200 dark:!bg-sky-900 dark:!text-sky-100 dark:!ring-sky-700',
      value: 'bg-sky-50 text-[#005f95] dark:!bg-sky-800 dark:!text-white',
    },
    green: {
      header: 'bg-emerald-700',
      badge: 'bg-white/15 text-white ring-1 ring-white/30',
      row: 'border-slate-200 hover:border-emerald-600 dark:!border-slate-700 dark:hover:!border-emerald-500',
      label: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:!bg-emerald-900 dark:!text-emerald-100 dark:!ring-emerald-700',
      value: 'bg-emerald-50 text-emerald-800 dark:!bg-emerald-800 dark:!text-white',
    },
  }[tone]
  const total = data.reduce((sum, item) => sum + item.value, 0)

  // Kullanici istegi: kutu (widget) koseden BUYUK bir alana yerlestirilse
  // BILE, kartin GORUNEN sinirlari (beyaz kutu/kenarlik/golge) listenin
  // BITTIGI yerde bitsin - eskiden "h-full" ile kart HER ZAMAN kendisine
  // ayrilan (surukle-birak izgarasindaki) TUM yuksekligi dolduruyordu, bu da
  // az sayida satir oldugunda kartin ALTINDA buyuk, bos BEYAZ alan
  // birakiyordu. Artik kart "h-auto" ile SADECE icerigi kadar yer kaplar -
  // kalan fazla alan (varsa) kartin DISINDA, sayfa zemininin gorunecegi
  // SEFFAF bosluk olarak kalir (artik beyaz kart alani DEGIL). "max-h-full"
  // sinirlaniyor ki icerik CIDDI derecede coksa (kutu kucuk yapilmissa)
  // kart, kendisine ayrilan alanin DISINA TASMASIN - o durumda liste
  // (overflow-y-auto sayesinde) kendi icinde kaydirilir.
  return (
    <section className={`flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${fill ? 'h-full min-h-[250px]' : 'h-auto max-h-full min-h-[200px]'}`}>
      <div className={`dashboard-drag-handle px-4 py-2.5 text-white ${toneClass.header}`}>
        <div className="flex items-center justify-between gap-3">
          {/* Kullanici istegi (Eylul 2026): baslik altindaki aciklama satiri
              (detail) kaldirildi - basliklar daralsin diye. Prop hala
              cagirandan geliyor (baska yerde kullanilabilir), sadece burada
              gosterilmiyor. */}
          <div className="min-w-0">
            <h2 className="line-clamp-2 text-[16px] font-black uppercase leading-4 tracking-wide" title={detail}>{title}</h2>
          </div>
          <span className={`shrink-0 rounded-full px-3.5 py-2 text-base font-black leading-none ${toneClass.badge}`}>
            {formatNumber(total)}
          </span>
        </div>
      </div>
      {/* Kullanici istegi: satirlar birbirine YAKIN dursun - "justify-center"
          denemesi kaldirildi (bkz. gecmis not), USTUNE satirlarin KENDI
          boyutu da (min-h-[56px]->38px, dolgu/deger rozeti kucultuldu) ve
          aralarindaki bosluk (gap-1->0.5, p-3->2) daha da SIKILASTIRILDI -
          simdi satirlar YUKARIDAN baslar, aralarinda MINIMAL sabit bosluk
          olur; fazladan alan (varsa) sadece EN ALTTA kalir. Satir sayisi
          coksa (kutu kucultulunce) tasan kisim KIRPILMAK yerine
          kaydirilabiliyor (overflow-y-auto). */}
      <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-0.5 overflow-y-auto p-2">
        {isLoading ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
            Yukleniyor...
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
            Kayit bulunamadi.
          </div>
        ) : (
          data.map((item) => {
            const content = (
              <>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <div className={`inline-flex max-w-full shrink-0 rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wide ${toneClass.label}`}>
                    <span className="truncate">{item.label}</span>
                  </div>
                </div>
                <div className={`flex h-7 min-w-[60px] shrink-0 items-center justify-center rounded-md px-2 text-sm font-black leading-none ${toneClass.value}`}>
                  {formatNumber(item.value)}
                </div>
              </>
            )

            return onItemClick ? (
              <button
                key={item.label}
                type="button"
                onClick={() => onItemClick(item)}
                className={`flex min-h-[38px] w-full flex-1 items-center justify-between gap-3 rounded-lg border bg-white px-2.5 py-1 text-left transition hover:shadow-sm ${toneClass.row}`}
              >
                {content}
              </button>
            ) : (
              <div
                key={item.label}
                className={`flex min-h-[38px] w-full flex-1 items-center justify-between gap-3 rounded-lg border bg-white px-2.5 py-1 text-left ${toneClass.row}`}
              >
                {content}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

function CashPeriodAidReportPanel({
  data,
  isLoading,
  onItemClick,
}: {
  data: CashPeriodAidDatum[]
  isLoading: boolean
  onItemClick: (item: CashPeriodAidDatum) => void
}) {
  const [selectedYear, setSelectedYear] = useState('all')
  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const yearOptions = Array.from(new Set(data.map((item) => item.year))).sort((a, b) => b.localeCompare(a, 'tr-TR'))
  const periodOptionsForYear = Array.from(
    new Set(data
      .filter((item) => selectedYear === 'all' || item.year === selectedYear)
      .map((item) => item.period))
  ).sort((a, b) => b.localeCompare(a, 'tr-TR'))
  const filteredData = data.filter((item) => (
    (selectedYear === 'all' || item.year === selectedYear) &&
    (selectedPeriod === 'all' || item.period === selectedPeriod)
  ))
  const totalPeople = filteredData.reduce((sum, item) => sum + item.people, 0)
  const totalAmount = filteredData.reduce((sum, item) => sum + item.amount, 0)

  return (
    <section className="flex h-full min-h-[360px] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50/60 to-white shadow-sm ring-1 ring-slate-100">
      <div className="dashboard-drag-handle border-b border-emerald-700 bg-gradient-to-r from-emerald-800 via-teal-700 to-cyan-600 px-3 py-3 text-white sm:px-4">
        <div className="grid gap-3 min-[1180px]:grid-cols-[minmax(190px,1fr)_minmax(250px,auto)_minmax(230px,auto)] min-[1180px]:items-end">
          <div className="min-w-0">
            <h3 className="text-[16px] font-black uppercase leading-4 tracking-wide text-white drop-shadow-sm">
              <span className="line-clamp-2">Yıl / Dönem / Yardım Türü Ödeme Raporu</span>
            </h3>
            <p className="mt-0.5 truncate text-xs font-bold text-slate-500">yrd_ayninakti durumu 6 kayitlari</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 items-end gap-2">
            <label className="min-w-0 text-[10px] font-black uppercase text-slate-500">
              Yil
              <select
                value={selectedYear}
                onChange={(event) => {
                  setSelectedYear(event.target.value)
                  setSelectedPeriod('all')
                }}
                className="mt-1 h-10 w-full min-w-0 rounded-md border border-emerald-200 bg-white px-2 text-xs font-black text-slate-950 outline-none focus:border-emerald-500 sm:h-9 sm:min-w-[112px]"
              >
                <option value="all">Tum Yillar</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-[10px] font-black uppercase text-slate-500">
              Donem
              <select
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(event.target.value)}
                className="mt-1 h-10 w-full min-w-0 rounded-md border border-emerald-200 bg-white px-2 text-xs font-black text-slate-950 outline-none focus:border-emerald-500 sm:h-9 sm:min-w-[132px]"
              >
                <option value="all">Tum Donemler</option>
                {periodOptionsForYear.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-[minmax(82px,0.8fr)_minmax(132px,1.2fr)] gap-2 text-right">
            <div className="rounded-md border border-emerald-200 bg-gradient-to-br from-emerald-500 to-teal-600 px-2.5 py-1.5 text-white shadow-sm shadow-emerald-200/70">
              <div className="text-[10px] font-black uppercase text-emerald-50">Kişi</div>
              <div className="whitespace-nowrap text-sm font-black tabular-nums">{formatNumber(totalPeople)}</div>
            </div>
            <div className="rounded-md border border-sky-200 bg-gradient-to-br from-[#0076b6] to-[#20a4d8] px-2.5 py-1.5 text-white shadow-sm shadow-sky-200/70">
              <div className="text-[10px] font-black uppercase text-sky-50">Toplam</div>
              <div className="whitespace-nowrap text-[13px] font-black tabular-nums">{formatMoney(totalAmount)}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-auto p-2.5 [scrollbar-width:thin]">
       <div className="min-w-[560px] space-y-2">
        {isLoading ? (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-500">Yukleniyor...</div>
        ) : filteredData.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-500">Durumu 6 olan nakit yardimi kaydi bulunamadi.</div>
        ) : (
          filteredData.map((item) => (
            <button
              key={`${item.year}:${item.period}:${item.type}`}
              type="button"
              onClick={() => onItemClick(item)}
              className="grid min-h-[52px] w-full grid-cols-[52px_minmax(140px,1.05fr)_minmax(120px,0.85fr)_56px_96px] items-center gap-2 rounded-md border border-emerald-100 bg-white/90 px-2.5 py-2 text-left transition hover:border-emerald-400 hover:bg-white hover:shadow-sm"
            >
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400">Yil</div>
                <div className="text-sm font-black text-slate-950">{item.year}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase text-slate-400">Donem</div>
                <div className="truncate text-sm font-black leading-snug text-slate-950">{item.period}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase text-slate-400">Yardım Türü</div>
                <div className="truncate text-sm font-black uppercase leading-snug tracking-wide text-emerald-900">{item.type}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black uppercase text-slate-400">Kişi</div>
                <div className="text-sm font-black text-slate-950">{formatNumber(item.people)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black uppercase text-slate-400">Tutar</div>
                <div className="text-sm font-black text-emerald-800">{formatMoney(item.amount)}</div>
              </div>
            </button>
          ))
        )}
       </div>
      </div>
    </section>
  )
}

function AidPaymentPeriodPanel({
  data,
  isLoading,
  onItemClick,
}: {
  data: AidPaymentPeriodDatum[]
  isLoading: boolean
  onItemClick: (item: { type: string; title: string; year: string }) => void
}) {
  const [selectedYear, setSelectedYear] = useState('all')
  const yearOptions = Array.from(new Set(data.map((item) => item.year))).sort((a, b) => b.localeCompare(a, 'tr-TR'))
  const filteredData = data.filter((item) => selectedYear === 'all' || item.year === selectedYear)
  const totalCount = filteredData.reduce((sum, item) => sum + item.count, 0)
  const totalAmount = filteredData.reduce((sum, item) => sum + item.amount, 0)
  const totalShoppingAmount = filteredData.reduce((sum, item) => sum + item.shoppingAmount, 0)

  return (
    <section className="flex h-full min-h-[280px] flex-col overflow-hidden rounded-lg border border-sky-200 bg-white shadow-md ring-1 ring-slate-100">
      <div className="dashboard-drag-handle border-b border-sky-700 bg-gradient-to-r from-[#005f95] via-[#0076b6] to-cyan-500 px-4 py-3 text-white">
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_126px] sm:items-end">
            <div className="min-w-0">
              <h3 className="text-[16px] font-black uppercase tracking-wide text-white drop-shadow-sm">
                <span className="line-clamp-2 leading-4">Yardım Türü Ödeme Raporu</span>
              </h3>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Secilen tur icin yillik toplam</p>
            </div>
            <label className="w-[126px] shrink-0 text-[10px] font-black uppercase text-slate-500">
              Yil
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-sky-200 bg-white px-2 text-xs font-black text-slate-950 outline-none focus:border-[#0076b6]"
              >
                <option value="all">Tum Yillar</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SmallTotal label="Toplam Sayi" value={formatNumber(totalCount)} />
            <SmallTotal label="Toplam Miktar" value={formatMoney(totalAmount)} />
            <SmallTotal label="Toplam Alışveriş" value={formatMoney(totalShoppingAmount)} />
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PeriodPaymentRows data={filteredData} isLoading={isLoading} onItemClick={onItemClick} />
      </div>
    </section>
  )
}

// Kullanici istegi: "Kurban" ve "Aceze" ozet alanlari birbirinden BAGIMSIZ
// tasinabilir/boyutlandirilabilir olsun - eskiden tek bir bilesen (
// AidCountPeriodPanel) ikisini de AYNI yil/donem filtresini paylasarak tek
// bir Fragment icinde donduruyordu. Artik iki AYRI bilesen, kendi filtre
// durumuyla - kurban kaydi girme/duzenleme akisi SADECE KurbanReportPanel'de.
function useAidCountPeriodOptions(data: AidCountPeriodDatum[], selectedYear: string) {
  const yearOptions = Array.from(new Set(data.map((item) => item.year))).sort((a, b) => b.localeCompare(a, 'tr-TR'))
  const periodOptions = Array.from(
    new Set(data
      .filter((item) => selectedYear === 'all' || item.year === selectedYear)
      .map((item) => item.period))
  ).sort((a, b) => b.localeCompare(a, 'tr-TR'))
  return { yearOptions, periodOptions }
}

function KurbanReportPanel({
  data,
  isLoading,
  onKurbanListClick,
}: {
  data: AidCountPeriodDatum[]
  isLoading: boolean
  onKurbanListClick: (selection: { year: string; period: string }) => void
}) {
  const [selectedYear, setSelectedYear] = useState('all')
  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const [kurbanModalOpen, setKurbanModalOpen] = useState(false)
  const [kurbanForm, setKurbanForm] = useState({
    tarih: formatInputDate(new Date()),
    kurbanTuru: 'Vekaleten Kurban Kesimi',
    kurbanCinsi: 'Küçük Baş Kurban',
    adet: '',
  })
  const [kurbanStatus, setKurbanStatus] = useState('')
  const [isSavingKurban, setIsSavingKurban] = useState(false)
  const { yearOptions, periodOptions } = useAidCountPeriodOptions(data, selectedYear)
  const kurbanSourceRows = data.filter((item) => item.type.toLocaleLowerCase('tr-TR').includes('kurban'))
  const kurbanFilteredRows = kurbanSourceRows.filter((item) => (
    (selectedYear === 'all' || item.year === selectedYear) &&
    (selectedPeriod === 'all' || item.period === selectedPeriod)
  ))
  const kurbanRows = Array.from(
    kurbanFilteredRows.reduce((groups, item) => {
      const isAnnualSummary = selectedYear === 'all' && selectedPeriod === 'all'
      const isSelectedYearMonthly = selectedYear !== 'all' && selectedPeriod === 'all'
      const keyPeriod = isAnnualSummary ? 'Yillik Toplam' : item.period
      const keyType = item.type
      const key = isSelectedYearMonthly
        ? `${item.year}:${item.period}:${keyType}`
        : `${item.year}:${keyPeriod}:${keyType}`
      const current = groups.get(key) ?? {
        year: item.year,
        period: keyPeriod,
        type: keyType,
        count: 0,
      }
      current.count += item.count
      groups.set(key, current)
      return groups
    }, new Map<string, AidCountPeriodDatum>()),
  ).map(([, item]) => item).sort((a, b) => {
    const yearCompare = b.year.localeCompare(a.year, 'tr-TR')
    return yearCompare || b.period.localeCompare(a.period, 'tr-TR') || a.type.localeCompare(b.type, 'tr-TR')
  })
  const kurbanTotal = kurbanRows.reduce((sum, item) => sum + item.count, 0)

  const saveKurbanCount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSavingKurban(true)
    setKurbanStatus('')

    try {
      const response = await fetch('/api/dashboard/kurban-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kurbanForm),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kurban sayisi kaydedilemedi.')
      }

      setKurbanModalOpen(false)
      setKurbanForm({
        tarih: formatInputDate(new Date()),
        kurbanTuru: 'Vekaleten Kurban Kesimi',
        kurbanCinsi: 'Küçük Baş Kurban',
        adet: '',
      })
      window.location.reload()
    } catch (error) {
      setKurbanStatus(error instanceof Error ? error.message : 'Kurban sayisi kaydedilemedi.')
    } finally {
      setIsSavingKurban(false)
    }
  }

  return (
    <>
      <section className="flex h-full min-h-[280px] flex-col overflow-hidden rounded-lg border border-amber-200 bg-white shadow-md ring-1 ring-slate-100">
        <div className="dashboard-drag-handle border-b border-amber-700 bg-gradient-to-r from-amber-800 via-orange-700 to-yellow-600 px-4 py-3 text-white">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-black uppercase tracking-wide text-white">Kurban Raporu</h3>
              <p className="mt-0.5 text-xs font-bold text-slate-500">Tarih, tur, cins ve adet bilgileri</p>
            </div>
            <div className="grid gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-end">
              <PeriodFilters
                selectedYear={selectedYear}
                selectedPeriod={selectedPeriod}
                yearOptions={yearOptions}
                periodOptions={periodOptions}
                onYearChange={(year) => {
                  setSelectedYear(year)
                  setSelectedPeriod('all')
                }}
                onPeriodChange={setSelectedPeriod}
              />
              <SmallTotal label="Kurban" value={formatNumber(kurbanTotal)} />
            </div>
          </div>
        </div>
        {isLoading ? (
          <div className="p-3 text-sm font-bold text-slate-500">Yukleniyor...</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
            <PeriodCountGroup
              title="Kesilen Kurban"
              data={kurbanRows}
              total={kurbanTotal}
              emptyText="Kurban kaydi bulunamadi."
              action={
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onKurbanListClick({ year: selectedYear, period: selectedPeriod })}
                    className="rounded-md bg-[#0076b6] px-3 py-2 text-[11px] font-black uppercase text-white shadow-sm ring-1 ring-sky-600/20 hover:bg-[#00649b]"
                  >
                    Listele
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKurbanStatus('')
                      setKurbanModalOpen(true)
                    }}
                    className="w-max whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-[11px] font-black uppercase text-white shadow-sm ring-1 ring-blue-500/30 hover:bg-blue-700"
                  >
                    Kurban Sayısı Giriniz
                  </button>
                </div>
              }
            />
          </div>
        )}
      </section>
      {kurbanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <form onSubmit={saveKurbanCount} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-xs font-black uppercase text-amber-700">Kurban Sayisi Gir</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">Yeni kurban kaydi</h2>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-600">Tarih</span>
                <input
                  type="date"
                  value={kurbanForm.tarih}
                  onChange={(event) => setKurbanForm((current) => ({ ...current, tarih: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold outline-none focus:border-amber-500"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-600">Kurban Turu</span>
                <select
                  value={kurbanForm.kurbanTuru}
                  onChange={(event) => setKurbanForm((current) => ({ ...current, kurbanTuru: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold outline-none focus:border-amber-500"
                  required
                >
                  <option value="Vekaleten Kurban Kesimi">Vekaleten Kurban Kesimi</option>
                  <option value="Vacip Kurban Kesimi">Vacip Kurban Kesimi</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-600">Kurban Cinsi</span>
                <select
                  value={kurbanForm.kurbanCinsi}
                  onChange={(event) => setKurbanForm((current) => ({ ...current, kurbanCinsi: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold outline-none focus:border-amber-500"
                  required
                >
                  <option value="Küçük Baş Kurban">Küçük Baş Kurban</option>
                  <option value="Büyük Baş Kurban">Büyük Baş Kurban</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-black uppercase text-slate-600">Adet</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={kurbanForm.adet}
                  onChange={(event) => setKurbanForm((current) => ({ ...current, adet: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold outline-none focus:border-amber-500"
                  required
                />
              </label>
            </div>
            {kurbanStatus && <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{kurbanStatus}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setKurbanModalOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
              >
                Vazgec
              </button>
              <button
                type="submit"
                disabled={isSavingKurban}
                className="rounded-md bg-amber-700 px-4 py-2 text-xs font-black text-white hover:bg-amber-800 disabled:pointer-events-none disabled:opacity-50"
              >
                {isSavingKurban ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function AcezeReportPanel({ data, isLoading }: { data: AidCountPeriodDatum[]; isLoading: boolean }) {
  const [selectedYear, setSelectedYear] = useState('all')
  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const { yearOptions, periodOptions } = useAidCountPeriodOptions(data, selectedYear)
  const yearFilteredData = data.filter((item) => selectedYear === 'all' || item.year === selectedYear)
  const acezeRows = yearFilteredData.filter((item) => item.type.toLocaleLowerCase('tr-TR').includes('aceze'))
  const acezeTotal = acezeRows.reduce((sum, item) => sum + item.count, 0)

  return (
    <section className="flex h-full min-h-[280px] flex-col overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-md ring-1 ring-slate-100">
      <div className="dashboard-drag-handle border-b border-emerald-700 bg-gradient-to-r from-emerald-800 via-teal-700 to-lime-600 px-4 py-3 text-white">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black uppercase tracking-wide text-white">Aceze Yardımı Raporu</h3>
            <p className="mt-0.5 text-xs font-bold text-slate-500">Yillik toplam sayi ozeti</p>
          </div>
          <div className="grid gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-end">
            <PeriodFilters
              selectedYear={selectedYear}
              selectedPeriod={selectedPeriod}
              yearOptions={yearOptions}
              periodOptions={periodOptions}
              onYearChange={(year) => {
                setSelectedYear(year)
                setSelectedPeriod('all')
              }}
              onPeriodChange={setSelectedPeriod}
            />
            <SmallTotal label="Aceze" value={formatNumber(acezeTotal)} />
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="p-3 text-sm font-bold text-slate-500">Yukleniyor...</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
          <PeriodCountGroup
            title="Aceze Yardimi"
            data={acezeRows}
            total={acezeTotal}
            emptyText="Aceze kaydi bulunamadi."
            tone="emerald"
            groupByYear
          />
        </div>
      )}
    </section>
  )
}

function PeriodFilters({
  selectedYear,
  selectedPeriod,
  yearOptions,
  periodOptions,
  onYearChange,
  onPeriodChange,
}: {
  selectedYear: string
  selectedPeriod: string
  yearOptions: string[]
  periodOptions: string[]
  onYearChange: (year: string) => void
  onPeriodChange: (period: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-[10px] font-black uppercase text-slate-500">
        Yil
        <select
          value={selectedYear}
          onChange={(event) => onYearChange(event.target.value)}
          className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-950 outline-none focus:border-[#0076b6]"
        >
          <option value="all">Tum Yillar</option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </label>
      <label className="text-[10px] font-black uppercase text-slate-500">
        Ay
        <select
          value={selectedPeriod}
          onChange={(event) => onPeriodChange(event.target.value)}
          className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-950 outline-none focus:border-[#0076b6]"
        >
          <option value="all">Tum Aylar</option>
          {periodOptions.map((period) => (
            <option key={period} value={period}>{period}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function SmallTotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[92px] rounded-md border border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-sky-50 px-3 py-2 shadow-sm">
      <div className="text-[9px] font-black uppercase text-emerald-700">{label}</div>
      <div className="mt-0.5 truncate text-sm font-black text-[#005f95]">{value}</div>
    </div>
  )
}

function PeriodPaymentRows({
  data,
  isLoading,
  onItemClick,
}: {
  data: AidPaymentPeriodDatum[]
  isLoading: boolean
  onItemClick: (item: { type: string; title: string; year: string }) => void
}) {
  const paymentGroups = [
    { type: 'Gida', title: 'Gida Yardimi' },
    { type: 'Donem Disi Gida', title: 'Donem Disi Gida Yardimi' },
    { type: 'Destek Paketi', title: 'Destek Paketi Yardimi' },
    { type: 'Giyim', title: 'Giyim Yardimi' },
  ].map((group) => ({
    ...group,
    rows: data.filter((item) => item.type === group.type),
  }))
  const [selectedType, setSelectedType] = useState(paymentGroups[0]?.type ?? 'Gida')
  const selectedGroup = paymentGroups.find((group) => group.type === selectedType) ?? paymentGroups[0]

  if (isLoading) return <div className="p-3 text-sm font-bold text-slate-500">Yukleniyor...</div>
  if (data.length === 0) return <div className="p-3 text-sm font-bold text-slate-500">Odeme kaydi bulunamadi.</div>

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-sky-100 bg-white p-3">
        <div className="overflow-x-auto rounded-md border border-sky-100 bg-gradient-to-r from-sky-50 to-emerald-50 p-1">
        <div className="grid min-w-[480px] grid-cols-4 gap-1">
        {paymentGroups.map((group) => {
          const isSelected = group.type === selectedType
          const groupCount = group.rows.reduce((sum, item) => sum + item.count, 0)
          const groupAmount = group.rows.reduce((sum, item) => sum + item.amount, 0)
          const groupShoppingAmount = group.rows.reduce((sum, item) => sum + item.shoppingAmount, 0)

          return (
            <button
              key={group.type}
              type="button"
              onClick={() => setSelectedType(group.type)}
              className={`min-h-[84px] rounded px-2.5 py-2 text-left transition ${
                isSelected
                  ? 'bg-white text-[#005f95] shadow-md ring-1 ring-sky-300'
                  : 'text-slate-600 hover:bg-white/90 hover:shadow-sm'
              }`}
            >
              <div className="line-clamp-2 min-h-[28px] text-[11px] font-black uppercase leading-[14px]">{group.title}</div>
              <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2 text-[10px] font-extrabold">
                <span className="text-slate-500">{formatNumber(groupCount)} kayit</span>
                <span className={isSelected ? 'text-emerald-700' : 'text-slate-400'}>{formatMoney(groupAmount)}</span>
              </div>
              {/* Kullanici istegi: kartan odenen tutarin yaninda GERCEKTEN
                  fatura kesilen (alisveris) tutar da gorunsun. */}
              <div className="mt-0.5 grid grid-cols-[1fr_auto] items-center gap-2 text-[10px] font-extrabold">
                <span className="text-slate-400">Alışveriş</span>
                <span className={isSelected ? 'text-amber-700' : 'text-slate-400'}>{formatMoney(groupShoppingAmount)}</span>
              </div>
            </button>
          )
        })}
        </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <PeriodPaymentGroup
        title={selectedGroup.title}
        type={selectedGroup.type}
        data={selectedGroup.rows}
        onItemClick={onItemClick}
      />
      </div>
    </div>
  )
}

function PeriodPaymentGroup({
  title,
  type,
  data,
  onItemClick,
}: {
  title: string
  type: string
  data: AidPaymentPeriodDatum[]
  onItemClick: (item: { type: string; title: string; year: string }) => void
}) {
  const totalCount = data.reduce((sum, item) => sum + item.count, 0)
  const totalAmount = data.reduce((sum, item) => sum + item.amount, 0)
  const totalShoppingAmount = data.reduce((sum, item) => sum + item.shoppingAmount, 0)
  const countLabel = `${title.replace(' Yardimi', '')} Sayisi`
  const yearlyData = Array.from(
    data.reduce((years, item) => {
      const current = years.get(item.year) ?? { year: item.year, count: 0, amount: 0, shoppingAmount: 0 }
      current.count += item.count
      current.amount += item.amount
      current.shoppingAmount += item.shoppingAmount
      years.set(item.year, current)
      return years
    }, new Map<string, { year: string; count: number; amount: number; shoppingAmount: number }>())
  ).map(([, item]) => item).sort((a, b) => b.year.localeCompare(a.year, 'tr-TR'))

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-md border border-sky-200 bg-white shadow-sm">
      <div className="border-b border-sky-700 bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-3 py-2 text-white">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <h4 className="min-w-0 text-[12px] font-black uppercase leading-snug text-white drop-shadow-sm">{title}</h4>
          <div className="grid grid-cols-3 gap-1.5 text-right">
            <div className="rounded border border-sky-200 bg-gradient-to-br from-[#0076b6] to-[#20a4d8] px-2 py-1 text-white shadow-sm">
              <div className="text-[9px] font-black uppercase text-sky-50">Sayi</div>
              <div className="text-xs font-black">{formatNumber(totalCount)}</div>
            </div>
            <div className="rounded border border-emerald-200 bg-gradient-to-br from-emerald-500 to-teal-600 px-2 py-1 text-white shadow-sm">
              <div className="text-[9px] font-black uppercase text-emerald-50">Miktar</div>
              <div className="text-xs font-black">{formatMoney(totalAmount)}</div>
            </div>
            <div className="rounded border border-amber-200 bg-gradient-to-br from-amber-500 to-orange-600 px-2 py-1 text-white shadow-sm">
              <div className="text-[9px] font-black uppercase text-amber-50">Alışveriş</div>
              <div className="text-xs font-black">{formatMoney(totalShoppingAmount)}</div>
            </div>
          </div>
        </div>
      </div>
      {yearlyData.length === 0 ? (
        <div className="px-3 py-2 text-xs font-bold text-slate-500">Bu yardim turu icin odeme kaydi bulunamadi.</div>
      ) : (
        <div>
          <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 border-b border-sky-100 bg-sky-50/70 px-2 py-2 text-[9px] font-black uppercase text-[#005f95] sm:grid-cols-[70px_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)] sm:gap-2 sm:px-3">
            <div className="self-center">Yil</div>
            <div className="self-center text-right">Yardım Sayısı</div>
            <div className="self-center text-right">Toplam Miktar</div>
            <div className="self-center text-right">Alışveriş Miktarı</div>
          </div>
          {yearlyData.map((item) => (
            <button
              key={`${title}:${item.year}`}
              type="button"
              onClick={() => onItemClick({ type, title, year: item.year })}
              className="grid min-h-[52px] w-full min-w-0 grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 border-b border-sky-50 px-2 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50 sm:grid-cols-[70px_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)] sm:gap-2 sm:px-3"
            >
              <div>
                <div className="text-sm font-black leading-tight text-slate-950">{item.year}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-black uppercase text-slate-400">{countLabel}</div>
                <div className="text-sm font-black text-slate-950">{formatNumber(item.count)}</div>
              </div>
              <div className="text-right">
                <div className="break-words text-[11px] font-black text-emerald-800 sm:text-[13px]">{formatMoney(item.amount)}</div>
              </div>
              <div className="text-right">
                <div className="break-words text-[11px] font-black text-amber-700 sm:text-[13px]">{formatMoney(item.shoppingAmount)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function PeriodCountGroup({
  title,
  data,
  total,
  emptyText,
  action,
  tone = 'amber',
  groupByYear = false,
}: {
  title: string
  data: AidCountPeriodDatum[]
  total: number
  emptyText: string
  action?: React.ReactNode
  tone?: 'amber' | 'emerald'
  groupByYear?: boolean
}) {
  const toneClass = tone === 'emerald'
    ? {
      border: 'border-emerald-200',
      header: 'border-emerald-700 bg-gradient-to-r from-emerald-800 via-teal-700 to-cyan-600 text-white',
      title: 'text-white',
      row: 'border-emerald-50 hover:bg-emerald-50/70',
    }
    : {
      border: 'border-amber-200',
      header: 'border-amber-700 bg-gradient-to-r from-amber-800 via-orange-700 to-yellow-600 text-white',
      title: 'text-white',
      row: 'border-amber-50 hover:bg-amber-50/70',
    }
  const rows = groupByYear
    ? Array.from(
        data.reduce((years, item) => {
          const current = years.get(item.year) ?? { year: item.year, period: 'Yillik Toplam', type: title, count: 0 }
          current.count += item.count
          years.set(item.year, current)
          return years
        }, new Map<string, AidCountPeriodDatum>()),
      ).map(([, item]) => item).sort((a, b) => b.year.localeCompare(a.year, 'tr-TR'))
    : data

  return (
    <section className={`overflow-hidden rounded-md border bg-white ${toneClass.border}`}>
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${toneClass.header}`}>
        <div className="min-w-0">
          <div className={`whitespace-normal break-words text-[12px] font-black uppercase leading-snug ${toneClass.title}`}>{title}</div>
          <div className="mt-0.5 text-[10px] font-extrabold uppercase text-white/75">Toplam: {formatNumber(total)}</div>
        </div>
        {action}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-3 text-xs font-bold text-slate-500">{emptyText}</div>
      ) : (
        <div>
          <div className="grid grid-cols-[76px_minmax(0,1fr)_76px] gap-2 border-b border-slate-100 bg-white px-3 py-2 text-[9px] font-black uppercase text-slate-400">
            <div>Donem</div>
            <div>Tur</div>
            <div className="text-right">Sayi</div>
          </div>
          {rows.map((item) => (
            <div key={`${item.year}:${item.period}:${item.type}`} className={`grid min-h-[52px] grid-cols-[76px_minmax(0,1fr)_76px] items-center gap-2 border-b px-3 py-2 transition last:border-b-0 ${toneClass.row}`}>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400">{item.year}</div>
                <div className="text-xs font-black text-slate-950">{item.period}</div>
              </div>
              <div className={`min-w-0 whitespace-normal break-words text-[13px] font-black uppercase leading-snug ${toneClass.title}`}>{item.type}</div>
              <div className="text-right">
                <div className="text-sm font-black text-slate-950">{formatNumber(item.count)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function HorizontalBars({ data, color = '#0076b6' }: { data: ChartDatum[]; color?: string }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1)

  if (data.length === 0) {
    return <div className="py-10 text-center text-sm font-bold text-slate-500">Veri bulunamadi</div>
  }

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm font-bold">
            <span className="truncate rounded-full bg-sky-50 px-2 py-0.5 text-[12px] font-black uppercase tracking-wide text-[#005f95] ring-1 ring-sky-200">{item.label}</span>
            <span className="text-slate-950">{formatNumber(item.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max((item.value / maxValue) * 100, 4)}%`, backgroundColor: color }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

const lineColors = ['#00b884', '#0076b6', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#475569']

function AssistanceMovementArc({
  data,
  startDate,
  endDate,
  onDateRangeChange,
}: {
  data: DailyAssistanceMovementDatum[]
  startDate: string
  endDate: string
  onDateRangeChange: (range: { startDate: string; endDate: string }) => void
}) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const allGroups = Array.from(new Set(data.map((item) => item.group)))
  const days = Array.from(
    new Map(data.map((item) => [item.date || item.label, { key: item.date || item.label, label: item.label }])).values()
  )
  const totalsByGroup = allGroups
    .map((group, index) => ({
    group,
    color: lineColors[index % lineColors.length],
    total: data.filter((item) => item.group === group).reduce((sum, item) => sum + item.amount, 0),
    }))
    .sort((first, second) => second.total - first.total)
    .slice(0, 8)
  const activeGroup = totalsByGroup.some((item) => item.group === selectedGroup)
    ? selectedGroup
    : totalsByGroup[0]?.group || ''

  // Kullanici istegi: grafik kutunun TAMAMINI doldursun, kenarlarda/altta
  // bosluk kalmasin. chartContainerRef dogrudan SVG'yi saran (dolgusuz) ic
  // sarmalayiciya baglanir - boylece viewBox, SVG'nin GERCEKTEN kapladigi
  // piksel genislik VE yuksekligiyle birebir eslesir (kutu ne kadar
  // buyutulur/kucultulurse grafik de tam ona gore olcek degistirir).
  // Kullanici istegi: grafik daha KUCUK ve daha "profesyonel" gorunsun -
  // varsayilan yukseklik dusuruldu VE cizgi+alan dolgusu YERINE (asagida)
  // yuvarlatilmis-tepeli, ince cubuklu bir "bar chart" a gecildi - gunluk
  // dagitim verisi icin daha temiz/okunakli, dashboard'larda YAYGIN
  // kullanilan bir sunum.
  const [chartContainerRef, measuredChartSize] = useMeasuredSize(760, 190)
  const chartWidth = Math.max(320, Math.round(measuredChartSize.width))
  const chartHeight = Math.max(140, Math.round(measuredChartSize.height))
  const paddingLeft = 50
  const paddingRight = 12
  const topY = 14
  const bottomY = Math.max(topY + 50, chartHeight - 46)
  const plotWidth = chartWidth - paddingLeft - paddingRight
  const xStep = days.length > 1 ? plotWidth / (days.length - 1) : plotWidth
  const activeData = data.filter((item) => item.group === activeGroup)
  const maxAmount = Math.max(...activeData.map((item) => item.amount), 1)
  const yAxisMax = Math.max(Math.ceil(maxAmount / 300) * 300, 300)
  const yTicks = Array.from({ length: 4 }, (_, index) => Math.round((yAxisMax / 3) * index)).reverse()
  const points = days.map((day, dayIndex) => {
    const item = activeData.find((entry) => (entry.date || entry.label) === day.key)
    const amount = item?.amount || 0
    const normalized = amount / yAxisMax

    return {
      x: paddingLeft + dayIndex * xStep,
      y: bottomY - normalized * (bottomY - topY),
      amount,
      label: day.label,
    }
  })
  const barWidth = Math.max(2, Math.min(18, xStep * 0.55))

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Kullanici istegi: butun ogeler (baslik, yardim turu/toplam kutusu,
          tarih girdileri) ARTIK TEK BIR "flex-wrap" satirinda - eskiden
          sm: kirilim noktasinda ANI GECIS (dikeyden yataya) dar kutularda
          "toplam" rozetinin BAŞLANGIÇ etiketinin USTUNE binmesine
          (tasmasina) yol aciyordu; flex-wrap ile her oge, sigmadigi an
          KENDILIGINDEN alt satira gecer, asla UST USTE binmez. Tarih
          girdileri de kucultuldu (dar bir sabit genislige, daha kucuk
          yazi/dolguya). */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
        <div className="min-w-0">
          <p className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#005f95] ring-1 ring-sky-200">Tarih Araligi</p>
          <p className="mt-0.5 text-[10px] font-bold text-slate-500">Bu araliga gore guncellenir</p>
        </div>
        {totalsByGroup.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {totalsByGroup.map((item) => {
              const isActive = item.group === activeGroup

              return (
                <button
                  key={item.group}
                  type="button"
                  onClick={() => setSelectedGroup(item.group)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left shadow-sm transition ${
                    isActive
                      ? 'border-[#00b884] bg-emerald-50 text-slate-950 ring-1 ring-[#00b884]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-[#0076b6] hover:bg-sky-50'
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#00b884]" />
                  <span className="max-w-[90px] truncate text-[11px] font-black" title={item.group}>{item.group}</span>
                  <span className="text-xs font-black">{formatMoney(item.total)}</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-[10px] font-black uppercase text-slate-500">
            Baslangic
            <input
              type="date"
              value={startDate}
              onChange={(event) => onDateRangeChange({ startDate: event.target.value, endDate })}
              className="mt-0.5 block w-[128px] rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-bold text-slate-900 outline-none focus:border-[#0076b6]"
            />
          </label>
          <label className="text-[10px] font-black uppercase text-slate-500">
            Bitis
            <input
              type="date"
              value={endDate}
              onChange={(event) => onDateRangeChange({ startDate, endDate: event.target.value })}
              className="mt-0.5 block w-[128px] rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-bold text-slate-900 outline-none focus:border-[#0076b6]"
            />
          </label>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="py-12 text-center text-sm font-bold text-slate-500">Secilen tarih araligi icin yardim hareketi bulunamadi</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
      {/* Kullanici istegi: bu kutunun icindeki "Günlük ... Dağıtımı" baslik
          satiri (ikon + rozet + toplam) kaldirildi - toplam zaten yukaridaki
          "Tarih Araligi" kutusunda gorunuyor, burada TEKRARI gereksizdi. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-100 bg-slate-50 px-2 pb-2 pt-2">
        <div ref={chartContainerRef} className="min-h-0 flex-1">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-full w-full" role="img" aria-label="Son 1 ay gunluk miktar cizgi grafigi">
          <defs>
            <linearGradient id="daily-assistance-bar" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#00b884" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#00b884" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => {
            const y = bottomY - (tick / yAxisMax) * (bottomY - topY)
            return (
              <g key={tick}>
                <line x1={paddingLeft} x2={chartWidth - paddingRight} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
                <text x={paddingLeft - 8} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px] font-semibold">
                  {formatNumber(tick)}
                </text>
              </g>
            )
          })}
          {points.map((point) => {
            const barHeight = Math.max(0, bottomY - point.y)
            const radius = Math.min(4, barWidth / 2, barHeight)
            return (
              <rect
                key={point.label}
                x={point.x - barWidth / 2}
                y={point.y}
                width={barWidth}
                height={barHeight}
                rx={radius}
                fill="url(#daily-assistance-bar)"
              >
                <title>{`${activeGroup} - ${point.label}: ${formatMoney(point.amount)}`}</title>
              </rect>
            )
          })}
          <line x1={paddingLeft} x2={chartWidth - paddingRight} y1={bottomY} y2={bottomY} stroke="#cbd5e1" strokeWidth="1" />
          {days.map((day, index) => (
            <text
              key={day.key}
              x={paddingLeft + index * xStep}
              y={bottomY + 20}
              textAnchor="end"
              transform={`rotate(-45 ${paddingLeft + index * xStep} ${bottomY + 20})`}
              className="fill-slate-400 text-[9px] font-semibold"
            >
              {day.label}
            </text>
          ))}
        </svg>
        </div>
      </div>
        </div>
      )}
    </div>
  )
}

function RequestedDocumentsList({ data, onOpenFile }: { data: RequestedDocument[]; onOpenFile: (item: RequestedDocument) => void }) {
  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-sm font-bold text-slate-500">
        Istenen evrak kaydi bulunamadi.
      </div>
    )
  }

  const compactColumns = 'grid-cols-[76px_76px_minmax(96px,1fr)_minmax(110px,1.15fr)_minmax(86px,0.75fr)]'

  return (
    <div className="h-full max-w-full overflow-auto">
      <div className="min-w-[450px] sm:min-w-0">
        <div className={`grid ${compactColumns} gap-1.5 border-b border-sky-100 bg-gradient-to-r from-sky-50 to-emerald-50 px-2 py-2 text-[10px] font-black uppercase tracking-wide text-[#005f95]`}>
          <div className="rounded bg-white/80 px-1.5 py-1 ring-1 ring-sky-100">Tarih</div>
          <div className="rounded bg-white/80 px-1.5 py-1 ring-1 ring-sky-100">Dosya No</div>
          <div className="rounded bg-white/80 px-1.5 py-1 ring-1 ring-sky-100">Dosya Sahibi</div>
          <div className="rounded bg-white/80 px-1.5 py-1 ring-1 ring-sky-100">Istenen Belge</div>
          <div className="rounded bg-white/80 px-1.5 py-1 ring-1 ring-sky-100">Isteyen</div>
        </div>
        <div className="divide-y divide-slate-100">
          {data.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenFile(item)}
              className={`grid w-full ${compactColumns} gap-1.5 px-2 py-2 text-left text-[11px] font-bold text-slate-700 transition hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0076b6]`}
              title="Dosyayi ac"
            >
              <span className="whitespace-nowrap font-black text-[#005f95]">{formatDate(item.requestedDate)}</span>
              <span className="truncate text-slate-900">{item.fileNo}</span>
              <span className="truncate text-slate-900">{item.name}</span>
              <span className="truncate text-slate-900">{item.documentTitle}</span>
              <span className="truncate">{item.requestedBy}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function AssistanceAlertCard({
  title,
  count,
  detail,
  active,
  onClick,
  onTypeClick,
  tone,
  breakdown,
  compact = false,
  fill = false,
}: {
  title: string
  count: number
  detail: string
  active: boolean
  onClick: () => void
  onTypeClick: (type: string) => void
  tone: 'start' | 'end'
  breakdown: Array<{ type: string; items: AssistanceAlert[] }>
  compact?: boolean
  // Kullanici istegi (Agustos 2026): Ana Sayfa ust siradaki 6 kutu esit
  // boyda gorunsun - fill=true, karti "h-auto" yerine "h-full" yapip grid
  // hucresini tamamen doldurur.
  fill?: boolean
}) {
  const toneClass = tone === 'start'
    ? {
      container: 'border-white bg-gradient-to-br from-white via-emerald-50 to-cyan-50/70 shadow-[0_18px_42px_rgba(16,185,129,0.13)] hover:border-[#00b884]',
      accent: 'from-[#00b884] via-[#6fb744] to-[#38bdf8]',
      icon: '+',
      iconClass: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
      badge: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-emerald-200 shadow-md shadow-emerald-200/70',
      title: 'text-white',
      header: 'from-emerald-800 via-teal-700 to-cyan-600',
      chip: 'border-emerald-100 bg-white/85 hover:border-[#00b884]',
    }
    : {
      container: 'border-white bg-gradient-to-br from-white via-orange-50 to-rose-50/80 shadow-[0_18px_42px_rgba(249,115,22,0.14)] hover:border-orange-500',
      accent: 'from-orange-500 via-amber-400 to-rose-500',
      icon: '!',
      iconClass: 'bg-orange-100 text-orange-800 ring-orange-200',
      badge: 'bg-gradient-to-br from-orange-500 to-rose-600 text-white ring-orange-200 shadow-md shadow-orange-200/80',
      title: 'text-white',
      header: 'from-orange-800 via-amber-700 to-rose-600',
      chip: 'border-orange-100 bg-white/90 hover:border-orange-500',
    }

  return (
    // Kullanici istegi: "Dosya Durum Bilgisi" listesinde yapilan ayni
    // duzeltme burada da uygulandi - kart artik "h-full" ile kendisine
    // ayrilan TUM alani zorla doldurmuyor, sadece icerigi (baslik + kayit
    // listesi) kadar yer kapliyor ("h-auto"); kutuyu buyuk birakirsaniz
    // altta beyaz kart alani DEGIL, sayfa zemini gorunur.
    <div
      onClick={onClick}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}
      role="button"
      tabIndex={0}
      className={`relative flex flex-col overflow-hidden rounded-2xl border text-left ring-1 ring-slate-100 transition hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${fill ? 'h-full min-h-[250px]' : `h-auto max-h-full ${compact ? 'min-h-[160px]' : 'min-h-[220px]'}`} ${compact ? 'p-3' : 'p-4'} ${toneClass.container} ${
        active ? 'ring-2 ring-[#0076b6] ring-offset-2' : ''
      }`}
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${toneClass.accent}`} />
      <div className={`dashboard-drag-handle ${compact ? '-mx-3 -mt-3' : '-mx-4 -mt-4'} flex min-h-[52px] items-center justify-between gap-3 bg-gradient-to-r px-4 py-2.5 ${toneClass.header}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-black ring-1 ${toneClass.iconClass}`}>
            {toneClass.icon}
          </span>
          {/* Kullanici istegi (Eylul 2026): baslik altindaki aciklama satiri
              (detail) kaldirildi - basliklar daralsin diye; ipucu olarak
              title attribute'unda kaldi. */}
          <div className="min-w-0 flex-1" title={detail}>
            <p className={`inline-flex max-w-full text-[11px] font-black uppercase tracking-wide ${toneClass.title}`}>
              <span className="line-clamp-2 leading-4">{title}</span>
            </p>
          </div>
        </div>
        <div className={`flex h-12 min-w-[62px] shrink-0 items-center justify-center rounded-lg px-3 text-2xl font-black leading-none shadow-sm ring-1 ${toneClass.badge}`}>
          {formatNumber(count)}
        </div>
      </div>
      <div className={`${compact ? 'mt-3 overflow-y-auto pr-1' : 'mt-4 overflow-hidden'} grid flex-1 auto-rows-fr gap-1`}>
        {breakdown.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-xs font-extrabold text-slate-500">
            Kayit yok
          </div>
        ) : (
          breakdown.map((group) => (
            <button
              key={group.type}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onTypeClick(group.type)
              }}
              className={`flex min-h-[38px] w-full flex-1 items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left transition hover:bg-white hover:shadow-sm ${toneClass.chip}`}
            >
              <div className="min-w-0 truncate text-xs font-black uppercase text-slate-600 dark:text-slate-300">{group.type}</div>
              <div className={`min-w-[42px] shrink-0 text-right font-black text-slate-950 ${compact ? 'text-lg' : 'text-xl'}`}>{formatNumber(group.items.length)}</div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function AssistanceAlertList({ title, data }: { title: string; data: AssistanceAlert[] }) {
  const groupedData = groupAlertsByType(data)

  return (
    <Section title={title}>
      {data.length === 0 ? (
        <div className="py-10 text-center text-sm font-bold text-slate-500">Bu kritere uygun yardim kaydi bulunamadi.</div>
      ) : (
        <div className="space-y-4">
          {groupedData.map((group) => (
            <div key={group.type} className="overflow-hidden rounded-md border border-slate-200">
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
                <h3 className="text-sm font-extrabold text-[#005f95]">{group.type}</h3>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-extrabold text-slate-600">
                  {formatNumber(group.items.length)} kayit
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="bg-white text-xs font-extrabold uppercase text-slate-600">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2">Dosya No</th>
                      <th className="border-b border-slate-200 px-3 py-2">Kişi</th>
                      <th className="border-b border-slate-200 px-3 py-2">TC</th>
                      <th className="border-b border-slate-200 px-3 py-2">Baslangic</th>
                      <th className="border-b border-slate-200 px-3 py-2">Bitis</th>
                      <th className="border-b border-slate-200 px-3 py-2">Miktar</th>
                      <th className="border-b border-slate-200 px-3 py-2">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id} className="odd:bg-white even:bg-slate-50/60 hover:bg-sky-50">
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.fileNo}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold text-slate-800">{item.applicant}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.identityNumber}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{formatDate(item.startDate)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{formatDate(item.endDate)}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">{item.amount}</td>
                        <td className="border-b border-slate-100 px-3 py-2 font-bold">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${getAssistanceStatusBadgeClass(item.statusCode, item.statusVariant)}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function ActiveTenderSummaryPanel({ data, isLoading, onOpenReport }: { data: ActiveTenderSummaryDatum[]; isLoading: boolean; onOpenReport: () => void }) {
  const typeLabels: Record<string, string> = { ekmek: 'Ekmek', hazir_yemek: 'Hazır Yemek', kahvalti: 'Kahvaltı' }
  const periodStart = data.map((item) => item.startDate).filter(Boolean).sort()[0] || null
  const periodEnd = data.map((item) => item.endDate).filter(Boolean).sort().at(-1) || null

  return (
    <section
      onClick={onOpenReport}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenReport() } }}
      role="button"
      tabIndex={0}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-[0_16px_38px_rgba(109,40,217,0.12)] ring-1 ring-violet-100 transition hover:border-violet-300 hover:shadow-[0_20px_44px_rgba(109,40,217,0.18)]"
    >
      <div className="dashboard-drag-handle flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-violet-800 via-purple-700 to-indigo-600 px-5 py-3 text-white">
        <div><h2 className="text-sm font-black uppercase tracking-wide">İçinde Bulunulan İhale Dönemi Özeti</h2><p className="mt-0.5 text-xs font-bold text-violet-100">Ekmek, Hazır Yemek ve Kahvaltı teslimat gerçekleşmeleri · detaylı rapor için tıklayın</p></div>
        <div className="flex items-center gap-2">
          {(periodStart || periodEnd) && <span className="rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-black">{formatDate(periodStart)} – {formatDate(periodEnd)}</span>}
          <span className="rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-black transition group-hover:bg-white/25">Rapor →</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">{isLoading ? <div className="p-6 text-center text-sm font-bold text-slate-500">Aktif ihale dönemi yükleniyor...</div> : data.length === 0 ? <div className="p-6 text-center text-sm font-bold text-slate-500">İçinde bulunulan tarihe ait aktif ihale dönemi bulunamadı.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-violet-50 text-left text-[11px] font-black uppercase text-violet-800"><tr><th className="p-3">Yıl</th><th className="p-3">İhale Türü</th><th className="p-3 text-right">İhale Miktarı</th><th className="p-3 text-right">Teslim</th><th className="p-3 text-right">Kalan</th><th className="p-3 text-right">Gerçekleşme</th></tr></thead><tbody>{data.map((item, index) => <tr key={`${item.year}-${item.type}-${index}`} className="border-t border-violet-100 hover:bg-violet-50/50"><td className="p-3 font-black">{item.year}</td><td className="p-3 font-black text-violet-800">{typeLabels[item.type] || item.type}</td><td className="p-3 text-right font-black">{formatNumber(item.tenderAmount)}</td><td className="p-3 text-right font-black text-emerald-700">{formatNumber(item.deliveredAmount)}</td><td className="p-3 text-right font-black text-rose-700">{formatNumber(item.remainingAmount)}</td><td className="p-3"><div className="flex items-center justify-end gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500" style={{ width: `${Math.min(100, item.progress)}%` }} /></div><span className="min-w-[58px] text-right font-black">%{item.progress.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span></div></td></tr>)}</tbody></table></div>}</div>
    </section>
  )
}

type FuneralMealRow = {
  id: string
  yil: number
  ay: number
  yemekMiktari: number
  tutar: number
  aciklama: string | null
}

function FuneralMealsPanel({ onOpenReport }: { onOpenReport: () => void }) {
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [currentYearTotal, setCurrentYearTotal] = useState({ miktar: 0, tutar: 0 })
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    let isCancelled = false

    async function loadSummary() {
      try {
        const response = await fetch('/api/dashboard/cenaze-yemekleri', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Cenaze yemekleri kayıtları alınamadı.')
        }
        const rows: FuneralMealRow[] = payload.data || []
        const total = rows
          .filter((row) => row.yil === currentYear)
          .reduce((acc, row) => ({ miktar: acc.miktar + row.yemekMiktari, tutar: acc.tutar + row.tutar }), { miktar: 0, tutar: 0 })
        if (!isCancelled) {
          setCurrentYearTotal(total)
          setLoadError('')
        }
      } catch (error) {
        if (!isCancelled) {
          setLoadError(error instanceof Error ? error.message : 'Cenaze yemekleri kayıtları alınamadı.')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadSummary()
    return () => { isCancelled = true }
  }, [currentYear])

  return (
    <section
      onClick={onOpenReport}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenReport() } }}
      role="button"
      tabIndex={0}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-[0_16px_38px_rgba(194,65,12,0.12)] ring-1 ring-orange-100 transition hover:border-orange-300 hover:shadow-[0_20px_44px_rgba(194,65,12,0.18)]"
    >
      <div className="dashboard-drag-handle flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-orange-700 via-amber-600 to-yellow-600 px-5 py-3 text-white">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide">Cenaze Yemekleri</h2>
          <p className="mt-0.5 text-xs font-bold text-orange-100">{currentYear} yılı özeti · detaylı rapor için tıklayın</p>
        </div>
        <span className="rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-black transition group-hover:bg-white/25">
          Rapor →
        </span>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm font-bold text-slate-500">Yükleniyor...</div>
      ) : loadError ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm font-bold text-rose-600">{loadError}</div>
      ) : (
        <div className="grid flex-1 grid-cols-2 items-center gap-4 p-6">
          <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 text-center">
            <p className="text-[11px] font-black uppercase tracking-wide text-orange-600">Yemek Miktarı</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{formatNumber(currentYearTotal.miktar)}</p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 text-center">
            <p className="text-[11px] font-black uppercase tracking-wide text-orange-600">Ödenen Tutar</p>
            <p className="mt-2 text-3xl font-black text-emerald-700">{formatMoney(currentYearTotal.tutar)}</p>
          </div>
        </div>
      )}
    </section>
  )
}

const performanceRankStyles = [
  'bg-gradient-to-br from-amber-400 to-yellow-600 text-white ring-amber-200 shadow-md shadow-amber-200/70',
  'bg-gradient-to-br from-slate-300 to-slate-500 text-white ring-slate-200 shadow-md shadow-slate-200/70',
  'bg-gradient-to-br from-orange-400 to-amber-700 text-white ring-orange-200 shadow-md shadow-orange-200/70',
]

// Kullanici istegi: panel artik sabit "bu ayki" siralama yerine bir TARIH
// ARALIGI secilebiliyor (Bugun/Bu Hafta/Bu Ay) - varsayilan HER ZAMAN
// "Bugun" (ana sayfada ilk bakista sadece gunun performansi gorunsun).
// Bu 3 secenek, zaten /api/dashboard'dan TEK seferde gelen (data prop'u
// icindeki daily/weekly/monthly alanlari) veriyi kullanir - aralik
// degistirmek YENI bir sunucu istegi GEREKTIRMEZ, aninda/gecikmesiz calisir.
type PerformanceRangeKey = 'daily' | 'weekly' | 'monthly'

const PERFORMANCE_RANGE_OPTIONS: { key: PerformanceRangeKey; label: string; badgeLabel: string }[] = [
  { key: 'daily', label: 'Bugün', badgeLabel: 'Bugünkü' },
  { key: 'weekly', label: 'Bu Hafta', badgeLabel: 'Bu Haftaki' },
  { key: 'monthly', label: 'Bu Ay', badgeLabel: 'Bu Ayki' },
]

interface UserPerformanceDetailData {
  userName: string
  period: string
  periodLabel: string
  operations: Array<{
    userName: string
    operationType: string
    tableName: string
    recordId: string
    description: string
    activityDate: string | null
  }>
  operationSummary: Array<{ label: string; count: number }>
  tableSummary: Array<{ label: string; count: number }>
}

function UserDailyPerformancePanel({
  data,
  isLoading,
  error,
  onViewAll,
  onOpenFullReport,
}: {
  data: UserPerformanceDatum[]
  isLoading: boolean
  error: string
  onViewAll: () => void
  onOpenFullReport: (userName: string, period: PerformanceRangeKey) => void
}) {
  // Test/deneme amacli olusturulan kullanicilar (ör. "TEST_KULLANICI_SILINEBILIR",
  // "PRISMA_TEST_KULLANICI") gercek personel performans siralamasinda
  // gorunmemeli - kullanici adinda "test" gecen hesaplar bu listeden
  // (sadece bu panelden - genel kullanici yonetiminden degil) cikariliyor.
  const isTestAccount = (userName: string) => /test/i.test(userName)
  const [range, setRange] = useState<PerformanceRangeKey>('daily')
  // Kullanici istegi: "detay istenirse icerigde gostersin" - bir satira
  // tiklaninca YENI SEKME ACMAK yerine, o kullanicinin islem dokumu AYNI
  // panelin icinde (akordeon gibi) genisleyerek gorunur. Detaylar sadece
  // istenince (ilk tiklamada) cekilir ve kullanici+aralik bazinda
  // onbelleklenir - ayni satira tekrar tiklamak/aralik degistirip geri
  // donmek gereksiz sunucu istegi yapmaz.
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [detailsCache, setDetailsCache] = useState<Record<string, UserPerformanceDetailData>>({})
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null)
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    setExpandedUser(null)
  }, [range])

  // Kullanici istegi: secili aralikta (Bugun/Bu Hafta/Bu Ay) HIC islem
  // yapmamis (degeri 0 olan) kullanicilar listede gorunmesin - sadece
  // gercekten islem yapanlar siralansin. "activeCount"/"totalCount"
  // ozet rozetleri zaten (asagida degismeden) sadece >0 olanlari
  // sayiyordu, simdi LISTENIN KENDISI de ayni mantikla filtreleniyor.
  const sortedData = [...data]
    .filter((item) => !isTestAccount(item.userName) && item[range] > 0)
    .sort((a, b) => b[range] - a[range] || a.userName.localeCompare(b.userName, 'tr-TR'))
  const topUsers = sortedData.slice(0, 10)
  const activeCount = sortedData.length
  const totalCount = sortedData.reduce((sum, item) => sum + item[range], 0)
  const maxValue = Math.max(...topUsers.map((item) => item[range]), 1)
  const rangeMeta = PERFORMANCE_RANGE_OPTIONS.find((option) => option.key === range) || PERFORMANCE_RANGE_OPTIONS[0]

  const toggleUserDetail = async (userName: string) => {
    if (expandedUser === userName) {
      setExpandedUser(null)
      return
    }

    setExpandedUser(userName)
    setDetailError('')
    const cacheKey = `${userName}__${range}`
    if (detailsCache[cacheKey]) return

    setLoadingDetailKey(cacheKey)
    try {
      const query = new URLSearchParams({ user: userName, period: range })
      const response = await fetch(`/api/settings/personnel-performance/details?${query.toString()}`)
      const payload = await response.json()

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Detay yüklenemedi.')
      }

      setDetailsCache((prev) => ({ ...prev, [cacheKey]: payload.data as UserPerformanceDetailData }))
    } catch (detailFetchError) {
      setDetailError((detailFetchError as Error).message)
    } finally {
      setLoadingDetailKey(null)
    }
  }

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border border-white bg-white shadow-[0_18px_42px_rgba(15,23,42,0.09)] ring-1 ring-emerald-200">
      <button
        type="button"
        onClick={onViewAll}
        title="Tum kullanicilarin genel performans listesini yeni sekmede ac"
        className="dashboard-drag-handle group flex w-full shrink-0 items-center justify-between gap-3 border-b border-emerald-700 bg-gradient-to-r from-emerald-800 via-teal-700 to-cyan-600 px-4 py-3 text-left transition hover:from-emerald-900 hover:via-teal-800 hover:to-cyan-700"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-8 w-2 shrink-0 rounded-full bg-gradient-to-b from-emerald-300 via-teal-200 to-cyan-200 shadow-sm" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black uppercase tracking-wide text-white drop-shadow-sm">
              Kullanici Gunluk Islem Performansi
            </h2>
            <p className="mt-0.5 truncate text-xs font-bold text-white/75">
              En cok islem yapan ilk 10 kullanici - {rangeMeta.label.toLocaleLowerCase('tr-TR')}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/30 bg-white/15 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white shadow-sm transition group-hover:bg-white/25">
          Genel Liste
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path fillRule="evenodd" clipRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
          </svg>
        </span>
      </button>

      <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 p-3 sm:p-4">
        {/* Kullanici istegi: tarih araligi secimi (Bugun/Bu Hafta/Bu Ay) -
            varsayilan Bugun. */}
        <div
          role="group"
          aria-label="Performans tarih araligi"
          className="mb-3 flex shrink-0 gap-1 rounded-lg border border-emerald-200 bg-white p-1 shadow-sm"
        >
          {PERFORMANCE_RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setRange(option.key)
              }}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${
                range === option.key
                  ? 'bg-gradient-to-r from-emerald-700 to-teal-600 text-white shadow-sm'
                  : 'text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
            İşlem Yapan: {formatNumber(activeCount)} kullanıcı
          </span>
          <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-[#005f95] ring-1 ring-sky-200">
            {rangeMeta.badgeLabel} Toplam İşlem: {formatNumber(totalCount)}
          </span>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
        ) : isLoading ? (
          <div className="py-10 text-center text-sm font-bold text-slate-500">Personel performans verileri yukleniyor...</div>
        ) : topUsers.length === 0 ? (
          <div className="py-10 text-center text-sm font-bold text-slate-500">{rangeMeta.label} icin islem kaydi bulunamadi.</div>
        ) : (
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {topUsers.map((item, index) => {
              const initials = item.userName
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toLocaleUpperCase('tr-TR')
              const value = item[range]
              const progress = value > 0 ? Math.max((value / maxValue) * 100, 6) : 0
              const isExpanded = expandedUser === item.userName
              const cacheKey = `${item.userName}__${range}`
              const detail = detailsCache[cacheKey]
              const isDetailLoading = loadingDetailKey === cacheKey

              return (
                <div
                  key={item.userName}
                  className={`overflow-hidden rounded-xl border bg-white/90 shadow-sm transition ${
                    isExpanded ? 'border-emerald-400 shadow-md' : 'border-emerald-100 hover:border-emerald-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleUserDetail(item.userName)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ring-2 ${performanceRankStyles[index] || 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
                      {index + 1}
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0076b6] to-[#00b884] text-xs font-black text-white shadow-sm ring-1 ring-sky-200">
                      {initials || '-'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-950">{item.userName}</span>
                        <span className="shrink-0 text-[10px] font-bold text-slate-400">
                          Son islem: {item.lastActivity ? new Date(item.lastActivity).toLocaleString('tr-TR') : '-'}
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-gradient-to-r from-[#0076b6] to-emerald-500" style={{ width: `${progress}%` }} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[9px] font-black uppercase text-slate-400">{rangeMeta.label}</span>
                      <span className={`block text-lg font-black leading-tight ${value > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {formatNumber(value)}
                      </span>
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`h-4 w-4 shrink-0 text-emerald-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      <path fillRule="evenodd" clipRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-emerald-100 bg-emerald-50/50 px-3 py-3">
                      {isDetailLoading ? (
                        <div className="py-4 text-center text-xs font-bold text-slate-500">Detaylar yükleniyor...</div>
                      ) : detailError ? (
                        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{detailError}</div>
                      ) : detail ? (
                        <div className="space-y-2.5">
                          {detail.operationSummary.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {detail.operationSummary.slice(0, 6).map((summary) => (
                                <span
                                  key={summary.label}
                                  className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-emerald-800 ring-1 ring-emerald-200"
                                >
                                  {summary.label}: {formatNumber(summary.count)}
                                </span>
                              ))}
                            </div>
                          )}
                          {detail.operations.length > 0 ? (
                            <ul className="space-y-1">
                              {detail.operations.slice(0, 5).map((op, opIndex) => (
                                <li
                                  key={`${op.recordId}-${opIndex}`}
                                  className="truncate rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-100"
                                  title={op.description}
                                >
                                  <span className="text-slate-400">
                                    {op.activityDate ? new Date(op.activityDate).toLocaleString('tr-TR') : '-'}
                                  </span>{' '}
                                  — {op.description}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs font-bold text-slate-500">Bu aralık için işlem kaydı yok.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenFullReport(item.userName, range)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-black uppercase text-emerald-700 shadow-sm transition hover:bg-emerald-100"
                          >
                            Tam Raporu Yeni Sekmede Aç
                            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                              <path fillRule="evenodd" clipRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// Kullanici istegi: yatay kaydirmali kart dizisi (onceki tasarim) yerine,
// AYNI SAYFADAKI "Kullanici Gunluk Islem Performansi" panelinin GORUNUMU
// (dikey, siralanmis liste - rutbe rozeti + avatar + ilerleme cubugu + sag
// tarafta sutun halinde sayilar) birebir kullanilsin diye eklendi. Sadece
// GORUNUM UserDailyPerformancePanel ile ayni; veri kaynagi/sort mantigi
// (baskin asamasi Uygundur/Uygun Degil olan personelin ONE alinmasi) AYNEN
// korunur - bkz. getDominantInvestigationTone.
function InvestigationStaffPerformancePanel({
  data,
  summary,
  isLoading,
  onStaffClick,
}: {
  data: Array<{ label: string; value: number; amount?: number; stages?: Array<{ label: string; value: number }> }>
  summary: { records: number; suitable: number; unsuitable: number; pendingReview: number; rejected: number }
  isLoading: boolean
  onStaffClick: (label: string) => void
}) {
  // Kullanici istegi: siralama artik "baskin asama" yerine "Uygun +
  // Uygun Degil TOPLAMI" (yani KARARI VERILMIS/SONUCLANDIRILMIS toplam
  // islem sayisi) esas alinir - en cok islem SONUCLANDIRAN personel en
  // basta (1., 2. ...) gorunur. Esitlikte toplam kayit sayisi (item.value)
  // ikinci kriter olarak kullanilir.
  const sortedData = [...data]
    .map((item) => {
      const uygunDegilCount = findInvestigationStageValue(item.stages, 'uygunDegil') ?? 0
      const uygundurCount = findInvestigationStageValue(item.stages, 'uygundur') ?? 0
      return {
        item,
        tone: getDominantInvestigationTone(item.stages),
        decidedTotal: uygunDegilCount + uygundurCount,
      }
    })
    .sort((a, b) => b.decidedTotal - a.decidedTotal || b.item.value - a.item.value)
  // "Uygun Degil"/"Uygundur" adiyla gorunen satirlar (gercek personel
  // DEGIL, bkz. isInvestigationStatusLikeLabel) siralama rozetinde numara
  // ALMAZ - gercek personelin numarasi bu satirlar sayilmadan 1'den baslar.
  let personnelRankCounter = 0
  const rankedData = sortedData.map((entry) => {
    const isStatusRow = isInvestigationStatusLikeLabel(entry.item.label)
    const rank = isStatusRow ? null : (personnelRankCounter += 1)
    return { ...entry, isStatusRow, rank }
  })
  const maxValue = Math.max(...rankedData.map(({ item }) => item.value), 1)

  const toneRowStyles: Record<'suitable' | 'unsuitable' | 'rejected' | 'neutral', { ring: string; avatar: string; badge: string }> = {
    suitable: { ring: 'border-emerald-200 ring-1 ring-emerald-100', avatar: 'from-emerald-600 to-teal-500', badge: 'bg-emerald-100 text-emerald-800' },
    unsuitable: { ring: 'border-rose-200 ring-1 ring-rose-100', avatar: 'from-rose-600 to-red-500', badge: 'bg-rose-100 text-rose-800' },
    // Kullanici istegi: "Otomatik Red" ayri, koyu (siyaha yakin) bir renkle
    // gosterilir - "Uygun Değil" (kirmizi) ile karistirilmasin diye.
    rejected: { ring: 'border-slate-400 ring-1 ring-slate-200', avatar: 'from-slate-800 to-slate-950', badge: 'bg-slate-800 text-white' },
    neutral: { ring: 'border-violet-100', avatar: 'from-violet-600 to-fuchsia-500', badge: 'bg-slate-100 text-slate-600' },
  }

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border border-white bg-white shadow-[0_18px_42px_rgba(15,23,42,0.09)] ring-1 ring-violet-200">
      <div className="dashboard-drag-handle flex w-full shrink-0 items-center gap-3 border-b border-violet-800 bg-gradient-to-r from-violet-800 via-fuchsia-700 to-pink-600 px-4 py-3 text-left">
        <span className="h-8 w-2 shrink-0 rounded-full bg-gradient-to-b from-violet-300 via-fuchsia-200 to-pink-200 shadow-sm" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-black uppercase tracking-wide text-white drop-shadow-sm">
            Tahkikat Personeline Gore Nakit Yardimlar
          </h2>
          <p className="mt-0.5 truncate text-xs font-bold text-white/75">
            Durumu 0 (yeni müracaat) kayıtların, atanan tahkikat personeline göre dağılımı
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-br from-violet-50/70 via-white to-fuchsia-50/40 p-3 sm:p-4">
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-slate-700 ring-1 ring-slate-200">
            Toplam Kayıt: {formatNumber(summary.records)}
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
            Toplam Uygun: {formatNumber(summary.suitable)}
          </span>
          <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
            Toplam Uygun Değil: {formatNumber(summary.unsuitable)}
          </span>
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">
            Toplam İncelenecek: {formatNumber(summary.pendingReview)}
          </span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white ring-1 ring-slate-700">
            Toplam Otomatik Red: {formatNumber(summary.rejected)}
          </span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm font-bold text-slate-500">Personel raporu hazırlanıyor...</div>
        ) : rankedData.length === 0 ? (
          <div className="py-10 text-center text-sm font-bold text-slate-500">Durumu 0 olan tahkikat kaydı bulunamadı.</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto [scrollbar-width:thin]">
           <div className="min-w-[560px] space-y-1.5">
            {rankedData.map(({ item, tone, rank }) => {
              const initials = item.label
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toLocaleUpperCase('tr-TR')
              const progress = item.value > 0 ? Math.max((item.value / maxValue) * 100, 6) : 0
              const styles = toneRowStyles[tone]
              // Kullanici istegi: "Incelenecek" satirdaki rozette (isim
              // yaninda) ARTIK gosterilmiyor - zaten sag taraftaki sabit
              // sutunlarda goruluyor, tekrar sayilir. "Uygundur"/"Uygun
              // Degil" rozeti (o personelin BASKIN durumu netse) hala
              // gosterilir.
              const incelenecekCount = findInvestigationStageValue(item.stages, 'incelenecek')
              const uygunDegilCount = findInvestigationStageValue(item.stages, 'uygunDegil')
              const uygundurCount = findInvestigationStageValue(item.stages, 'uygundur')
              const otomatikRedCount = findInvestigationStageValue(item.stages, 'otomatikRed')

              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onStaffClick(item.label)}
                  className={`flex w-full items-center gap-3 rounded-xl border bg-white/90 px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${styles.ring}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ring-2 ${rank !== null ? (performanceRankStyles[rank - 1] || 'bg-slate-100 text-slate-500 ring-slate-200') : 'bg-slate-50 ring-slate-100'}`}>
                    {rank !== null ? rank : ''}
                  </span>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${styles.avatar} text-xs font-black text-white shadow-sm ring-1 ring-white`}>
                    {initials || '-'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-black text-slate-950">{item.label}</span>
                      {tone !== 'neutral' && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${styles.badge}`}>
                          {tone === 'suitable' ? 'Uygundur' : tone === 'rejected' ? 'Otomatik Red' : 'Uygun Değil'}
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-gradient-to-r from-[#0076b6] to-emerald-500" style={{ width: `${progress}%` }} />
                    </span>
                  </span>
                  {/* Kullanici istegi: sutunlar HER SATIRDA AYNI SIRADA
                      (Incelenecek / Uygun Degil / Uygundur / Otomatik Red)
                      sabit durur - o personelde ilgili kategoriden kayit
                      yoksa "-" gosterilir. Uygun Degil, Uygundur ve Otomatik
                      Red sutunlari, sadece metin degil KUTUNUN TAMAMI (arka
                      plan) dolu renkli - Uygun Degil kirmizi, Uygundur
                      yesil, Otomatik Red koyu/siyaha yakin. */}
                  <span className="grid shrink-0 grid-cols-4 gap-2.5 text-right">
                    <span className="min-w-[52px]">
                      <span className="block truncate text-[9px] font-black uppercase text-amber-500">İncelenecek</span>
                      <span className="block text-sm font-bold leading-tight text-amber-700">
                        {incelenecekCount !== null ? formatNumber(incelenecekCount) : '-'}
                      </span>
                    </span>
                    <span className="min-w-[52px] rounded-lg bg-rose-600 px-1.5 py-1 shadow-sm">
                      <span className="block truncate text-[9px] font-black uppercase text-rose-100">Uygun Değil</span>
                      <span className="block text-sm font-black leading-tight text-white">
                        {uygunDegilCount !== null ? formatNumber(uygunDegilCount) : '-'}
                      </span>
                    </span>
                    <span className="min-w-[52px] rounded-lg bg-emerald-600 px-1.5 py-1 shadow-sm">
                      <span className="block truncate text-[9px] font-black uppercase text-emerald-100">Uygundur</span>
                      <span className="block text-sm font-black leading-tight text-white">
                        {uygundurCount !== null ? formatNumber(uygundurCount) : '-'}
                      </span>
                    </span>
                    <span className="min-w-[52px] rounded-lg bg-slate-800 px-1.5 py-1 shadow-sm">
                      <span className="block truncate text-[9px] font-black uppercase text-slate-300">Otomatik Red</span>
                      <span className="block text-sm font-black leading-tight text-white">
                        {otomatikRedCount !== null ? formatNumber(otomatikRedCount) : '-'}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
           </div>
          </div>
        )}
      </div>
    </section>
  )
}

// Kullanici istegi: Ana Sayfa'daki rapor kutulari kosesinden tutulup
// buyutulup/kucultulebilsin, yerleri degistirilebilsin ve bu duzen BU
// BILGISAYARA/TARAYICIYA OZEL kaydedilsin (bkz. components/shared/
// DashboardGrid.tsx - localStorage tabanli, kullanicilar arasi paylasilmaz).
// Bu varsayilan duzen, mevcut CSS
// grid'in gorsel oranlarina yakin bir baslangic noktasidir - kullanici ilk
// girdiginde bunu gorur, sonra istedigi gibi degistirip kaydedebilir.
// NOT: butun x/y/w/h (ve minW/minH) degerleri 48 sutunluk ince-taneli
// grid'e gore 4 kati olceklendi (bkz. components/shared/DashboardGrid.tsx
// daki not) - gorsel oranlar ESKISIYLE AYNI, sadece artik cok daha ince
// adimlarla yeniden boyutlandirilabiliyor.
// Kullanici istegi (Agustos 2026): "Ana Sayfa'daki TUM alanlarin asagi
// dogru uzunlugu AYNI olsun - hepsi 7 cm, veriler icine sigsin". DashboardGrid
// olcegi: pixelHeight = h*ROW_HEIGHT + (h-1)*ROW_MARGIN = 9h - 4 (bkz.
// components/shared/DashboardGrid.tsx ROW_HEIGHT=5, ROW_MARGIN=4). 7 cm @96dpi
// ~= 265px => h = 30 (9*30-4 = 266px ~= 7.04 cm). Tum kutular h:30, satir
// satir yerlesir; icerigi 7 cm'yi asan paneller kendi ic kaydirmalariyla
// gorunur (her panel bileseni flex-col + overflow-y-auto). Genislikler,
// satirlar 48 sutunu tam dolduracak sekilde normalize edildi.
const DASHBOARD_ROW_H = 30
// Kullanici istegi (28 Agustos 2026): "ana sayfadaki SUANKI tasarimi ANA
// tasarim olarak kabul et - tasarimi sifirlasak bile bu sekilde olsun,
// kullanici isterse degistirsin". Asagidaki dizi, o an kullanici hesabinda
// (app_settings -> dashboard_layout_20) CANLI kayitli olan "lg" duzeninin
// BIRE BIR kopyasidir (moved/static gibi runtime alanlari cikarildi). Artik
// "Varsayilan Duzene Sifirla" ve kayitli duzeni olmayan her kullanici TAM
// olarak bu yerlesimi gorur. Yeniden "bake" etmek gerekirse: ilgili
// kullanicinin duzenini elle ayarla, app_settings'ten dashboard_layout_<id>
// value.layouts.lg degerini oku ve buraya yapistir (bkz. [[dashboard-default-layout]]).
const DASHBOARD_DEFAULT_LAYOUT: Layout = [
  { i: 'file-summary', x: 0, y: 0, w: 4, h: 34, minW: 4 },
  { i: 'beneficiary-summary', x: 4, y: 0, w: 4, h: 34, minW: 4 },
  { i: 'assistance-file-reports', x: 15, y: 0, w: 6, h: 34, minW: 6 },
  { i: 'file-status-summary', x: 8, y: 0, w: 7, h: 34, minW: 6 },
  { i: 'recent-start-alerts', x: 21, y: 0, w: 6, h: 34, minW: 6 },
  { i: 'ending-soon-alerts', x: 27, y: 0, w: 6, h: 35, minW: 6 },
  { i: 'investigation-staff', x: 0, y: 34, w: 24, h: 67, minW: 8 },
  { i: 'requested-documents', x: 33, y: 0, w: 15, h: 34, minW: 8 },
  { i: 'assistance-movements', x: 0, y: 132, w: 24, h: 50, minW: 8 },
  { i: 'user-daily-performance', x: 24, y: 132, w: 24, h: 50, minW: 8 },
  { i: 'active-tender-summary', x: 0, y: 101, w: 24, h: 31, minW: 8 },
  { i: 'funeral-meals', x: 24, y: 101, w: 24, h: 31, minW: 8 },
  { i: 'cash-period-aid-report', x: 0, y: 182, w: 24, h: 147, minW: 8 },
  { i: 'aid-payment-period', x: 24, y: 245, w: 24, h: 84, minW: 8 },
  { i: 'kurban-summary', x: 24, y: 182, w: 12, h: 63, minW: 8 },
  { i: 'aceze-summary', x: 36, y: 182, w: 12, h: 63, minW: 8 },
  { i: 'assistance-map', x: 24, y: 34, w: 24, h: 67, minW: 8 },
].map((item) => ({ ...item, minW: item.minW ?? 8, minH: 16 }))

export default function DashboardPage() {
  const defaultMovementDateRange = useMemo(() => getDefaultMovementDateRange(), [])
  const [data, setData] = useState<DashboardData>(emptyDashboard)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  // Hata raporu duzeltmesi: "ana sayfadaki özet veriler gelmiyor / çok geç
  // geliyor" - kok neden, "Kullanıcı Günlük Performansı" panelinin verisini
  // (bu ay boyunca TUM sistem hareket kayitlarini isleyen, canli veride 70+
  // SANIYE surebilen AGIR bir sorgu) ana /api/dashboard cagrisiyla AYNI
  // Promise.all icinde bekletmekti - bu da "Toplam Dosya" gibi ANINDA
  // donmesi gereken basit sayilarin bile o TEK agir sorgu bitene kadar
  // ekrana hic yansimamasina yol aciyordu. Artik bu rapor AYRI, kendi
  // yukleme durumuyla, ana veriyi ENGELLEMEDEN cekiliyor (bkz. asagidaki
  // ayri useEffect ve app/api/dashboard/user-performance).
  const [userDailyPerformance, setUserDailyPerformance] = useState<UserPerformanceDatum[]>([])
  const [isUserPerformanceLoading, setIsUserPerformanceLoading] = useState(true)
  const [movementStartDate, setMovementStartDate] = useState(defaultMovementDateRange.startDate)
  const [movementEndDate, setMovementEndDate] = useState(defaultMovementDateRange.endDate)
  const { addTab } = useTabs()
  // Kullanici istegi: rapor kutularinin yerini/boyutunu degistirme SADECE
  // Kullanici Yetkileri'nde "Ana sayfa duzenini degistirme" acikca verilmis
  // personelde acik olsun. Yetki bilgisi yuklenene KADAR (isLoaded=false)
  // guvenli varsayilan olarak KAPALI sayilir - "yukleniyor" anindaki kisa
  // bir "herkese acik" yanip-sonme goruntusu istenmiyor.
  const { canUseAction: canUseDashboardAction, isLoaded: isPermissionLoaded } = useCanUseAction()
  const canEditDashboardLayout = isPermissionLoaded && canUseDashboardAction('dashboard.layout')

  useEffect(() => {
    let isCancelled = false

    async function loadDashboard() {
      try {
        setIsLoading(true)
        const query = new URLSearchParams({
          movementStartDate,
          movementEndDate,
        })
        const response = await fetch(`/api/dashboard?${query.toString()}`)
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Dashboard verileri alinamadi.')
        }

        if (!isCancelled) {
          setData(normalizeDashboardData(payload.data))
          setError('')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Dashboard yuklenirken hata olustu.')
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      isCancelled = true
    }
  }, [movementEndDate, movementStartDate])

  // Kullanici istegi/hata raporu duzeltmesi: bkz. yukaridaki
  // userDailyPerformance/isUserPerformanceLoading state yorumu - bu agir
  // rapor artik ana dashboard yuklemesinden BAGIMSIZ, kendi ucundan cekilir.
  useEffect(() => {
    let isCancelled = false

    async function loadUserPerformance() {
      try {
        setIsUserPerformanceLoading(true)
        const response = await fetch('/api/dashboard/user-performance')
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Kullanıcı performans raporu alınamadı.')
        }

        if (!isCancelled) {
          setUserDailyPerformance(Array.isArray(payload.data) ? payload.data : [])
        }
      } catch {
        // Sessiz basarisizlik: bu panel ikincil bir rapor - hata durumunda
        // ana sayfanin geri kalani ETKILENMEZ, panel sadece bos gorunur.
      } finally {
        if (!isCancelled) {
          setIsUserPerformanceLoading(false)
        }
      }
    }

    void loadUserPerformance()

    return () => {
      isCancelled = true
    }
  }, [])

  const recentStartGroups = useMemo(
    () => groupAlertsByType(data.assistanceAlerts.recentStarts),
    [data.assistanceAlerts.recentStarts]
  )
  const endingSoonGroups = useMemo(
    () => groupAlertsByType(data.assistanceAlerts.endingSoon),
    [data.assistanceAlerts.endingSoon]
  )
  const investigationStaffSummary = useMemo(() => {
    const totals = {
      records: 0,
      suitable: 0,
      unsuitable: 0,
      pendingReview: 0,
      // Kullanici istegi: "Otomatik Red" de İncelenecek/Uygundur/Uygun
      // Değil gibi ayri bir kategori olarak gosterilsin.
      rejected: 0,
    }

    data.investigationStaffReports.forEach((item) => {
      totals.records += Number(item.value || 0)
      item.stages?.forEach((stage) => {
        const label = stage.label.toLocaleLowerCase('tr-TR')
        if (label.includes('otomatik red')) {
          totals.rejected += Number(stage.value || 0)
        } else if (label.includes('uygun değil') || label.includes('uygun degil')) {
          totals.unsuitable += Number(stage.value || 0)
        } else if (label.includes('uygundur') || label.includes('uygun')) {
          totals.suitable += Number(stage.value || 0)
        } else if (label.includes('incelenecek') || label.includes('inceleme')) {
          totals.pendingReview += Number(stage.value || 0)
        }
      })
    })

    return totals
  }, [data.investigationStaffReports])
  const openReportInNewTab = (title: string, path: string) => {
    addTab({ title, path })
  }
  const openAssistanceAlertTab = (kind: 'recentStarts' | 'endingSoon', type?: string) => {
    const query = new URLSearchParams({ kind })
    if (type) query.set('type', type)

    openReportInNewTab(
      type ? `${type} Listesi` : kind === 'recentStarts' ? 'Baslayan Yardimlar' : 'Bitisi Yaklasan Yardimlar',
      `/dashboard/assistance-alerts?${query.toString()}`,
    )
  }
  const openAssistanceFileReportTab = (type: string) => {
    const query = new URLSearchParams({ type })

    openReportInNewTab(`${type} Dosyalari`, `/dashboard/assistance-file-reports?${query.toString()}`)
  }
  // Kullanici istegi: "Dosya Durum Bilgisi" widget'inda hangi ozete
  // tiklanirsa, diger widget'lar gibi ONUN dosya listesi acilsin - "Tüm
  // Dosyalar" sayfasi (AdvancedTable) zaten "durum" sutununu URL parametresiyle
  // filtreleyebiliyor (f_durum=<kod>&f_durum_op=eq), bu yuzden ayri bir rapor
  // sayfasi yapmaya gerek yok.
  const openFileStatusReportTab = (item: ChartDatum) => {
    if (item.code === undefined || item.code === null) return
    const query = new URLSearchParams({ f_durum: String(item.code), f_durum_op: 'eq' })

    openReportInNewTab(`${item.label} Dosyaları`, `/documents/all?${query.toString()}`)
  }
  const openInvestigationStaffReportTab = (staff: string) => {
    const query = new URLSearchParams({ staff })

    openReportInNewTab(`${staff} Tahkikat`, `/dashboard/investigation-staff-reports?${query.toString()}`)
  }
  const openSummaryReportTab = (kind: string, title: string) => {
    const query = new URLSearchParams({ kind, title })

    openReportInNewTab(title, `/dashboard/summary-reports?${query.toString()}`)
  }
  const openCashPeriodAidReportTab = (item: CashPeriodAidDatum) => {
    const query = new URLSearchParams()

    if (item.period === 'Belirtilmedi') {
      query.set('f_donem_op', 'empty')
    } else {
      query.set('f_donem', item.period)
      query.set('f_donem_op', 'eq')
    }

    if (item.type === 'Belirtilmedi') {
      query.set('f_asama_op', 'empty')
    } else {
      query.set('f_asama', item.type)
      query.set('f_asama_op', 'eq')
    }

    query.set('title', `${item.period} / ${item.type}`)

    openReportInNewTab(`${item.period} Nakit`, `/dashboard/cash-period-aid-records?${query.toString()}`)
  }
  const openAidPaymentReportTab = (item: { type: string; title: string; year: string }) => {
    const query = new URLSearchParams({
      type: item.type,
      year: item.year,
      title: `${item.year} ${item.title}`,
    })

    openReportInNewTab(`${item.year} ${item.title}`, `/dashboard/aid-payment-records?${query.toString()}`)
  }
  const openKurbanRecordsTab = (selection: { year: string; period: string }) => {
    const query = new URLSearchParams()

    if (selection.year !== 'all') query.set('year', selection.year)
    if (selection.period !== 'all') query.set('period', selection.period)

    const titleParts = ['Kurban Kayitlari']
    if (selection.year !== 'all') titleParts.push(selection.year)
    if (selection.period !== 'all') titleParts.push(selection.period)
    query.set('title', titleParts.join(' / '))

    openReportInNewTab(selection.year !== 'all' ? `${selection.year} Kurban` : 'Kurban Kayitlari', `/dashboard/kurban-records?${query.toString()}`)
  }
  const openCenazeYemekleriTab = () => {
    openReportInNewTab('Cenaze Yemekleri Raporu', '/dashboard/cenaze-yemekleri')
  }
  const openIhaleBilgileriTab = () => {
    openReportInNewTab('İhale Bilgileri', '/hakedis')
  }
  const openUserPerformanceTab = (userName: string, period: 'daily' | 'weekly' | 'monthly' = 'daily') => {
    const query = new URLSearchParams({ user: userName, period })

    openReportInNewTab(`${userName} Performans`, `/settings/personnel-performance-report?${query.toString()}`)
  }
  const openUserPerformanceListTab = () => {
    openReportInNewTab('Kullanici Performans Listesi', '/dashboard/user-performance')
  }
  const openRequestedDocumentFile = (item: RequestedDocument) => {
    const query = new URLSearchParams()
    if (item.fileId) {
      query.set('fileId', item.fileId)
    } else if (item.fileNo && item.fileNo !== '-') {
      query.set('search', item.fileNo)
    }

    addTab({
      title: item.fileNo && item.fileNo !== '-' ? `Dosya ${item.fileNo}` : 'Dosya Ara',
      path: query.toString() ? `/documents?${query.toString()}` : '/documents',
    })
  }

  // Kullanici istegi: her rapor kutusu bagimsiz surukle/yeniden-boyutlandir
  // birimi olsun diye - asagidaki JSX AYNEN korunuyor, sadece hangi CSS
  // grid hucresine gomulu oldugu yerine artik DashboardGrid'e (bkz.
  // components/shared/DashboardGrid.tsx) bir widget listesi olarak veriliyor.
  const widgets: DashboardWidget[] = [
    {
      id: 'file-summary',
      title: 'Dosya Özeti',
      mobileHalf: true,
      node: (
        <SummaryPairCard
          title="Dosya Ozeti"
          primaryLabel="Toplam Dosya"
          primaryValue={isLoading ? '...' : formatNumber(data.totals.files)}
          primaryRawValue={data.totals.files}
          secondaryLabel="Yardim Alan Dosya"
          secondaryValue={isLoading ? '...' : formatNumber(data.totals.statusTwoFiles)}
          secondaryRawValue={data.totals.statusTwoFiles}
          tone="blue"
          ratioLabel="Yardim alan dosya orani"
          onPrimaryClick={() => openSummaryReportTab('all-files', 'Toplam Dosya Listesi')}
          onSecondaryClick={() => openSummaryReportTab('assisted-files', 'Yardim Alan Dosyalar')}
        />
      ),
    },
    {
      id: 'beneficiary-summary',
      title: 'Birey Özeti',
      mobileHalf: true,
      node: (
        <SummaryPairCard
          title="Birey Ozeti"
          primaryLabel="Toplam Birey"
          primaryValue={isLoading ? '...' : formatNumber(data.totals.beneficiaries)}
          primaryRawValue={data.totals.beneficiaries}
          secondaryLabel="Yardim Alan Birey"
          secondaryValue={isLoading ? '...' : formatNumber(data.totals.assistedBeneficiaries)}
          secondaryRawValue={data.totals.assistedBeneficiaries}
          tone="green"
          ratioLabel="Yardim alan birey orani"
          onPrimaryClick={() => openSummaryReportTab('all-beneficiaries', 'Toplam Birey Listesi')}
          onSecondaryClick={() => openSummaryReportTab('assisted-beneficiaries', 'Yardim Alan Bireyler')}
        />
      ),
    },
    {
      id: 'assistance-file-reports',
      title: 'Yardım Alan Dosya Raporları',
      node: (
        <SummaryListPanel
          fill
          title="Yardim Alan Dosya Raporlari"
          detail="Dosya durumu yardim aliyor olanlar"
          data={data.assistanceFileReports}
          isLoading={isLoading}
          onItemClick={(item) => openAssistanceFileReportTab(item.label)}
        />
      ),
    },
    {
      id: 'file-status-summary',
      title: 'Dosya Durum Bilgisi',
      node: (
        <SummaryListPanel
          fill
          title="Dosya Durum Bilgisi"
          detail="Hazir degerlerdeki durum karsiliklari"
          data={data.fileStatusSummary}
          isLoading={isLoading}
          tone="green"
          onItemClick={openFileStatusReportTab}
        />
      ),
    },
    {
      id: 'recent-start-alerts',
      title: 'Son 10 Günde Başlayan Yardımlar',
      fullReportPath: '/dashboard/assistance-alerts?kind=recentStarts',
      fullReportTitle: 'Başlayan Yardımlar',
      node: (
        <AssistanceAlertCard
          compact
          fill
          title="Son 10 Gunde Baslayan Yardimlar"
          count={data.assistanceAlerts.recentStarts.length}
          detail="Baslangic tarihi son 10 gun icinde"
          active={false}
          onClick={() => openAssistanceAlertTab('recentStarts')}
          onTypeClick={(type) => openAssistanceAlertTab('recentStarts', type)}
          tone="start"
          breakdown={recentStartGroups}
        />
      ),
    },
    {
      id: 'ending-soon-alerts',
      title: 'Bitişine 10 Gün Kalan Yardımlar',
      fullReportPath: '/dashboard/assistance-alerts?kind=endingSoon',
      fullReportTitle: 'Bitişi Yaklaşan Yardımlar',
      node: (
        <AssistanceAlertCard
          compact
          fill
          title="Bitisine 10 Gun Kalan Yardimlar"
          count={data.assistanceAlerts.endingSoon.length}
          detail="Bitis tarihi 10 gun icinde"
          active={false}
          onClick={() => openAssistanceAlertTab('endingSoon')}
          onTypeClick={(type) => openAssistanceAlertTab('endingSoon', type)}
          tone="end"
          breakdown={endingSoonGroups}
        />
      ),
    },
    {
      id: 'investigation-staff',
      title: 'Tahkikat Personeline Göre Nakit Yardımlar',
      node: (
        <InvestigationStaffPerformancePanel
          data={data.investigationStaffReports}
          summary={investigationStaffSummary}
          isLoading={isLoading}
          onStaffClick={openInvestigationStaffReportTab}
        />
      ),
    },
    {
      id: 'requested-documents',
      title: `Belge Kayıtları (${formatNumber(data.totals.documents)})`,
      node: (
        <Section title={`Belge Kayitlari (${formatNumber(data.totals.documents)})`}>
          {isLoading ? (
            <div className="py-10 text-center text-sm font-bold text-slate-500">Belgeler yukleniyor...</div>
          ) : (
            <RequestedDocumentsList data={data.requestedDocuments} onOpenFile={openRequestedDocumentFile} />
          )}
        </Section>
      ),
    },
    {
      id: 'assistance-movements',
      title: 'Yardım Hareketleri',
      fullReportPath: '/reports/yardim-hareketleri',
      node: (
        <Section title="Yardim Hareketleri">
          <AssistanceMovementArc
            data={data.dailyAssistanceMovements}
            startDate={movementStartDate}
            endDate={movementEndDate}
            onDateRangeChange={({ startDate, endDate }) => {
              setMovementStartDate(startDate)
              setMovementEndDate(endDate)
            }}
          />
        </Section>
      ),
    },
    {
      id: 'user-daily-performance',
      title: 'Kullanıcı Günlük Performansı',
      fullReportPath: '/dashboard/user-performance',
      fullReportTitle: 'Kullanıcı Performans Listesi',
      node: (
        <UserDailyPerformancePanel
          data={userDailyPerformance}
          isLoading={isUserPerformanceLoading}
          error=""
          onOpenFullReport={openUserPerformanceTab}
          onViewAll={openUserPerformanceListTab}
        />
      ),
    },
    {
      id: 'active-tender-summary',
      title: 'Aktif İhale Özeti',
      fullReportPath: '/hakedis',
      fullReportTitle: 'İhale Bilgileri',
      node: <ActiveTenderSummaryPanel data={data.activeTenderSummary} isLoading={isLoading} onOpenReport={openIhaleBilgileriTab} />,
    },
    {
      id: 'funeral-meals',
      title: 'Cenaze Yemekleri',
      fullReportPath: '/dashboard/cenaze-yemekleri',
      fullReportTitle: 'Cenaze Yemekleri Raporu',
      node: <FuneralMealsPanel onOpenReport={openCenazeYemekleriTab} />,
    },
    {
      id: 'cash-period-aid-report',
      title: 'Durumu 6 Nakit Yardımı Dönem Raporu',
      node: (
        <CashPeriodAidReportPanel
          data={data.cashPeriodAidReports}
          isLoading={isLoading}
          onItemClick={openCashPeriodAidReportTab}
        />
      ),
    },
    {
      id: 'aid-payment-period',
      title: 'Ödeme Dönemleri Özeti',
      node: <AidPaymentPeriodPanel data={data.aidPaymentPeriodReports} isLoading={isLoading} onItemClick={openAidPaymentReportTab} />,
    },
    {
      id: 'kurban-summary',
      title: 'Kurban Kayıtları Özeti',
      fullReportPath: '/dashboard/kurban-records',
      fullReportTitle: 'Kurban Kayıtları',
      node: <KurbanReportPanel data={data.aidCountPeriodReports} isLoading={isLoading} onKurbanListClick={openKurbanRecordsTab} />,
    },
    {
      id: 'aceze-summary',
      title: 'Aceze Yardımı Özeti',
      fullReportPath: '/assistance/aceze',
      fullReportTitle: 'Aceze Yardımı',
      node: <AcezeReportPanel data={data.aidCountPeriodReports} isLoading={isLoading} />,
    },
    {
      id: 'assistance-map',
      title: 'Yardım Haritası',
      fullReportPath: '/assistance/map',
      node: <AssistanceDistributionMap variant="widget" />,
    },
  ]

  return (
    <div className="dy-dashboard w-full min-w-0 max-w-full space-y-2 overflow-x-hidden rounded-2xl bg-gradient-to-br from-sky-50/80 via-white to-emerald-50/70 p-1.5 text-slate-950 sm:space-y-5 sm:rounded-3xl sm:p-3">
      <div className="dy-dashboard-hero relative w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-white bg-gradient-to-r from-[#004f7c] via-[#0076b6] to-[#36a852] px-3 py-2 text-white shadow-[0_10px_30px_rgba(0,118,182,0.22)] ring-1 ring-sky-200 sm:rounded-2xl sm:px-5 sm:py-3">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-[#f59e0b] via-[#22c55e] to-[#38bdf8] sm:w-2" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.24),transparent_34%)]" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="relative">
            <h1 className="break-words text-[16px] font-black leading-tight tracking-normal text-white drop-shadow-sm sm:text-2xl md:text-[28px]">Ana Sayfa Rapor Paneli</h1>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      <DashboardGrid widgets={widgets} defaultLayout={DASHBOARD_DEFAULT_LAYOUT} canEdit={canEditDashboardLayout} onOpenFullReport={openReportInNewTab} />
    </div>
  )
}
