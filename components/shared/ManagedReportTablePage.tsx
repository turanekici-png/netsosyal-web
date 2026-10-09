'use client'

import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { AdvancedTable } from '@/components/shared/AdvancedTable'
import { BulkWhatsappSendButton } from '@/components/shared/BulkWhatsappSendButton'
import { BulkSmsSendButton } from '@/components/shared/BulkSmsSendButton'
import { MarkManualSentButton } from '@/components/shared/MarkManualSentButton'
import { encodeSortParam, parseSortParam } from '@/lib/sortSpec'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'
import { ReportPageHeader, reportHeaderGhostButton } from '@/components/shared/ReportPageHeader'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  findPredefinedCategoryByCandidates,
  normalizePredefinedText,
  type PredefinedValue,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import { downloadXlsx, downloadXlsxTemplate } from '@/lib/utils/xlsxExport'
import { parseXlsxFile } from '@/lib/utils/xlsxImport'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { ColumnPickerReportModal, type ReportRow } from '@/components/shared/ColumnPickerReportModal'
import { formatDate, formatFileNo, getColumnsFromData, isDateField } from '@/lib/utils'
import { combineDateRange, type MessageTemplateTokenValues } from '@/lib/messageTemplateTokens'

type ManagedReportTablePageProps = {
  eyebrow: string
  title: string
  routePath: string
  data: Record<string, unknown>[]
  tableId: string
  totalCount: number
  currentPage: number
  pageSize: number
  searchTerm?: string
  searchPlaceholder: string
  emptyMessage: string
  statusMap?: Record<string, string>
  assistanceStatusVariant?: 'default' | 'dgn'
  excludedColumns?: string[]
  requiredVisibleColumns?: string[]
  preferredColumnOrder?: string[]
  extraFilterColumns?: string[]
  columnLabels?: Record<string, string>
  filterValueOptions?: Record<string, ColumnValueOption[]>
  // Kullanici istegi (2026-09-22): "online başvuru listesinin göstere bu
  // sayfada işaretli alanda açılır listede yardım dönemleri listelensin" -
  // arac cubugunda, sutun basligi filtrelerine gomulu olmayan, DOGRUDAN
  // gorunur bir "Donem" secici. Secilen deger, o sutunun normal filtresiyle
  // AYNI URL parametresini (f_<fieldKey>, op=eq) kullanir - bu yuzden
  // altta zaten mevcut olan filtre-bazli ozetler/istatistikler (bkz.
  // app/online/page.tsx - donemStats) otomatik olarak calisir.
  quickFilterConfig?: {
    fieldKey: string
    label: string
    placeholder?: string
  }
  // Kullanici istegi: "yardım kişi sayısı, miktar gibi bazı alanların
  // toplamlarını altta gösterelim" - bkz. AdvancedTable.tsx <tfoot>.
  columnTotals?: Record<string, number>
  columnTotalsLabel?: string
  newButtonLabel?: string
  organizedToolbar?: boolean
  columnReorderingControls?: boolean
  exportFilePrefix: string
  exportEndpoint?: string
  tableKey?: string
  afterHeader?: ReactNode
  onRefresh?: () => void
  deleteConfig?: {
    endpoint: string
    label?: string
    showToolbarButton?: boolean
    allowFilteredDelete?: boolean
    filteredLabel?: string
  }
  cancelConfig?: {
    endpoint: string
    label?: string
  }
  // Secili (TEK) satirdaki kisi icin kurumda dosya yoksa, sag-tik menusunden
  // yeni bir dosya olusturup bu kaydi o dosyaya baglar - bkz. Nakit
  // Muracaatlari (app/(modules)/assistance/nakit/muracaatlar/page.tsx).
  createFileConfig?: {
    endpoint: string
    label?: string
  }
  personnelAssignConfig?: {
    endpoint: string
    label?: string
  }
  copyConfig?: {
    endpoint: string
    label?: string
    sourceStatus: number
  }
  investigationReportConfig?: {
    endpoint: string
    label?: string
  }
  recordUpdateConfig?: {
    endpoint: string
    label?: string
    sourceStatus?: number
    fields?: RecordUpdateField[]
  }
  transferConfig?: {
    endpoint: string
    label: string
    filteredLabel?: string
  }
  onlineApplicationEditConfig?: {
    endpoint: string
    label?: string
  }
  importConfig?: {
    endpoint: string
    columns: string[]
    title: string
    description: string
    templateFileName: string
  }
  // Toplu WhatsApp gonderiminde hangi telefon alaninin ONCELIKLI
  // kullanilacagini belirler - bkz. asagidaki PHONE_FIELD_CANDIDATES
  // varsayilani. Nakit Yardimlari gibi, "muracaat sirasinda verilen telefon"
  // (ceptel) ile dosyanin genel telefonunun (dosya_telefonu) FARKLI/guncel
  // olmayabildigi sayfalarda, kullanici istegi uzerine bu oncelik SAYFAYA
  // OZEL olarak degistirilebilir (bkz. assistance/nakit/page.tsx).
  phoneFieldPriority?: string[]
  // Kullanici istegi (15 Eylul 2026, 44. tur): "yardım müracaatı alanlarında
  // veriler büyük, alan küçük - yazı puntosunu küçült" - SADECE bunu isteyen
  // sayfalar (bkz. AssistanceRequestListPage.tsx) bu bayragi TRUE gecer;
  // digerleri etkilenmez (bkz. AdvancedTable.tsx compactText).
  compactText?: boolean
  // Kullanici istegi: "Filtrelenen Tümünü Seç" ile TÜM sayfalardaki eslesen
  // kayitlara (sadece o an ekranda gorunen sayfa degil) toplu WhatsApp
  // gonderebilmek. Bu SADECE bu prop verilen sayfalarda (Gıda Bankası/
  // Destek Paketi/Nakit Yardımı - bkz. AssistanceListPage.tsx) aktiftir;
  // verilmezse "Filtrelenen Tümünü Seç" WhatsApp gonderiminde eskisi gibi
  // SADECE o an sayfada secili/onbellege alinmis kayitlari kapsar.
  bulkWhatsappAllFilteredConfig?: {
    endpoint: string
    tableName: string
    // Nakit Yardımı gibi AYNI tabloyu FARKLI durumu degeriyle listeleyen
    // birden fazla sayfa varsa, o sayfanin GERCEK WHERE kosulunu sunucuya
    // bildirir ("t.durumu = <sayı>" kalıbına uymayanlar sunucuda YOK
    // SAYILIR - bkz. app/api/assistance/bulk-whatsapp-recipients/route.ts).
    whereClause?: string
  }
  // Kullanici istegi: sayfaya ozel ek toplu-islem butonlari (ör. Nakit
  // Yardimi sayfalarindaki "Müracaatları Güncelle"/"Kriterleri Uygula")
  // artik AYRI, aciklama metinli kartlar olarak degil, asagidaki ORTAK
  // arac cubugunun ("Seçili: X", "Yenile", "Toplu Guncelle" vb. ile AYNI
  // satirda) bir parcasi olarak gorunsun diye eklendi - boylece tum toplu
  // islem butonlari TEK bir gorsel alanda toplanir, dagitik/parcali
  // gorunmez. Sadece bu prop verilen sayfalari etkiler, digerlerinde
  // hicbir gorsel degisiklik yapmaz.
  extraToolbarButtons?: React.ReactNode
}

type XlsxCellValue = string | number | boolean | Date | null | undefined
type XlsxSafeRow = Record<string, XlsxCellValue>
type CsvRow = Record<string, string>
type ColumnValueOption = { value: string; label: string; count: number }
// Kullanici istegi: toplu WhatsApp icin secilen/onbellege alinan her alici -
// dosyaNo/dosyaId, gonderim sonrasi sms_gonderim_log kaydinin o DOSYAYA
// baglanmasi (ve boylece Dosya Yonetimi > "Mesaj Raporlari"nda gorunmesi)
// icin tutulur - bkz. BulkWhatsappSendButton.tsx, whatsappBulk.service.ts.
type BulkRecipientCacheEntry = {
  id: string
  phone: string | null
  label: string | null
  tokens: MessageTemplateTokenValues
  dosyaNo: string | null
  dosyaId: string | null
  // Kullanici istegi: bir kayit BASKA bir sayfadayken secilip, sonra baska
  // sayfalara/filtrelere gecildiginde de secili KALSIN ve "Seçilenleri XLSX
  // Aktar"/"Toplu Güncelle" gibi TUM islemler bu CAPRAZ-SAYFA secimleri
  // KAPSASIN - bu yuzden secilen anda tum HAM satir da (sadece WhatsApp
  // icin gereken alanlar degil) burada saklanir. Tip, "data" prop'unun
  // GERCEK tipiyle (Record<string, unknown>[]) AYNI tutulur.
  row: Record<string, unknown>
}
type PersonnelOption = { id: string; name: string; username?: string | null }
type CopyMode = 'selected' | 'filtered'
type ContextMenuPosition = { x: number; y: number } | null
type ContextActionIconType = 'personnel' | 'copy' | 'report' | 'update' | 'cancel' | 'delete' | 'add'
type InvestigationReportMode = 'selected' | 'filtered'
type BulkProgress = {
  label: string
  total: number
  completed: number
  remaining: number
}
type RecordUpdateField = 'durumu' | 'donem' | 'etiket' | 'asama' | 'miktar' | 'tahkikatpers' | 'tarih' | 'kurban_turu' | 'kurban_cinsi' | 'adet'
type OnlineApplicationEditForm = {
  id: string
  tc: string
  fullName: string
  birthDate: string
  phone: string
  iban: string
  income: string
  vehicleStatus: string
  vehicleModelYear: string
  assistanceType: string
  amount: string
  neighborhood: string
  address: string
  status: string
  period: string
  label: string
  stage: string
  description: string
}

type PredefinedValuesResponse = {
  success: boolean
  data?: {
    values: PredefinedValuesMap
    titles: PredefinedValueTitlesMap
  }
  error?: string
}

const emptyOnlineApplicationEditForm: OnlineApplicationEditForm = {
  id: '',
  tc: '',
  fullName: '',
  birthDate: '',
  phone: '',
  iban: '',
  income: '',
  vehicleStatus: '',
  vehicleModelYear: '',
  assistanceType: '',
  amount: '',
  neighborhood: '',
  address: '',
  status: '',
  period: '',
  label: '',
  stage: '',
  description: '',
}

// Kullanici istegi: dosyasi olmayan (dosyaid IS NULL - ör. Excel ile toplu
// ice aktarilip TC kimlik numarasi hicbir dosyayla eslesmemis) Nakit
// Yardimi muracaatlari cift tiklaninca acilacak bir dosya olmadigi icin
// eskiden HICBIR SEY olmuyordu - artik bu form ile muracaatin KENDI
// icerigi (dosya baglami olmadan) goruntulenip guncellenebilir. bkz.
// app/api/assistance/nakit/no-file-update/route.ts.
type NoFileCashApplicationEditForm = {
  id: string
  tc: string
  fullName: string
  birthDate: string
  phone: string
  iban: string
  income: string
  propertyInfo: string
  vehicleInfo: string
  applicationDate: string
  period: string
  label: string
  amount: string
  description: string
  stage: string
  stageDescription: string
  stageCode: string
  specialCode: string
  // Kullanici istegi (2026-09-22): "müracaatlar, yardımlar ve iptal
  // edilenler sekmelerinde bir müracaat seçilip sağ tık yaptığımızda ...
  // müracaatı aç butonu ekleyelim" - bu pencere eskiden SADECE dosyasiz
  // (dosyaid IS NULL) kayitlar icin aciliyordu (cift tiklama). Artik
  // "Müracaatı Aç" butonuyla dosyaya BAGLI kayitlar icin de acilabiliyor -
  // bu bayrak, kaydetme sirasinda HANGI API ucunun cagrilacagini (bkz.
  // saveNoFileCashApplicationEdit) ve modalin gosterdigi bilgilendirme
  // metnini belirler.
  hasFile: boolean
}

const emptyNoFileCashApplicationEditForm: NoFileCashApplicationEditForm = {
  id: '',
  tc: '',
  fullName: '',
  birthDate: '',
  phone: '',
  iban: '',
  income: '',
  propertyInfo: '',
  vehicleInfo: '',
  applicationDate: '',
  period: '',
  label: '',
  amount: '',
  description: '',
  stage: '',
  stageDescription: '',
  stageCode: '',
  specialCode: '',
  hasFile: false,
}

const EMPTY_COLUMNS: string[] = []
const BULK_PROGRESS_BATCH_SIZE = 500

function ContextActionIcon({ type }: { type: ContextActionIconType }) {
  const commonProps = {
    className: 'h-4 w-4',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
    viewBox: '0 0 24 24',
  }

  if (type === 'personnel') {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      </svg>
    )
  }

  if (type === 'copy') {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <rect width="13" height="13" x="9" y="9" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    )
  }

  if (type === 'report') {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
        <path d="M8 9h1" />
      </svg>
    )
  }

  if (type === 'update') {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M12 3a9 9 0 0 1 8.4 5.8" />
        <path d="M20.5 4.5v4.8h-4.8" />
        <path d="M12 21a9 9 0 0 1-8.4-5.8" />
        <path d="M3.5 19.5v-4.8h4.8" />
        <path d="M10 14.5 15.5 9" />
        <path d="m9 10 1-1 4 4-1 1" />
      </svg>
    )
  }

  if (type === 'cancel') {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
    )
  }

  if (type === 'add') {
    return (
      <svg aria-hidden="true" {...commonProps}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M12 12v6" />
        <path d="M9 15h6" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" {...commonProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

// "Yardımlar" rapor sayfalarındaki (organizedToolbar) üst arac cubugunu
// gorsel olarak profosyonellestirmek icin kucuk, tutarli bir ikon seti -
// hicbir buton mantigini/onClick-disabled davranisini degistirmez, sadece
// butonlarin basina anlam katan kucuk bir sembol ekler.
type ToolbarIconType =
  | 'search' | 'clear' | 'selected' | 'selectAll' | 'refresh' | 'openFile'
  | 'bulkEdit' | 'transfer' | 'exportFile' | 'exportCloud' | 'report' | 'trash' | 'settings'

function ToolbarIcon({ type }: { type: ToolbarIconType }) {
  const commonProps = {
    className: 'h-3.5 w-3.5 shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
    viewBox: '0 0 24 24',
  }

  switch (type) {
    case 'search':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      )
    case 'clear':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </svg>
      )
    case 'selected':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <rect width="17" height="17" x="3.5" y="3.5" rx="4" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      )
    case 'selectAll':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M12 3 3 8l9 5 9-5-9-5Z" />
          <path d="m3 13 9 5 9-5" />
        </svg>
      )
    case 'refresh':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      )
    case 'openFile':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M4 20h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-7.1a2 2 0 0 1-1.66-.9l-.68-1.02A2 2 0 0 0 8.9 4H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2Z" />
        </svg>
      )
    case 'bulkEdit':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      )
    case 'transfer':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      )
    case 'exportFile':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M12 3v11" />
          <path d="m7.5 10 4.5 4.5L16.5 10" />
          <path d="M4.5 19.5h15" />
        </svg>
      )
    case 'exportCloud':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M12 13.5v7" />
          <path d="m8.5 17 3.5 3.5 3.5-3.5" />
          <path d="M20.4 17.6A4.5 4.5 0 0 0 18 9h-1.3A7 7 0 1 0 4 15" />
        </svg>
      )
    case 'report':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M8 13h8" />
          <path d="M8 17h5" />
        </svg>
      )
    case 'trash':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      )
    case 'settings':
      return (
        <svg aria-hidden="true" {...commonProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      )
    default:
      return null
  }
}

// Kullanici istegi: "Yardımlar" rapor sayfalarindaki arac cubugu cok
// kalabalik duruyordu - benzer butonlar artik TEK bir "acilir buton" altinda
// toplanir, ana gorunumde sadece grubun basligi/tetikleyicisi gorunur.
// Konumlandirma, ayni dosyadaki context-menu (bkz. contextMenuPosition/
// useLayoutEffect) ile AYNI "ekran disina tasma" duzeltmesini kullanir:
// menu once tahmini konumda acilir, DOM'a eklendikten hemen sonra (boyama
// oncesi) GERCEK olculen genislik/yukseklige gore ekran icine cekilir -
// boylece sayfanin neresinde acilirsa acilsin her zaman tam gorunur.
type ToolbarTone = 'neutral' | 'brand' | 'violet' | 'cyan' | 'emerald' | 'danger'

// Kullanici istegi (2026-09-30): arac cubugu, Dosya Yönetimi sayfasinda
// yapilan "profesyonel/kurumsal" gorunum guncellemesiyle AYNI dile
// kavustursun - eskiden her oge FARKLI, parlak, birbiriyle ilgisiz bir
// renkte (mavi/mor/camgobegi/yesil-teal degrade) ve buyuk (16px) idi, bu
// dagitik/amator gorunuyordu.
// Kullanici istegi (2026-09-30, devam - CANLI ekran goruntusu ile): TUM
// ogeleri AYNI duz beyaz/lacivert yapmak butonlari "birbirinden ayirt
// edilemez" hale getirmisti ("butonlar daha belirgin ve anlaşılır olsun").
// Cozum: FULL RENKLI DOLGUYA (eski dagitik/parlak degrade) DONMEDEN, her
// grup kendi INCE renk vurgusunu (kenarlik + yazi rengi, zemin hala beyaz)
// geri kazandi - boylece hem "kurumsal/sade" (parlak dolgu yok) kalindi hem
// de butonlar birbirinden byalk goze net ayirt edilebilir oldu. Yazi
// boyutu da bir kademe daha buyutuldu.
const TOOLBAR_ITEM_BASE = 'inline-flex min-h-11 flex-1 basis-[135px] items-center justify-center gap-1.5 rounded-lg px-4 text-center text-[15px] font-bold shadow-sm transition disabled:pointer-events-none disabled:opacity-50 md:min-h-[52px] md:basis-[190px] md:px-5 md:text-[18px]'

// Kullanici istegi (2026-09-30, 9. tur - CANLI ekran goruntusuyle):
// "butonlar koyu renkte olsun, daha okunabilir ve profesyonel olsun" -
// eskiden soluk (-300) kenarliklar butonlari "zayif/gorunmez" kiliyordu -
// artik daha KOYU/DOYGUN (-600/-700) kenarlik + KOYU yazi rengi.
const TOOLBAR_TONE_CLASSES: Record<ToolbarTone, string> = {
  neutral: 'border-2 border-slate-400 bg-white text-slate-800 hover:bg-slate-50',
  brand: 'border-2 border-[#0076b6] bg-white text-[#00507a] hover:bg-sky-50',
  violet: 'border-2 border-violet-600 bg-white text-violet-800 hover:bg-violet-50',
  cyan: 'border-2 border-cyan-700 bg-white text-cyan-800 hover:bg-cyan-50',
  emerald: 'border-2 border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50',
  danger: 'border-2 border-rose-600 bg-rose-600 text-white hover:bg-rose-700',
}

// bkz. ToolbarDropdown.toggleOpen'daki not - bir menu acildiginda TUM diger
// acik menulere "kapan" demek icin kullanilan paylasilan olay adi.
const TOOLBAR_DROPDOWN_OPEN_EVENT = 'toolbar-dropdown-open'

function ToolbarDropdown({
  label,
  icon,
  tone = 'brand',
  children,
}: {
  label: string
  icon: ToolbarIconType
  tone?: ToolbarTone
  children: React.ReactNode
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isOpen = position !== null
  const dropdownId = useId()

  const toggleOpen = () => {
    if (isOpen) {
      setPosition(null)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const margin = 8
    // Kullanici istegi/hata raporu: ayni anda BIRDEN FAZLA acilir menu ekranda
    // acik kalabiliyordu (ör. "Kayıt İşlemleri" acikken "Dışa Aktar &
    // İletişim"e tiklaninca ilki kapanmiyordu). Kok neden: her menunun kendi
    // tetikleyici butonu VE kendi menu paneli TIKLAMALARDA stopPropagation()
    // cagiriyor (asagida, "Kullanici istegi: menu icindeki bir BUTONA..."
    // notuna bkz.) - bu, o tiklamanin window'a kadar HIC ULASMAMASINA yol
    // aciyor, dolayisiyla DIGER acik menulerin kendi "disina tiklandi mi"
    // dinleyicisi (asagida) bu tiklamayi HICBIR ZAMAN GORMUYOR ve kapanmiyor.
    // Cozum: BURADA (yeni bir menu ACILIRKEN) tum pencereye "bir menu acildi,
    // ID'si bu" diye ozel bir olay (CustomEvent) yayinlanir - bu, native DOM
    // click olayindan TAMAMEN BAGIMSIZDIR, stopPropagation()'dan ETKILENMEZ,
    // her zaman TÜM dinleyicilere ulaşır. Diğer TÜM ToolbarDropdown
    // ornekleri bunu dinler, kendi ID'si degilse KAPANIR.
    window.dispatchEvent(new CustomEvent(TOOLBAR_DROPDOWN_OPEN_EVENT, { detail: dropdownId }))
    setPosition({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - 260 - margin)),
      top: Math.min(rect.bottom + 6, window.innerHeight - margin),
    })
  }

  useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const margin = 8
    const rect = menuRef.current.getBoundingClientRect()
    const nextLeft = Math.max(margin, Math.min(position.left, window.innerWidth - rect.width - margin))
    const nextTop = Math.max(margin, Math.min(position.top, window.innerHeight - rect.height - margin))
    if (nextLeft !== position.left || nextTop !== position.top) {
      setPosition({ left: nextLeft, top: nextTop })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  useEffect(() => {
    if (!isOpen) return
    // ONEMLI DUZELTME (hata raporu: "mesaj sayfası açılıyor, yazmak için
    // herhangi bir tuşa basınca kapanıyor"): bu kapatma dinleyicileri
    // (ozellikle "keydown" - HER TUS basimi, sadece Escape degil - ve
    // "scroll" - capture=true ile modal ICINDEKI kaydirmalar dahil) da,
    // TIPKI daha once duzeltilen "click" ile AYNI sorunu tasiyordu: BASKA
    // hicbir sey yapmadan, sadece BulkWhatsappSendButton'in KENDI
    // modalindeki metin kutusuna yazi yazmaya baslamak bile ("keydown" HER
    // TUSTE tetiklenir) menuyu (ve icindeki TUM alt agaci - acik modal
    // DAHIL) kapatiyordu.
    //
    // ONEMLI DUZELTME (2. tur - hata raporu: "başka bir yerdeki metni
    // yapıştırmak istediğimde ekran yine kapanıyor"): panodan yapistirma
    // (Ctrl+V, Shift+Insert, sag-tik menusu, pencere odak degisikligi vb.)
    // TARAYICIYA/ISLETIM SISTEMINE GORE COK FARKLI olaylar (ve HATTA
    // "target"i modalin ICINDE OLMAYAN - ör. window blur/focus gibi - bir
    // olay) tetikleyebiliyor; "event.target icinde mi" kontrolu HER
    // olasiligi yakalayamiyordu. Artik olayin HANGI turden geldigine ya da
    // HEDEFININ NEREDE olduguna hic bakilmadan, sayfada su an ACIK bir
    // modal VAR MI diye DOGRUDAN kontrol edilir - varsa kapatma HANGI
    // olaydan gelirse gelsin tamamen atlanir. Bu, tek tek olay turu
    // kovalamak yerine KOKTEN/KESIN bir cozumdur.
    //
    // ONEMLI DUZELTME (hata raporu: "ekranda açık kalıyor" - birden fazla
    // acilir menu ayni anda acik kalabiliyordu, hicbir sey onlari
    // kapatamiyordu): burada ONCEDEN "data-keep-menu-open" araniyordu, ama o
    // isaret BulkWhatsappSendButton/BulkSmsSendButton'in tetikleyici
    // BUTONUNDA (modal ACIK OLMASA BILE, DAIMA DOM'da) da bulunuyor - o
    // buton "Dışa Aktar & İletişim" menusu HER ACILDIGINDA render oldugu
    // icin, bu genel kontrol SÜREKLI "bir modal acik" saniyor ve TUM
    // acilir menuler icin (kendisi dahil, DIGERLERI dahil) HER TURLU
    // kapatmayi engelliyordu. "data-modal-active" ise SADECE modal
    // GERCEKTEN acikken (bkz. BulkWhatsappSendButton.tsx/BulkSmsSendButton.
    // tsx) var olan, dogru/dar kapsamli isarettir.
    const close = (event: Event) => {
      if (typeof document !== 'undefined' && document.querySelector('[data-modal-active]')) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('[data-modal-active]')) return
      setPosition(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    window.addEventListener('scroll', close, true)

    // Kullanici istegi/hata raporu: "ekranda açık kalıyor" - sayfa
    // kaydirildiginda menu (fixed konumlandirildigi icin) ayni piksel
    // konumunda asili kalmaya devam ediyordu; yukaridaki "scroll" dinleyicisi
    // BAZI kaydirma turlerini (ör. sanallastirilmis/native olmayan kaydirma
    // mekanizmalari olan ic tablo konteynerleri) yakalayamayabiliyordu.
    // IntersectionObserver, ALTTAKI kaydirma mekanizmasi ne olursa olsun
    // (native scroll event'ine bagimli degildir) tetikleyici butonun
    // gercekten hala GORUNUR/ORIJINAL konumunda olup olmadigini dogrudan
    // izler - buton ekran disina kayarsa ya da orijinal konumundan (kismen
    // bile) ayrilirsa menu KESIN olarak kapatilir. Bu, tek tek kaydirma
    // olayi turu kovalamak yerine daha KOKTEN bir cozumdur.
    let hasSeenInitialEntry = false
    const observer = typeof IntersectionObserver !== 'undefined' && buttonRef.current
      ? new IntersectionObserver(([entry]) => {
          if (!hasSeenInitialEntry) {
            // Ilk tetiklenme observe() cagrisinin kendisinden gelir - bu an
            // "referans" olarak alinir, henuz kapatma yapilmaz.
            hasSeenInitialEntry = true
            return
          }
          if (!entry.isIntersecting || entry.intersectionRatio < 0.99) {
            setPosition(null)
          }
        }, { threshold: [0, 0.99, 1] })
      : null
    if (observer && buttonRef.current) observer.observe(buttonRef.current)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('scroll', close, true)
      observer?.disconnect()
    }
  }, [isOpen])

  // Kullanici istegi/hata raporu: ayni anda BIRDEN FAZLA acilir menu ekranda
  // acik kalabiliyordu - bkz. toggleOpen'daki detayli not. Bu dinleyici HER
  // ZAMAN aktiftir (isOpen'a bagli degildir, cunku KAPALI bir menunun de
  // "baska bir menu acildi" haberini alip GEREKSIZ YERE acilmamasi/durumunun
  // tutarli kalmasi onemlidir) - kendi ID'si DISINDAKI bir menu acildiginda
  // kendini kapatir.
  useEffect(() => {
    const handleOtherDropdownOpen = (event: Event) => {
      const openedId = (event as CustomEvent<string>).detail
      if (openedId !== dropdownId) setPosition(null)
    }
    window.addEventListener(TOOLBAR_DROPDOWN_OPEN_EVENT, handleOtherDropdownOpen)
    return () => window.removeEventListener(TOOLBAR_DROPDOWN_OPEN_EVENT, handleOtherDropdownOpen)
  }, [dropdownId])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          toggleOpen()
        }}
        className={`${TOOLBAR_ITEM_BASE} ${TOOLBAR_TONE_CLASSES[tone]} ${isOpen ? 'ring-2 ring-offset-1 ' + (tone === 'danger' ? 'ring-rose-300' : 'ring-sky-300') : ''}`}
      >
        <ToolbarIcon type={icon} />
        {label}
        <svg aria-hidden="true" className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} viewBox="0 0 24 24">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen && position && typeof document !== 'undefined' && createPortal((
        <div
          ref={menuRef}
          className="fixed z-[2147483000] w-64 max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_50px_rgba(15,23,42,0.20)]"
          style={{ left: position.left, top: position.top }}
          onClick={(event) => {
            event.stopPropagation()
            // Kullanici istegi: menu icindeki bir BUTONA (aksiyon) tiklandiginda
            // - yeni sekme/pencere acsa bile - menu ekranda asili KALMASIN,
            // otomatik kapansin. stopPropagation() yukarida "disina tiklayinca
            // kapat" dinleyicisinin bu tiklamayi da yakalamasini engelliyordu,
            // bu yuzden kapatma burada ACIKCA yapiliyor.
            //
            // ONEMLI DUZELTME (hata raporu: "WhatsApp'tan Toplu Gönder'e
            // basınca mesaj sayfası açılmıyor"): bazi butonlar (ör.
            // BulkWhatsappSendButton'in tetikleyicisi) tiklaninca ISLEMI
            // HEMEN BITIRMEZ, sadece kendi ic durumunda bir PENCERE/MODAL
            // acar - bu butonlar da "aksiyon butonu" sanilip menu ANINDA
            // kapatilinca, menunun (createPortal ile) TASIDIGI TUM alt
            // agac (butonun kendisi DAHIL, henuz acilmis olan modal state'i
            // ile birlikte) HEMEN UNMOUNT ediliyor - modal daha render
            // OLMADAN yok oluyordu. Bu tur butonlar govdelerine
            // "data-keep-menu-open" ekleyerek bu otomatik kapanmadan
            // MUAF tutulabilir.
            const target = event.target as HTMLElement
            if (target.closest('[data-keep-menu-open]')) return
            if (target.closest('button')) {
              setPosition(null)
            }
          }}
        >
          <div className="flex flex-col gap-1 [&>button]:w-full [&>button]:justify-start">{children}</div>
        </div>
      ), document.body)}
    </>
  )
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"' && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  values.push(current.trim())
  return values
}

function detectDelimiter(headerLine: string) {
  const delimiters = [';', ',', '\t']
  return delimiters
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ';'
}

function findPredefinedOptions(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) {
  const category = findPredefinedCategoryByCandidates(values, titles, candidates)

  return category ? values[category] ?? [] : []
}

function resolvePredefinedSelectValue(value: string, options: PredefinedValue[]) {
  if (!value) return ''

  const normalizedValue = normalizePredefinedText(value)
  const match = options.find((option) => (
    option.id === value ||
    normalizePredefinedText(option.id) === normalizedValue ||
    normalizePredefinedText(option.name) === normalizedValue
  ))

  return match?.id ?? value
}

// Kullanici istegi (2026-09-22): "Başvuru Bilgilerini Düzenle" penceresi
// (bkz. asagidaki onlineEditModalOpen bloğu) icin kucultulmus/ortak alan
// stili - eskiden HER input kendi icinde ayni uzun className'i tekrar
// ediyordu (16px, kalin, py-2).
const editModalInputClass = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100'

const EDIT_MODAL_SECTION_TONES = {
  indigo: { border: 'border-indigo-200', bg: 'bg-indigo-50/70', title: 'text-indigo-700' },
  sky: { border: 'border-sky-200', bg: 'bg-sky-50/70', title: 'text-sky-700' },
  amber: { border: 'border-amber-200', bg: 'bg-amber-50/70', title: 'text-amber-800' },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50/70', title: 'text-emerald-800' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50/70', title: 'text-violet-800' },
} as const

type EditModalTone = keyof typeof EDIT_MODAL_SECTION_TONES

function EditModalSection({ title, tone, children }: { title: string; tone: EditModalTone; children: React.ReactNode }) {
  const toneClasses = EDIT_MODAL_SECTION_TONES[tone]
  return (
    <div className={`rounded-xl border ${toneClasses.border} ${toneClasses.bg} p-3`}>
      <p className={`mb-2 text-[10px] font-black uppercase tracking-wide ${toneClasses.title}`}>{title}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  )
}

function EditModalField({ label, tone, span, children }: { label: string; tone: EditModalTone; span?: boolean; children: React.ReactNode }) {
  const toneClasses = EDIT_MODAL_SECTION_TONES[tone]
  return (
    <label className={`block ${span ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <span className={`mb-1 block text-[10px] font-black uppercase tracking-wide ${toneClasses.title}`}>{label}</span>
      {children}
    </label>
  )
}

function parseCsv(text: string): CsvRow[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalizedText.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return []

  const delimiter = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim())

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter)
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  }).filter((row) => Object.values(row).some((value) => value.trim()))
}

function toXlsxRows(rows: Record<string, unknown>[]): XlsxSafeRow[] {
  return rows.map((row) => {
    const nextRow: XlsxSafeRow = {}
    Object.entries(row).forEach(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
      ) {
        nextRow[key] = value
        return
      }

      nextRow[key] = JSON.stringify(value)
    })
    return nextRow
  })
}

function buildPageUrl(routePath: string, searchParams: URLSearchParams, page: number, searchTerm: string) {
  const params = new URLSearchParams(searchParams.toString())
  params.set('page', String(page))

  if (searchTerm.trim()) {
    params.set('search', searchTerm.trim())
  } else {
    params.delete('search')
  }

  return `${routePath}?${params.toString()}`
}

export function ManagedReportTablePage({
  eyebrow,
  title,
  routePath,
  data,
  tableId,
  totalCount,
  currentPage,
  pageSize,
  searchTerm = '',
  searchPlaceholder,
  emptyMessage,
  statusMap = {},
  assistanceStatusVariant = 'default',
  excludedColumns = [],
  requiredVisibleColumns = EMPTY_COLUMNS,
  preferredColumnOrder = EMPTY_COLUMNS,
  extraFilterColumns = EMPTY_COLUMNS,
  columnLabels = {},
  filterValueOptions = {},
  columnTotals,
  columnTotalsLabel,
  newButtonLabel,
  // Kullanici istegi: TUM rapor sayfalarinda (Diger Kurumlar dahil) daha
  // profesyonel/renkli/gruplu arac cubugu istendi - bu, halihazirda
  // Ekmek/Nakit/Müracaatlar/Online Başvurular gibi sayfalarda kullanilan,
  // KANITLANMIS "organizedToolbar" gorunumunun AYNISI. O sayfalar bunu
  // ACIKCA prop olarak veriyordu; digerleri (diger-kurumlar dahil) hic
  // vermedigi icin varsayilan (false) eski/duz gorunumde kaliyordu. Artik
  // varsayilan TRUE - boylece TUM rapor sayfalari otomatik olarak ayni
  // (zaten test edilmis) gorunume kavusur, hicbir sayfanin kendi kodunu
  // degistirmeye gerek kalmadan.
  organizedToolbar = true,
  columnReorderingControls = false,
  exportFilePrefix,
  exportEndpoint,
  tableKey,
  afterHeader,
  onRefresh,
  deleteConfig,
  cancelConfig,
  createFileConfig,
  personnelAssignConfig,
  copyConfig,
  investigationReportConfig,
  recordUpdateConfig,
  transferConfig,
  onlineApplicationEditConfig,
  importConfig,
  phoneFieldPriority,
  bulkWhatsappAllFilteredConfig,
  extraToolbarButtons,
  quickFilterConfig,
  compactText = false,
}: ManagedReportTablePageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchInput, setSearchInput] = useState(searchTerm)
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
  const [bulkRecipientCache, setBulkRecipientCache] = useState<Record<string, BulkRecipientCacheEntry>>({})
  const [allFilteredSelectedScope, setAllFilteredSelectedScope] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [isAssigningPersonnel, setIsAssigningPersonnel] = useState(false)
  const [personnelModalOpen, setPersonnelModalOpen] = useState(false)
  const [personnelOptions, setPersonnelOptions] = useState<PersonnelOption[]>([])
  const [personnelLoading, setPersonnelLoading] = useState(false)
  const [selectedPersonnel, setSelectedPersonnel] = useState('')
  const [copyModalOpen, setCopyModalOpen] = useState(false)
  const [copyMode, setCopyMode] = useState<CopyMode>('filtered')
  const [isCopying, setIsCopying] = useState(false)
  const [copyForm, setCopyForm] = useState({
    donem: '',
    etiket: '',
    asama: '',
    durumu: '',
  })
  const [investigationReportModalOpen, setInvestigationReportModalOpen] = useState(false)
  const [investigationReportMode, setInvestigationReportMode] = useState<InvestigationReportMode>('selected')
  const [isSavingInvestigationReport, setIsSavingInvestigationReport] = useState(false)
  const [investigationReportForm, setInvestigationReportForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    title: '',
    content: '',
  })
  const [recordUpdateModalOpen, setRecordUpdateModalOpen] = useState(false)
  const [isUpdatingRecord, setIsUpdatingRecord] = useState(false)
  const [isTransferring, setIsTransferring] = useState(false)
  const [onlineEditModalOpen, setOnlineEditModalOpen] = useState(false)
  const [isSavingOnlineEdit, setIsSavingOnlineEdit] = useState(false)
  const [onlineEditForm, setOnlineEditForm] = useState<OnlineApplicationEditForm>(emptyOnlineApplicationEditForm)
  const [noFileEditModalOpen, setNoFileEditModalOpen] = useState(false)
  const [isSavingNoFileEdit, setIsSavingNoFileEdit] = useState(false)
  const [noFileEditForm, setNoFileEditForm] = useState<NoFileCashApplicationEditForm>(emptyNoFileCashApplicationEditForm)
  const [noFileEditStatus, setNoFileEditStatus] = useState('')
  const [recordUpdateForm, setRecordUpdateForm] = useState({
    durumu: '',
    donem: '',
    etiket: '',
    asama: '',
    miktar: '',
    tahkikatpers: '',
    tarih: '',
    kurban_turu: '',
    kurban_cinsi: '',
    adet: '',
  })
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelDate, setCancelDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cancelReason, setCancelReason] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null)
  const [predefinedValues, setPredefinedValues] = useState<PredefinedValuesMap>(DEFAULT_PREDEFINED_VALUES)
  const [predefinedValueTitles, setPredefinedValueTitles] = useState<PredefinedValueTitlesMap>(DEFAULT_PREDEFINED_VALUE_TITLES)
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)

  const firstRecord = data.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const lastRecord = data.length === 0 ? 0 : firstRecord + data.length - 1
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const canGoPrevious = currentPage > 1
  const canGoNext = currentPage < totalPages
  // Kullanici istegi: "sayfada görünen 50 kişiyi seçip sonraki sayfaya
  // geçtiğimde oradan da istediğim kadar seçebileyim, bunu tüm sayfalarda
  // yapabileyim" - ONCEDEN bu sadece o an EKRANDAKI (mevcut sayfadaki)
  // data ile kesisim aliyordu, bu yuzden BASKA bir sayfada yapilan secim
  // "Seçili: N" sayacinda ve "Seçilenleri XLSX Aktar"/"Toplu Güncelle"
  // gibi TUM secili-kayit islemlerinde SESSIZCE KAYBOLUYORDU (sadece
  // WhatsApp toplu gonderimi, kendi ayri onbellegi sayesinde buna
  // baglisikti). Artik asagidaki bulkRecipientCache (ilk secildigi anda
  // TAM satiri saklayan, sayfa/filtre degisse bile kalici onbellek) TUM
  // secili-kayit islemleri icin ortak kaynak - capraz sayfa secimi artik
  // HER YERDE calisir.
  const selectedRows = selectedRowIds
    .map((id) => bulkRecipientCache[id]?.row ?? data.find((row) => row.id && String(row.id) === id))
    .filter((row): row is Record<string, unknown> => Boolean(row))
  const hasActiveFilter = Boolean(searchTerm.trim()) || Array.from(searchParams.keys()).some((key) => key.startsWith('f_'))

  const filterSignature = useMemo(() => {
    const params = new URLSearchParams()
    searchParams.forEach((value, key) => {
      if (key.startsWith('f_')) params.append(key, value)
    })
    return params.toString()
  }, [searchParams])
  const selectionScope = `${searchTerm.trim()}::${filterSignature}`
  const allFilteredSelected = allFilteredSelectedScope === selectionScope
  const selectedDisplayCount = allFilteredSelected ? totalCount : selectedRows.length
  const hasContextActions = Boolean(personnelAssignConfig || copyConfig || investigationReportConfig || cancelConfig || createFileConfig || recordUpdateConfig || transferConfig || onlineApplicationEditConfig || deleteConfig)
  const recordUpdateFields = recordUpdateConfig?.fields ?? (['durumu', 'donem', 'etiket', 'asama', 'miktar', 'tahkikatpers'] as RecordUpdateField[])
  const cashStageContextText = normalizePredefinedText([
    tableId,
    tableKey,
    routePath,
    title,
    recordUpdateConfig?.endpoint,
    recordUpdateConfig?.label,
    copyConfig?.endpoint,
    copyConfig?.label,
    transferConfig?.endpoint,
    transferConfig?.label,
    transferConfig?.filteredLabel,
    onlineApplicationEditConfig?.endpoint,
    onlineApplicationEditConfig?.label,
  ].filter(Boolean).join(' '))
  const isCashStageContext =
    cashStageContextText.includes('yrdayninakti') ||
    cashStageContextText.includes('nakit') ||
    cashStageContextText.includes('cash')
  const cashStageOptions = useMemo(
    () => findPredefinedOptions(predefinedValues, predefinedValueTitles, ['nakit asama', 'nakit asamasi', 'nakit durumu']),
    [predefinedValues, predefinedValueTitles]
  )
  const cashPeriodOptions = useMemo(
    () => findPredefinedOptions(predefinedValues, predefinedValueTitles, ['donem bilgisi', 'donem']),
    [predefinedValues, predefinedValueTitles]
  )
  const cashLabelOptions = useMemo(
    () => findPredefinedOptions(predefinedValues, predefinedValueTitles, ['etiket bilgisi', 'etiket']),
    [predefinedValues, predefinedValueTitles]
  )
  const investigationSubjectOptions = useMemo(
    () => findPredefinedOptions(predefinedValues, predefinedValueTitles, ['tahkikat konu', 'tahkikat konusu']),
    [predefinedValues, predefinedValueTitles]
  )
  const useCashStageOptions = isCashStageContext && cashStageOptions.length > 0
  const useCashPeriodOptions = isCashStageContext && cashPeriodOptions.length > 0
  const useCashLabelOptions = isCashStageContext && cashLabelOptions.length > 0
  const cashAmountOptions = useMemo(() => {
    if (!isCashStageContext) return []
    if (filterValueOptions.miktar?.length) return filterValueOptions.miktar

    return Array.from(new Set(
      data
        .map((row) => String(row.miktar ?? '').trim())
        .filter(Boolean),
    )).map((value) => ({ value, label: value, count: 0 }))
  }, [data, filterValueOptions.miktar, isCashStageContext])

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAllFilteredSelectedScope('')
    router.push(buildPageUrl(routePath, searchParams, 1, searchInput))
  }

  useEffect(() => {
    if (!contextMenuPosition) return

    const closeContextMenu = () => setContextMenuPosition(null)
    window.addEventListener('click', closeContextMenu)
    window.addEventListener('keydown', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)

    return () => {
      window.removeEventListener('click', closeContextMenu)
      window.removeEventListener('keydown', closeContextMenu)
      window.removeEventListener('scroll', closeContextMenu, true)
    }
  }, [contextMenuPosition])

  useEffect(() => {
    if (!isCashStageContext && !investigationReportConfig) return

    let isCancelled = false

    const loadPredefinedValues = async () => {
      try {
        const response = await fetch('/api/predefined-values')
        const payload = (await response.json()) as PredefinedValuesResponse

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Hazir degerler alinamadi.')
        }

        if (!isCancelled) {
          setPredefinedValues(payload.data.values)
          setPredefinedValueTitles(payload.data.titles)
        }
      } catch {
        if (!isCancelled) {
          setPredefinedValues(DEFAULT_PREDEFINED_VALUES)
          setPredefinedValueTitles(DEFAULT_PREDEFINED_VALUE_TITLES)
        }
      }
    }

    loadPredefinedValues()

    return () => {
      isCancelled = true
    }
  }, [investigationReportConfig, isCashStageContext])

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasContextActions) return

    event.preventDefault()
    const margin = 8
    setContextMenuPosition({
      x: Math.min(event.clientX, window.innerWidth - 352 - margin),
      y: Math.min(event.clientY, window.innerHeight - margin),
    })
  }

  const closeContextMenu = () => setContextMenuPosition(null)

  // Kullanici istegi: menu ekran altinda/yaninda kaliyordu - eski kod sabit
  // bir "520px" tahmini kullaniyordu ama gercek menu yuksekligi, kac tane
  // context-islem butonu (personnelAssignConfig, copyConfig, transferConfig
  // vb.) aktif oldugunA gore DEGISIYOR. Menu DOM'a eklendikten hemen sonra,
  // TARAYICI BOYAMADAN once GERCEK olculen boyutla yeniden konumlanir.
  useLayoutEffect(() => {
    if (!contextMenuPosition || !contextMenuRef.current) return
    const margin = 8
    const rect = contextMenuRef.current.getBoundingClientRect()
    const nextX = Math.max(margin, Math.min(contextMenuPosition.x, window.innerWidth - rect.width - margin))
    const nextY = Math.max(margin, Math.min(contextMenuPosition.y, window.innerHeight - rect.height - margin))
    if (nextX !== contextMenuPosition.x || nextY !== contextMenuPosition.y) {
      setContextMenuPosition({ x: nextX, y: nextY })
    }
  }, [contextMenuPosition])

  const refreshPage = () => {
    setRefreshing(true)
    if (onRefresh) {
      onRefresh()
    } else {
      router.refresh()
    }
    window.setTimeout(() => setRefreshing(false), 600)
  }

  const openRowDocument = (row: Record<string, unknown>) => {
    const fileId = row.dosyaid || row.dosyaId
    const fileNo = row.dosyano || row.dosyaNo

    if (fileId) {
      router.push(`/documents?fileId=${encodeURIComponent(String(fileId))}`)
      return
    }

    if (fileNo) {
      router.push(`/documents/all?search=${encodeURIComponent(String(fileNo))}`)
    }
  }

  const openSelectedDocument = () => {
    if (selectedRows.length !== 1) return
    openRowDocument(selectedRows[0])
  }

  const handleRowDoubleClick = (row: Record<string, unknown>) => {
    if (onlineApplicationEditConfig) {
      openOnlineApplicationEditModal(row)
      return
    }

    // Kullanici istegi: Nakit Yardimi muracaatlarindan HENUZ hicbir dosyaya
    // baglanmamis olanlarda (dosyaid VE dosyano ikisi de yok - ör. Excel ile
    // toplu ice aktarilip TC kimlik numarasi hicbir dosyayla eslesmemis
    // kayitlar) cift tiklaninca acilacak bir dosya olmadigi icin eskiden
    // HICBIR SEY olmuyordu. Bu durumda dosya yerine muracaatin KENDI
    // icerigini goruntuleyip guncelleyebilecegimiz bir pencere acilir.
    const fileId = row.dosyaid || row.dosyaId
    const fileNo = row.dosyano || row.dosyaNo
    if (!fileId && !fileNo && isCashStageContext) {
      openNoFileCashApplicationEditModal(row)
      return
    }

    openRowDocument(row)
  }

  const getSelectedIds = () => selectedRows
    .map((row) => row.id)
    .filter((id): id is string | number | bigint => typeof id === 'string' || typeof id === 'number' || typeof id === 'bigint')
    .map((id) => String(id))

  const exportSelectedRows = () => {
    if (selectedRows.length === 0) return
    downloadXlsx(toXlsxRows(selectedRows), `secili-${exportFilePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`, title)
  }

  const [isExportingAllRows, setIsExportingAllRows] = useState(false)

  const exportListedRows = async () => {
    if (totalCount === 0) return

    if (!exportEndpoint) {
      downloadXlsx(toXlsxRows(data), `tum-${exportFilePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`, title)
      return
    }

    setIsExportingAllRows(true)
    try {
      const query = new URLSearchParams(searchParams.toString())
      query.delete('page')
      if (searchTerm.trim()) query.set('search', searchTerm.trim())
      const separator = exportEndpoint.includes('?') ? '&' : '?'
      const response = await fetch(`${exportEndpoint}${separator}${query.toString()}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Kayıtlar dışa aktarılamadı.')
      }
      downloadXlsx(toXlsxRows(payload.data), `tum-${exportFilePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`, title)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Kayıtlar dışa aktarılamadı.')
    } finally {
      setIsExportingAllRows(false)
    }
  }

  // "Tüm Kayıtları XLSX Aktar" ile AYNI sorgu mantığı (aktif arama/filtreyle
  // birlikte exportEndpoint'ten TÜM eşleşen kayıtları çeker) - Rapor Oluştur
  // penceresinin 'all' ve (filtrelenen-tümü-seçili durumundaki) 'selected'
  // kapsamları bunu paylaşır.
  const fetchAllFilteredReportRows = async (): Promise<ReportRow[]> => {
    if (!exportEndpoint) return data as ReportRow[]

    const query = new URLSearchParams(searchParams.toString())
    query.delete('page')
    if (searchTerm.trim()) query.set('search', searchTerm.trim())
    const separator = exportEndpoint.includes('?') ? '&' : '?'
    const response = await fetch(`${exportEndpoint}${separator}${query.toString()}`, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
      throw new Error(payload.error || 'Kayıtlar alınamadı.')
    }
    return payload.data as ReportRow[]
  }

  const reportColumns = useMemo(
    () => getColumnsFromData(data, excludedColumns).map((key) => ({
      key,
      label: columnLabels[key] || key.replaceAll('_', ' ').toLocaleUpperCase('tr-TR'),
    })),
    [data, excludedColumns, columnLabels],
  )

  // Kullanici istegi: rapor basliklarindan birine gore GRUPLAMA - ör. "Dosyano"
  // secilirse, ayni dosya numarasina ait TÜM kayitlar (sadece o an ekrandaki
  // sayfa degil, aktif arama/filtreyle eslesen TÜM sonuclar) tek bir acilir/
  // kapanir baslik altinda toplanip kac kayit oldugu gosterilir. Dogru sayim
  // icin "Tüm Kayıtları XLSX Aktar" ile AYNI mekanizma (fetchAllFilteredReportRows)
  // kullanilir - export ucu tanimli degilse o fonksiyon zaten SADECE bu
  // sayfadaki kayitlara geriler (bkz. yukarida).
  const [groupByColumn, setGroupByColumn] = useState('')
  const [groupSourceRows, setGroupSourceRows] = useState<Record<string, unknown>[] | null>(null)
  const [isLoadingGroups, setIsLoadingGroups] = useState(false)
  const [groupsError, setGroupsError] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // Kullanici istegi: gruplama yapildiginda gruplar, grup icindeki kayit
  // SAYISINA gore (kucukten buyuge / buyukten kucuge) de siralanabilsin -
  // varsayilan (label) grup basligina (ör. dosya no) gore alfabetik/sayisal
  // siralamayi korur.
  const [groupSortMode, setGroupSortMode] = useState<'label' | 'count-asc' | 'count-desc' | 'sum-asc' | 'sum-desc'>('label')

  useEffect(() => {
    if (!groupByColumn) {
      setGroupSourceRows(null)
      setGroupsError('')
      return
    }

    let isCancelled = false
    setIsLoadingGroups(true)
    setGroupsError('')
    setExpandedGroups(new Set())

    fetchAllFilteredReportRows()
      .then((rows) => {
        if (!isCancelled) setGroupSourceRows(rows)
      })
      .catch((error) => {
        if (!isCancelled) setGroupsError(error instanceof Error ? error.message : 'Kayıtlar alınamadı.')
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingGroups(false)
      })

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupByColumn, searchTerm, filterSignature])

  const reportScopes = [
    { value: 'page', label: 'Bu sayfadaki sonuçlar', count: data.length },
    { value: 'all', label: 'Filtrelenen tüm kayıtlar', count: totalCount },
    { value: 'selected', label: 'Seçili kayıtlar', count: selectedDisplayCount },
  ]

  const fetchReportRows = async (scope: string): Promise<ReportRow[]> => {
    if (scope === 'page') return data as ReportRow[]
    if (scope === 'selected' && !allFilteredSelected) return selectedRows as ReportRow[]
    return fetchAllFilteredReportRows()
  }

  // AdvancedTable ekranda "durumu"/"yardim_durumu" gibi sutunlari statusMap
  // uzerinden okunabilir etikete ceviriyor (bkz. asagidaki AdvancedTable
  // cagrisindaki assistanceStatusColumns) - rapor da ayni ham kod yerine
  // ayni etiketi gostermeli. Medeni hal/cinsiyet/yakinlik gibi diger ozel
  // sutunlar AdvancedTable icinde KENDI ic API cagrisiyla cozuluyor (bu
  // bilesenin props'unda yok) - bu yuzden burada KASITLI OLARAK kapsam disi
  // birakildi; Yardimlar raporlarinda en onemli ozel alan yardim durumu.
  const REPORT_ASSISTANCE_STATUS_COLUMNS = new Set(['durumu', 'yardim_durumu', 'assistanceStatus', 'yardimDurumu', 'ydurumu'])

  const resolveReportCellValue = (columnKey: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return value
    if (REPORT_ASSISTANCE_STATUS_COLUMNS.has(columnKey)) return statusMap[String(value)] ?? value
    if (columnKey === 'dosyaNo' || columnKey === 'dosyano') return formatFileNo(value)
    if (isDateField(columnKey)) return formatDate(value)
    return value
  }

  const groupColumnLabel = reportColumns.find((column) => column.key === groupByColumn)?.label || groupByColumn

  const groupedSections = useMemo(() => {
    if (!groupByColumn || !groupSourceRows) return null

    const map = new Map<string, Record<string, unknown>[]>()
    for (const row of groupSourceRows) {
      const rawValue = row[groupByColumn] as string | number | null | undefined
      const resolved = resolveReportCellValue(groupByColumn, rawValue)
      const label = resolved === null || resolved === undefined || resolved === '' ? '(Boş)' : String(resolved)
      const list = map.get(label) ?? []
      list.push(row)
      map.set(label, list)
    }

    // Kullanici istegi (2026-10-07): gruplar "kayit sayisina" ek olarak
    // "toplam miktara" gore de siralanabilsin (ör. Diger Kurumlar raporunda
    // "bu dosyaya toplamda ne kadar giriyor" gorulsun) - miktar/tutar
    // tasiyan olasi sutun adlari denenir (rapor tablolarinda tutarli
    // degil), DB'den gelen ham sayisal deger dogrudan toplanir (ekranda
    // GOSTERILEN Turkce bicimli metin DEGIL - bu yuzden virgul/nokta
    // locale ayristirmasina gerek yok).
    const AMOUNT_FIELD_CANDIDATES = ['miktar', 'Miktar', 'amount', 'tutar']
    const findRowAmount = (row: Record<string, unknown>) => {
      for (const key of AMOUNT_FIELD_CANDIDATES) {
        const value = row[key]
        if (value === null || value === undefined || value === '' || value === '-') continue
        const num = Number(value)
        if (Number.isFinite(num)) return num
      }
      return 0
    }

    const sections = Array.from(map.entries())
      .map(([label, rows]) => ({
        label,
        rows,
        count: rows.length,
        sum: rows.reduce((acc, row) => acc + findRowAmount(row), 0),
      }))

    if (groupSortMode === 'count-asc') return sections.sort((a, b) => a.count - b.count)
    if (groupSortMode === 'count-desc') return sections.sort((a, b) => b.count - a.count)
    if (groupSortMode === 'sum-asc') return sections.sort((a, b) => a.sum - b.sum)
    if (groupSortMode === 'sum-desc') return sections.sort((a, b) => b.sum - a.sum)
    return sections.sort((a, b) => a.label.localeCompare(b.label, 'tr-TR', { numeric: true }))
  }, [groupByColumn, groupSourceRows, groupSortMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroupExpanded = (label: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const displayDateToInputDate = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text || text === '-') return ''
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
    const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
  }

  const cleanRowValue = (row: Record<string, unknown>, key: string) => {
    const value = row[key]
    if (value === null || value === undefined || value === '-') return ''
    return String(value)
  }

  const cleanFirstRowValue = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = cleanRowValue(row, key)
      if (value) return value
    }
    return ''
  }

  // Bu bilesen (ManagedReportTablePage) Yardimlar VE Talepler/Muracaatlar
  // modullerindeki BIRCOK farkli alt tabloyu (ekmek, gida, giyim, destek
  // paketi, nakit, donem-disi vb.) tek bir generic yapiyla besledigi icin,
  // her tablonun telefon kolon adi AYNI degil - bazilarinda "dosya_telefonu"
  // (dosyalar.telefon), bazilarinda "ceptel" (kisinin kendi cep telefonu),
  // bazilarinda ("Donem Disi Gida" gibi dosyasiz muracaatlarda) HEM "ceptel"
  // HEM AYRICA "mur_telefon" (muracaat sirasinda verilen telefon) birlikte
  // bulunabiliyor. Bu yuzden ilk DOLU alan degil, ilk GECERLI (WhatsApp
  // formatina cevrilebilen) alan kullanilir - bir alan bos/hatali ama
  // digeri gecerliyse, gecerli olan otomatik secilir. Sayfa `phoneFieldPriority`
  // gonderdiyse (ör. Nakit Yardimlari - "muracaat sirasinda verilen telefon"
  // dosyanin genel telefonundan ONCELIKLI olmali) o siralama kullanilir.
  const PHONE_FIELD_CANDIDATES = phoneFieldPriority && phoneFieldPriority.length > 0
    ? phoneFieldPriority
    : ['dosya_telefonu', 'ceptel', 'mur_telefon', 'telefon', 'cep_telefon', 'cepTelefon', 'phone', 'gsm']
  const pickValidPhone = (row: Record<string, unknown>) => {
    for (const key of PHONE_FIELD_CANDIDATES) {
      const value = cleanRowValue(row, key)
      if (value && normalizeWhatsappPhoneNumber(value)) return value
    }
    // Hicbir aday GECERLI degilse, en azindan ilk DOLU degeri goster (kullanici
    // neden atlandigini gorebilsin) - toplu gonderim modali bunu yine de
    // gecersiz sayip atlayacaktir.
    return cleanFirstRowValue(row, PHONE_FIELD_CANDIDATES) || null
  }

  // Toplu WhatsApp mesajindaki "(isim)", "(telefon)", "(iban)",
  // "(ebaşlangıç)"/"(abaşlangıç)" gibi kisayollarin BU SATIR icin gercek
  // degerlerini uretir (bkz. lib/messageTemplateTokens.ts). Bu bilesen
  // (ManagedReportTablePage) COK FARKLI tablolarda (ekmek, gida, nakit vb.)
  // kullanildigi ve hangi tabloyu gosterdigini kendisi bilmedigi icin:
  // - "e-" (ekmek) tarih tokenlari HER ZAMAN bastarih/bittarih'ten gelir
  //   (Ekmek Yardimi'nin kendi donem araligi - "gun kisitlamasi" kavrami yok).
  // - "a-" (alisveris/Gıda Bankası-Destek Paketi) tarih tokenlari ONCE
  //   mahalle bazli GERCEK "Ödeme Günü" penceresini tasiyan kolonlari
  //   (odeme_baslangic/odeme_bitis, paymentStartDate/paymentEndDate - bkz.
  //   app/api/documents/fetch/route.ts) arar; sayfanin sorgusunda bu
  //   kolonlar YOKSA (cogu rapor sayfasi bunu ayrica hesaplamiyor) donem
  //   araligina (bastarih/bittarih) geriler - "hic bilgi olmamasindan"
  //   daha iyi bir en yakin tahmindir.
  // iban SADECE Nakit Yardimlari gibi iban kolonu olan tablolarda dolu
  // gelir, digerlerinde "-" olarak gonderilir.
  const buildRecipientTokens = (row: Record<string, unknown>): MessageTemplateTokenValues => {
    const formatIfPresent = (raw: unknown) => {
      if (raw === null || raw === undefined || raw === '') return null
      const formatted = formatDate(raw)
      return formatted && formatted !== '-' ? formatted : null
    }

    const periodStart = formatIfPresent(row['bastarih'] ?? row['baslangic_tarihi'] ?? row['baslangicTarihi'] ?? null)
    const periodEnd = formatIfPresent(row['bittarih'] ?? row['bitis_tarihi'] ?? row['bitisTarihi'] ?? null)

    const paymentStart = formatIfPresent(row['odeme_baslangic'] ?? row['paymentStartDate'] ?? row['payment_start'] ?? null) ?? periodStart
    const paymentEnd = formatIfPresent(row['odeme_bitis'] ?? row['paymentEndDate'] ?? row['payment_end'] ?? null) ?? periodEnd

    const ibanValue = cleanFirstRowValue(row, ['iban']) || null
    const dosyanoValue = cleanFirstRowValue(row, ['dosyano', 'dosyaNo', 'dosya_no']) || null

    return {
      // "muracaateden" - yrd_ekmek/yrd_gidabankasi/yrd_destekpaketi/
      // yrd_ayninakti gibi COGU yardim tablosunda basvuru sahibinin adi
      // soyadinin GERCEK kolon adi budur - digerleri (ad_soyad vb.) baska
      // ozel sorgularda kullanilan takma adlardir, ikisi de denenir.
      isim: cleanFirstRowValue(row, ['ad_soyad', 'adSoyad', 'dosya_sahibi', 'kisi_adi', 'adi_soyadi', 'ad', 'isim', 'muracaateden']) || null,
      telefon: pickValidPhone(row),
      dosyano: dosyanoValue,
      iban: ibanValue,
      ebaslangic: periodStart,
      ebitis: periodEnd,
      ebaslangicbitis: combineDateRange(periodStart, periodEnd),
      abaslangic: paymentStart,
      abitis: paymentEnd,
      abaslangicbitis: combineDateRange(paymentStart, paymentEnd),
    }
  }

  // Baska bir SAYFAdaki secimler, o an data icinde GORUNMEDIGI icin
  // selectedRows'ta kaybolurdu - kullanici istegi: "50 kişiyi seçip
  // sonraki sayfaya geçtiğimde oradan da istediğim kadar seçebileyim, bunu
  // tüm sayfalarda yapabileyim" - artik SADECE toplu WhatsApp icin degil,
  // "Seçilenleri XLSX Aktar"/"Toplu Güncelle" gibi TUM "secili kayitlar"
  // islemleri icin de gecerli: her secilen kaydin TAM satir verisi ilk
  // secildigi anda (o an data icinde varken) bu onbellege kaydedilip baska
  // sayfaya/filtreye gecilse bile saklanir - bkz. asagidaki selectedRows.
  useEffect(() => {
    setBulkRecipientCache((prev) => {
      const next: Record<string, BulkRecipientCacheEntry> = {}
      selectedRowIds.forEach((id) => {
        if (prev[id]) {
          next[id] = prev[id]
          return
        }
        const row = data.find((candidate) => candidate.id && String(candidate.id) === id)
        if (row) {
          next[id] = {
            id,
            phone: pickValidPhone(row),
            label: cleanFirstRowValue(row, ['ad_soyad', 'adSoyad', 'dosya_sahibi', 'kisi_adi', 'adi_soyadi', 'ad', 'isim']) || null,
            tokens: buildRecipientTokens(row),
            // "dosyaid" cogu yardim tablosunda dosyalar'a FK olan HAM kolon
            // adidir (t.* ile gelir) - Dosyalar/Bireyler listelerinde ise
            // dogrudan "dosyaId" (API'nin kendi takma adi) kullanilir.
            dosyaNo: cleanFirstRowValue(row, ['dosyano', 'dosyaNo', 'dosya_no']) || null,
            dosyaId: cleanFirstRowValue(row, ['dosyaid', 'dosyaId', 'dosya_id']) || null,
            row,
          }
        }
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowIds, data])

  // Kullanici istegi: "Filtrelenen Tümünü Seç" ile TÜM sayfalardaki eslesen
  // kayitlara toplu WhatsApp gonderebilmek - bulkRecipientCache SADECE o an
  // ekranda gorunen (tek sayfalik) data'dan besleniyor, digerlerine erisemez.
  // bulkWhatsappAllFilteredConfig verilmisse ve "Filtrelenen Tümünü Seç"
  // aktifse, sunucudan (AYNI filtre/arama kosullariyla) TÜM eslesen
  // kayitlarin alici bilgisi cekilir.
  const [allFilteredWhatsappRecipients, setAllFilteredWhatsappRecipients] = useState<BulkRecipientCacheEntry[] | null>(null)
  const [isLoadingAllFilteredWhatsapp, setIsLoadingAllFilteredWhatsapp] = useState(false)

  useEffect(() => {
    if (!bulkWhatsappAllFilteredConfig || !allFilteredSelected) {
      setAllFilteredWhatsappRecipients(null)
      return
    }

    let isCancelled = false
    setIsLoadingAllFilteredWhatsapp(true)

    const filters: Record<string, string> = {}
    searchParams.forEach((value, key) => { filters[key] = value })
    if (searchTerm.trim()) filters.search = searchTerm.trim()

    fetch(bulkWhatsappAllFilteredConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: bulkWhatsappAllFilteredConfig.tableName, whereClause: bulkWhatsappAllFilteredConfig.whereClause, filters }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (isCancelled) return
        if (payload?.success && Array.isArray(payload.data)) {
          setAllFilteredWhatsappRecipients(payload.data)
        } else {
          setAllFilteredWhatsappRecipients([])
        }
      })
      .catch(() => {
        if (!isCancelled) setAllFilteredWhatsappRecipients([])
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingAllFilteredWhatsapp(false)
      })

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFilteredSelected, bulkWhatsappAllFilteredConfig, searchParams, searchTerm])

  const bulkWhatsappRecipients = allFilteredSelected && allFilteredWhatsappRecipients
    ? allFilteredWhatsappRecipients
    : selectedRowIds
        .map((id) => bulkRecipientCache[id])
        .filter((entry): entry is BulkRecipientCacheEntry => Boolean(entry))

  const getActiveFilterValue = (key: string) => {
    const value = searchParams.get(`f_${key}`) || searchParams.get(key) || ''
    return value === '-' ? '' : value.trim()
  }

  const updateBulkProgress = (label: string, total: number, completed: number) => {
    setBulkProgress({
      label,
      total,
      completed,
      remaining: Math.max(total - completed, 0),
    })
  }

  const openOnlineApplicationEditModal = (row: Record<string, unknown>) => {
    if (!onlineApplicationEditConfig) return

    const id = cleanRowValue(row, 'id')
    if (!id) {
      setActionStatus('Duzenlenecek basvuru id bilgisi bulunamadi.')
      return
    }

    setOnlineEditForm({
      id,
      tc: cleanRowValue(row, 'tc'),
      fullName: cleanRowValue(row, 'ad_soyad'),
      birthDate: displayDateToInputDate(row.dogum_tarihi),
      phone: cleanRowValue(row, 'telefon'),
      iban: cleanRowValue(row, 'iban'),
      income: cleanRowValue(row, 'aylik_gelir'),
      vehicleStatus: cleanRowValue(row, 'arac_durumu'),
      vehicleModelYear: cleanRowValue(row, 'arac_modeli'),
      assistanceType: cleanRowValue(row, 'yardim_turu'),
      amount: cleanFirstRowValue(row, ['miktar', 'Miktar', 'amount', 'tutar']),
      neighborhood: cleanRowValue(row, 'mahalle'),
      address: cleanRowValue(row, 'adres'),
      status: cleanRowValue(row, 'durum'),
      period: cleanFirstRowValue(row, ['donem', 'Dönem', 'Donem', 'period']) || getActiveFilterValue('donem'),
      label: cleanFirstRowValue(row, ['etiket', 'Etiket', 'label']) || getActiveFilterValue('etiket'),
      stage: cleanFirstRowValue(row, ['asama', 'Aşama', 'Asama', 'stage']) || getActiveFilterValue('asama'),
      description: cleanRowValue(row, 'aciklama'),
    })
    setActionStatus('')
    setOnlineEditModalOpen(true)
  }

  const saveOnlineApplicationEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onlineApplicationEditConfig) return

    setIsSavingOnlineEdit(true)
    setActionStatus('')

    try {
      const response = await fetch(onlineApplicationEditConfig.endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...onlineEditForm,
          period: onlineEditForm.period.trim(),
          label: onlineEditForm.label.trim(),
          stage: onlineEditForm.stage.trim(),
          amount: onlineEditForm.amount.trim(),
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Basvuru guncellenemedi.')
      }

      setActionStatus('Basvuru bilgileri guncellendi.')
      setOnlineEditModalOpen(false)
      setSelectedRowIds([])
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Basvuru guncellenemedi.')
    } finally {
      setIsSavingOnlineEdit(false)
    }
  }

  // Kullanici istegi: dosyasi olmayan (dosyaid IS NULL) Nakit Yardimi
  // muracaatlarina cift tiklaninca acilacak bir dosya olmadigi icin eskiden
  // hicbir sey olmuyordu - bkz. handleRowDoubleClick. Bu form muracaatin
  // KENDI verisini (satirda zaten mevcut, ekstra sorgu gerekmez - bkz.
  // "t.*" ile cekilen dataQuery) dosya baglami olmadan gosterip
  // guncelleyebilir.
  const openNoFileCashApplicationEditModal = (row: Record<string, unknown>) => {
    const id = cleanRowValue(row, 'id')
    if (!id) {
      setActionStatus('Düzenlenecek müracaat id bilgisi bulunamadı.')
      return
    }

    setNoFileEditForm({
      id,
      tc: cleanRowValue(row, 'tckimlikno'),
      fullName: cleanRowValue(row, 'muracaateden'),
      birthDate: displayDateToInputDate(row.dogumtarihi),
      phone: cleanRowValue(row, 'ceptel'),
      iban: cleanRowValue(row, 'iban'),
      income: cleanRowValue(row, 'aylikgelir'),
      propertyInfo: cleanRowValue(row, 'mulkiyetbilgisi'),
      vehicleInfo: cleanRowValue(row, 'aracbilgisi'),
      applicationDate: displayDateToInputDate(row.muracaattarihi),
      period: cleanRowValue(row, 'donem'),
      label: cleanRowValue(row, 'etiket'),
      amount: cleanRowValue(row, 'miktar'),
      description: cleanRowValue(row, 'muracaatnotu'),
      stage: cleanRowValue(row, 'asama'),
      stageDescription: cleanRowValue(row, 'asamanotu'),
      stageCode: cleanRowValue(row, 'asamaozelkod'),
      specialCode: cleanRowValue(row, 'muracaatozelkod'),
      hasFile: Boolean(row.dosyaid || row.dosyaId),
    })
    setNoFileEditStatus('')
    setNoFileEditModalOpen(true)
  }

  const saveNoFileCashApplicationEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setIsSavingNoFileEdit(true)
    setNoFileEditStatus('')

    try {
      // Kullanici istegi (2026-09-22): "Müracaatı Aç" butonu artik dosyaya
      // BAGLI kayitlari da acabiliyor - o kayitlar icin eski uc nokta
      // (no-file-update) BILEREK calismaz ("AND dosyaid IS NULL" guvenlik
      // siniri, bkz. o route'daki aciklama), bu yuzden dosyaya bagli
      // kayitlar icin bu kisitlamayi TASIMAYAN ayri bir uc nokta
      // (record-update) kullanilir.
      const endpoint = noFileEditForm.hasFile
        ? '/api/assistance/nakit/record-update'
        : '/api/assistance/nakit/no-file-update'
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noFileEditForm),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Müracaat güncellenemedi.')
      }

      setNoFileEditModalOpen(false)
      setActionStatus('Müracaat bilgileri güncellendi.')
      router.refresh()
    } catch (error) {
      setNoFileEditStatus(error instanceof Error ? error.message : 'Müracaat güncellenemedi.')
    } finally {
      setIsSavingNoFileEdit(false)
    }
  }

  const openPersonnelModal = async () => {
    if (!personnelAssignConfig || selectedRows.length === 0 || allFilteredSelected) return

    const ids = getSelectedIds()
    if (ids.length === 0) {
      setActionStatus('Personel atanacak kayit id bilgisi bulunamadi.')
      return
    }

    setPersonnelModalOpen(true)
    setSelectedPersonnel('')
    setActionStatus('')

    await loadPersonnelOptions(true)
  }

  const loadPersonnelOptions = async (closePersonnelModalOnError = false) => {
    if (personnelOptions.length > 0) return true

    setPersonnelLoading(true)
    try {
      const response = await fetch('/api/users?limit=1000')
      const payload = await response.json()

      if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Personel listesi alinamadi.')
      }

      setPersonnelOptions(
        payload.data
          .map((user: Record<string, unknown>) => ({
            id: String(user.id || ''),
            name: String(user.name || user.kullanicitamadi || user.username || '').trim(),
            username: user.username ? String(user.username) : null,
          }))
          .filter((user: PersonnelOption) => user.id && user.name),
      )
      return true
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Personel listesi alinamadi.')
      if (closePersonnelModalOnError) setPersonnelModalOpen(false)
      return false
    } finally {
      setPersonnelLoading(false)
    }
  }

  const assignPersonnel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!personnelAssignConfig || selectedRows.length === 0) return

    const ids = getSelectedIds()
    if (ids.length === 0) {
      setActionStatus('Personel atanacak kayit id bilgisi bulunamadi.')
      return
    }

    if (!selectedPersonnel.trim()) {
      setActionStatus('Personel secimi zorunludur.')
      return
    }

    setIsAssigningPersonnel(true)
    setActionStatus('')

    try {
      const response = await fetch(personnelAssignConfig.endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, personnel: selectedPersonnel.trim() }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Personel atanamadi.')
      }

      setActionStatus(`${payload.data?.updated || 0} kayda personel atandi.`)
      setSelectedRowIds([])
      setPersonnelModalOpen(false)
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Personel atanamadi.')
    } finally {
      setIsAssigningPersonnel(false)
    }
  }

  const openCopyModal = () => {
    if (!copyConfig || totalCount === 0) return

    setCopyMode(selectedRows.length > 0 && !allFilteredSelected ? 'selected' : 'filtered')
    setCopyForm({ donem: '', etiket: '', asama: '', durumu: '' })
    setActionStatus('')
    setCopyModalOpen(true)
  }

  const copyRecords = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!copyConfig) return

    const mode = allFilteredSelected || selectedRows.length === 0 ? 'filtered' : copyMode
    const ids = mode === 'selected' ? getSelectedIds() : []

    if (mode === 'selected' && ids.length === 0) {
      setActionStatus('Kopyalanacak kayit id bilgisi bulunamadi.')
      return
    }

    if (!copyForm.donem.trim() || !copyForm.etiket.trim() || !copyForm.asama.trim() || !copyForm.durumu.trim()) {
      setActionStatus('Donem, Etiket, Asama ve Durum alanlari zorunludur.')
      return
    }

    const statusValue = Number(copyForm.durumu)
    if (!Number.isInteger(statusValue)) {
      setActionStatus('Durum bilgisi sayisal olmalidir.')
      return
    }

    const filters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      filters[key] = value
    })
    if (searchTerm.trim()) filters.search = searchTerm.trim()

    setIsCopying(true)
    setActionStatus('')

    try {
      const response = await fetch(copyConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          ids,
          filters,
          sourceStatus: copyConfig.sourceStatus,
          changes: {
            donem: copyForm.donem.trim(),
            etiket: copyForm.etiket.trim(),
            asama: copyForm.asama.trim(),
            durumu: statusValue,
          },
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayitlar kopyalanamadi.')
      }

      setActionStatus(`${payload.data?.copied || 0} kayit kopyalandi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      setCopyModalOpen(false)
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Kayitlar kopyalanamadi.')
    } finally {
      setIsCopying(false)
    }
  }

  const openInvestigationReportModal = () => {
    if (!investigationReportConfig || totalCount === 0) return

    setInvestigationReportMode(allFilteredSelected || selectedRows.length === 0 ? 'filtered' : 'selected')
    setInvestigationReportForm({
      date: new Date().toISOString().slice(0, 10),
      title: '',
      content: '',
    })
    setActionStatus('')
    setInvestigationReportModalOpen(true)
  }

  const saveInvestigationReports = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!investigationReportConfig) return

    const mode = allFilteredSelected || selectedRows.length === 0 ? 'filtered' : investigationReportMode
    const ids = mode === 'selected' ? getSelectedIds() : []

    if (mode === 'selected' && ids.length === 0) {
      setActionStatus('Tahkikat raporu eklenecek kayit id bilgisi bulunamadi.')
      return
    }

    if (!investigationReportForm.date || !investigationReportForm.title.trim() || !investigationReportForm.content.trim()) {
      setActionStatus('Tarih, konu ve aciklama alanlari zorunludur.')
      return
    }

    const filters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      filters[key] = value
    })
    if (searchTerm.trim()) filters.search = searchTerm.trim()

    setIsSavingInvestigationReport(true)
    setActionStatus('')

    try {
      const response = await fetch(investigationReportConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          ids,
          filters,
          report: {
            date: investigationReportForm.date,
            title: investigationReportForm.title.trim(),
            content: investigationReportForm.content.trim(),
          },
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Tahkikat raporu eklenemedi.')
      }

      setActionStatus(`${payload.data?.inserted || 0} tahkikat raporu eklendi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      setInvestigationReportModalOpen(false)
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Tahkikat raporu eklenemedi.')
    } finally {
      setIsSavingInvestigationReport(false)
    }
  }

  const openRecordUpdateModal = () => {
    if (!recordUpdateConfig || totalCount === 0 || (selectedRows.length === 0 && !allFilteredSelected)) return

    const selectedRow = selectedRows.length === 1 ? selectedRows[0] : null
    setRecordUpdateForm({
      durumu: selectedRow?.durumu === null || selectedRow?.durumu === undefined ? '' : String(selectedRow.durumu),
      donem: selectedRow?.donem === null || selectedRow?.donem === undefined ? '' : String(selectedRow.donem),
      etiket: selectedRow?.etiket === null || selectedRow?.etiket === undefined ? '' : String(selectedRow.etiket),
      asama: selectedRow?.asama === null || selectedRow?.asama === undefined ? '' : String(selectedRow.asama),
      miktar: selectedRow?.miktar === null || selectedRow?.miktar === undefined ? '' : String(selectedRow.miktar),
      tahkikatpers: selectedRow?.tahkikatpers === null || selectedRow?.tahkikatpers === undefined ? '' : String(selectedRow.tahkikatpers),
      tarih: selectedRow?.tarih === null || selectedRow?.tarih === undefined ? '' : String(selectedRow.tarih).slice(0, 10),
      kurban_turu: selectedRow?.kurban_turu === null || selectedRow?.kurban_turu === undefined ? '' : String(selectedRow.kurban_turu),
      kurban_cinsi: selectedRow?.kurban_cinsi === null || selectedRow?.kurban_cinsi === undefined ? '' : String(selectedRow.kurban_cinsi),
      adet: selectedRow?.adet === null || selectedRow?.adet === undefined ? '' : String(selectedRow.adet),
    })
    setActionStatus('')
    setRecordUpdateModalOpen(true)
    if (recordUpdateFields.includes('tahkikatpers')) {
      void loadPersonnelOptions()
    }
  }

  const updateRecordFields = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!recordUpdateConfig) return

    const mode = allFilteredSelected ? 'filtered' : 'selected'
    const ids = mode === 'selected' ? getSelectedIds() : []

    if (mode === 'selected' && ids.length === 0) {
      setActionStatus('Guncellenecek kayit secilmedi.')
      return
    }

    const changes = {
      durumu: recordUpdateForm.durumu.trim(),
      donem: recordUpdateForm.donem.trim(),
      etiket: recordUpdateForm.etiket.trim(),
      asama: recordUpdateForm.asama.trim(),
      miktar: recordUpdateForm.miktar.trim(),
      tahkikatpers: recordUpdateForm.tahkikatpers.trim(),
      tarih: recordUpdateForm.tarih.trim(),
      kurban_turu: recordUpdateForm.kurban_turu.trim(),
      kurban_cinsi: recordUpdateForm.kurban_cinsi.trim(),
      adet: recordUpdateForm.adet.trim(),
    }

    if (!Object.values(changes).some(Boolean)) {
      setActionStatus('Guncellenecek en az bir alan doldurulmalidir.')
      return
    }

    setIsUpdatingRecord(true)
    setActionStatus('')

    const filters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      filters[key] = value
    })
    if (searchTerm.trim()) filters.search = searchTerm.trim()

    try {
      const response = await fetch(recordUpdateConfig.endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          ids,
          filters,
          sourceStatus: recordUpdateConfig.sourceStatus,
          changes,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayit guncellenemedi.')
      }

      setActionStatus(`${payload.data?.updated || 0} kayit guncellendi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      setRecordUpdateModalOpen(false)
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Kayit guncellenemedi.')
    } finally {
      setIsUpdatingRecord(false)
    }
  }

  const transferRecords = async () => {
    if (!transferConfig || totalCount === 0) return

    const mode = allFilteredSelected || selectedRows.length === 0 ? 'filtered' : 'selected'
    const ids = mode === 'selected' ? getSelectedIds() : []

    if (mode === 'selected' && ids.length === 0) {
      setActionStatus('Aktarilacak kayit id bilgisi bulunamadi.')
      return
    }

    if (mode === 'filtered' && !hasActiveFilter) {
      setActionStatus('Filtrelenen kayitlari aktarmak icin once arama veya filtre uygulayin.')
      return
    }

    const transferCount = mode === 'selected' ? ids.length : totalCount
    const confirmed = await confirmDialog(`${transferCount} kayit nakit muracaatlara aktarilacak.\n\nDevam edilsin mi?`)
    if (!confirmed) return

    const filters: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      filters[key] = value
    })
    if (searchTerm.trim()) filters.search = searchTerm.trim()

    setIsTransferring(true)
    setActionStatus('')

    try {
      const response = await fetch(transferConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ids, filters }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayitlar aktarilamadi.')
      }

      const inserted = payload.data?.inserted || 0
      const updated = payload.data?.updated || 0
      const linked = payload.data?.linked || 0
      const skipped = payload.data?.skipped || 0
      const samePeriodDuplicates = payload.data?.samePeriodDuplicates || 0
      const sourceDuplicates = payload.data?.sourceDuplicates || 0
      const deletedFromOnline = payload.data?.deletedFromOnline || 0
      const duplicateMessage = samePeriodDuplicates
        ? ` ${samePeriodDuplicates} kayit ayni TC kimlik no ve ayni donem ile nakit muracaatlarda bulundugu icin aktarilmadi.`
        : ''
      const sourceDuplicateMessage = sourceDuplicates
        ? ` ${sourceDuplicates} kayit secim icinde ayni TC kimlik no ve ayni donem tekrari oldugu icin aktarilmadi.`
        : ''
      // Kullanici istegi (2026-09-28): aktarilan kayitlar online basvuru
      // listesinden de silinir - bu, kullaniciya SUREC SONUNDA acikca
      // bildirilir (sessizce kaybolmus gibi gorunmesin).
      const deletedMessage = deletedFromOnline
        ? ` ${deletedFromOnline} kayit online basvurulardan silindi.`
        : ''
      setActionStatus(`${inserted} kayit aktarildi${updated ? `, ${updated} kayit guncellendi` : ''}. ${linked} kayit dosyaya baglandi${skipped ? `, ${skipped} kayit atlandi` : ''}.${duplicateMessage}${sourceDuplicateMessage}${deletedMessage}`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Kayitlar aktarilamadi.')
    } finally {
      setIsTransferring(false)
    }
  }

  const clearFilters = () => {
    setSearchInput('')
    setSelectedRowIds([])
    setAllFilteredSelectedScope('')
    setActionStatus('')
    router.replace(routePath)
  }

  const applyQuickFilter = (fieldKey: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(`f_${fieldKey}`, value)
      params.set(`f_${fieldKey}_op`, 'eq')
    } else {
      params.delete(`f_${fieldKey}`)
      params.delete(`f_${fieldKey}_op`)
    }
    params.delete(`f_${fieldKey}_v2`)
    params.set('page', '1')
    router.push(`?${params.toString()}`)
  }

  const downloadImportTemplate = () => {
    if (!importConfig || importConfig.columns.length === 0) return
    downloadXlsxTemplate(importConfig.columns, importConfig.templateFileName, importConfig.title)
  }

  const handleImportFile = async (file?: File) => {
    if (!file || !importConfig) return

    setIsImporting(true)
    setActionStatus('')

    try {
      const fileName = file.name.toLocaleLowerCase('tr-TR')
      const rows = fileName.endsWith('.xlsx')
        ? await parseXlsxFile(file)
        : parseCsv(await file.text())

      if (rows.length === 0) {
        throw new Error('Dosyada aktarılacak satır bulunamadı.')
      }

      const response = await fetch(importConfig.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Excel aktarımı yapılamadı.')
      }

      // Kullanici istegi: bazi importConfig uc noktalari (ör. Diğer
      // Kurumlar - TC Kimlik No'ya gore otomatik dosya baglama), dosyasi
      // bulunamayan satir sayisini AYRICA rapor eder - bu alan varsa (ve
      // 0'dan buyukse) sonuc mesajina eklenir; digerlerinde hic
      // gorunmez (backend bu alani hic gondermez).
      const dosyaBulunamayanCount = Number(payload.data?.dosyaBulunamayan || 0)
      setActionStatus(`${payload.data?.inserted || 0} kayıt aktarıldı${payload.data?.skipped ? `, ${payload.data.skipped} satır atlandı` : ''}${dosyaBulunamayanCount > 0 ? `, ${dosyaBulunamayanCount} kayıt için TC Kimlik No ile eşleşen dosya bulunamadı (dosya bağlantısı boş kaydedildi)` : ''}.`)
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Excel aktarımı yapılamadı.')
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const deleteSelectedRows = async () => {
    if (!deleteConfig || selectedRows.length === 0) return

    const ids = getSelectedIds()

    if (ids.length === 0) {
      setActionStatus('Silinecek kayıt id bilgisi bulunamadı.')
      return
    }

    const confirmed = await confirmDialog(`${ids.length} kayıt silinecek.\n\nSeçili kayıt sayısı: ${selectedRows.length}\nSilinecek kayıt sayısı: ${ids.length}\n\nDevam edilsin mi?`)
    if (!confirmed) return

    setIsDeleting(true)
    setActionStatus('')
    setBulkProgress(null)

    try {
      let deleted = 0
      updateBulkProgress('Kayitlar siliniyor', ids.length, 0)

      for (let index = 0; index < ids.length; index += BULK_PROGRESS_BATCH_SIZE) {
        const chunk = ids.slice(index, index + BULK_PROGRESS_BATCH_SIZE)
        const response = await fetch(deleteConfig!.endpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Kayitlar silinemedi.')
        }

        deleted += Number(payload.data?.deleted || 0)
        updateBulkProgress('Kayitlar siliniyor', ids.length, Math.min(index + chunk.length, ids.length))
      }

      setActionStatus(`${deleted} kayit silindi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      router.refresh()
      return

      const response = await fetch(deleteConfig!.endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıtlar silinemedi.')
      }

      setActionStatus(`${payload.data?.deleted || 0} kayıt silindi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Kayıtlar silinemedi.')
    } finally {
      setIsDeleting(false)
      setBulkProgress(null)
    }
  }

  // Secili (bir ya da birden fazla) satirdaki kisilerin kurumda henuz
  // dosyasi yoksa, sag-tik menusunden hepsine BIRDEN yeni dosya
  // olusturup her birini kendi kaydina baglar. ONEMLI: istekler
  // SIRAYLA (paralel DEGIL) gonderilir - sunucu tarafi (createFileConfig.endpoint)
  // "siradaki dosya numarasi" hesabini her cagrida "MAX(dosyano)+1" ile
  // yapar; ayni anda birden fazla istek gonderilirse ikisi de AYNI numarayi
  // hesaplayip cakisabilirdi. Sirali/beklemeli calisma, her dosyanin
  // GERCEKTEN artan/sirali numara almasini garanti eder (kullanicinin
  // acikca istedigi "sirasiyla ve siradaki dosya numarasini vererek" budur).
  // Dosya sahibi her seferinde "tipi=1 / yakinligi=kendisi" olarak yazilir
  // (bkz. Nakit Muracaatlari, app/api/assistance/nakit/create-file/route.ts).
  const createFilesForSelectedRows = async () => {
    if (!createFileConfig || selectedRows.length === 0) return

    const rows = selectedRows.filter((row) => {
      const recordId = row.id
      return recordId !== undefined && recordId !== null && recordId !== ''
    })

    if (rows.length === 0) {
      setActionStatus('Kayıt id bilgisi bulunamadı.')
      return
    }

    const confirmed = rows.length === 1
      ? await confirmDialog(`"${String(rows[0].muracaateden || rows[0].adisoyadi || 'seçili kişi')}" için kurumda kayıtlı bir dosya bulunamadı.\n\nYeni bir dosya oluşturulup bu müracaat o dosyaya bağlanacak.\n\nDevam edilsin mi?`)
      : await confirmDialog(`${rows.length} kişi için ayrı ayrı, sırasıyla ve birbirini takip eden dosya numaraları verilerek yeni dosyalar oluşturulacak. Her biri kendi müracaatına bağlanacak.\n\nDevam edilsin mi?`)
    if (!confirmed) return

    setIsCreatingFile(true)
    setActionStatus('')
    updateBulkProgress('Dosyalar oluşturuluyor', rows.length, 0)

    let createdCount = 0
    let skippedCount = 0
    const failedLabels: string[] = []

    try {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const personLabel = String(row.muracaateden || row.adisoyadi || `kayıt ${row.id}`)

        try {
          // await ile TEK TEK, birbirini bekleyerek gonderilir - bkz. yukaridaki not.
          const response = await fetch(createFileConfig.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: String(row.id) }),
          })
          const payload = await response.json()

          if (!response.ok || !payload.success) {
            throw new Error(payload.error || 'Dosya oluşturulamadı.')
          }

          createdCount += 1
        } catch (rowError) {
          skippedCount += 1
          failedLabels.push(`${personLabel} (${rowError instanceof Error ? rowError.message : 'hata'})`)
        }

        updateBulkProgress('Dosyalar oluşturuluyor', rows.length, index + 1)
      }

      const failedSummary = failedLabels.length > 0
        ? `\n\nAtlanan kayıtlar:\n${failedLabels.slice(0, 10).join('\n')}${failedLabels.length > 10 ? `\n... ve ${failedLabels.length - 10} kayıt daha` : ''}`
        : ''
      setActionStatus(`${createdCount} yeni dosya oluşturuldu ve ilgili müracaata bağlandı${skippedCount ? `, ${skippedCount} kayıt atlandı` : ''}.${failedSummary}`)
      setSelectedRowIds([])
      router.refresh()
    } finally {
      setIsCreatingFile(false)
      setBulkProgress(null)
    }
  }

  const deleteFilteredRows = async () => {
    if (!deleteConfig?.allowFilteredDelete || totalCount === 0 || !hasActiveFilter) return

    const confirmed = await confirmDialog(
      `Filtrelenen tüm kayıtlar silinecek.\n\nEkranda görünen kayıt: ${data.length}\nToplam filtrelenen kayıt: ${totalCount}\nSilinecek kayıt sayısı: ${totalCount}\n\nDevam edilsin mi?`,
    )
    if (!confirmed) return

    setIsDeleting(true)
    setActionStatus('')
    setBulkProgress(null)

    try {
      const filters: Record<string, string> = {}
      searchParams.forEach((value, key) => {
        filters[key] = value
      })

      let deleted = 0
      let remaining = totalCount
      updateBulkProgress('Filtrelenen kayitlar siliniyor', totalCount, 0)

      while (remaining > 0) {
        const response = await fetch(deleteConfig!.endpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'filtered', filters, limit: BULK_PROGRESS_BATCH_SIZE }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Filtrelenen kayitlar silinemedi.')
        }

        const batchDeleted = Number(payload.data?.deleted || 0)
        deleted += batchDeleted
        remaining = Number.isFinite(Number(payload.data?.remaining))
          ? Number(payload.data.remaining)
          : Math.max(totalCount - deleted, 0)
        updateBulkProgress('Filtrelenen kayitlar siliniyor', totalCount, Math.min(deleted, totalCount))

        if (batchDeleted === 0 || payload.data?.remaining === undefined) break
      }

      setActionStatus(`${deleted} filtreli kayit silindi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      router.refresh()
      return

      const response = await fetch(deleteConfig!.endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'filtered', filters }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Filtrelenen kayıtlar silinemedi.')
      }

      setActionStatus(`${payload.data?.deleted || 0} filtreli kayıt silindi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Filtrelenen kayıtlar silinemedi.')
    } finally {
      setIsDeleting(false)
      setBulkProgress(null)
    }
  }

  // Kullanici istegi (2026-09-29): "nakit müracaatlarında toplu iptal etme
  // işlemi yok ... toplu nakit yardımı iptal işlemi yapabilelim" - eskiden
  // bu buton SADECE tek bir kayit secildiginde aktifti (selectedRows.length
  // !== 1) ve ham/stilsiz bir window.open() penceresi aciyordu. Artik 1+
  // kayit secilebilir ve HER ZAMAN asagidaki (yeniden tasarlanmis, renkli)
  // sayfa-ici modal kullanilir - ayri pencere tamamen kaldirildi.
  //
  // "toplu nakit işlemi yaparken otomatik red müracaatlarında otomatik red
  // açıklamasını iptal açıklamasına yazalım" - asamasi "Otomatik Red" olan
  // ve zaten bir durumuaciklama'si (bkz. cashAutoReject.service.ts) bulunan
  // secili kayitlar icin, asagidaki manuel "İptal Nedeni" metni DEGIL, o
  // kaydin KENDI otomatik red aciklamasi iptal nedeni olarak kullanilir.
  const OTOMATIK_RED_STAGE_LABEL = 'Otomatik Red'

  const getRowAutoRejectReason = (row: Record<string, unknown>): string | null => {
    const asamaValue = typeof row.asama === 'string' ? row.asama : ''
    const durumuaciklamaValue = typeof row.durumuaciklama === 'string' ? row.durumuaciklama.trim() : ''
    if (!durumuaciklamaValue) return null
    if (normalizePredefinedText(asamaValue) !== normalizePredefinedText(OTOMATIK_RED_STAGE_LABEL)) return null
    return durumuaciklamaValue
  }

  const cancelAutoReasonCount = cancelConfig
    ? selectedRows.filter((row) => getRowAutoRejectReason(row)).length
    : 0
  const cancelManualReasonCount = selectedRows.length - cancelAutoReasonCount
  // Kullanici istegi (2026-09-29, devam): "filtrelenen tüm kayıtları
  // seçtiğimde hepsi için iptal işlemi yapamıyorum" - "Filtrelenen Tümünü
  // Seç" aktifken selectedRows BOS olur (bkz. asagidaki toggle - satir
  // verisi TUM sayfalarda tasinmaz), bu yuzden bu modda hedef sayi
  // totalCount'tan, gonderilecek bilgi ise satir verisi yerine filters'tan
  // gelir (bkz. cancelFilteredRows).
  const cancelTargetCount = allFilteredSelected ? totalCount : selectedRows.length
  // Filtrelenen-tumu modunda hangi kayitlarin "Otomatik Red" oldugunu
  // istemci bilemez (satir verisi yuklu degil) - sunucu ikisini de kendi
  // ayirir (bkz. route.ts), bu yuzden bu modda neden alani HER ZAMAN
  // zorunlu tutulur (guvenli varsayilan).
  const cancelReasonRequired = allFilteredSelected ? true : cancelManualReasonCount > 0

  const openCancelModal = () => {
    if (!cancelConfig || cancelTargetCount === 0) return

    setCancelDate(new Date().toISOString().slice(0, 10))
    setCancelReason('')
    setActionStatus('')
    setCancelModalOpen(true)
  }

  const cancelSelectedRow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cancelConfig || cancelTargetCount === 0) return

    if (!cancelDate) {
      setActionStatus('Iptal tarihi zorunludur.')
      return
    }

    if (cancelReasonRequired && !cancelReason.trim()) {
      setActionStatus('İptal nedeni zorunludur.')
      return
    }

    setIsCancelling(true)
    setActionStatus('')

    try {
      let body: Record<string, unknown>

      if (allFilteredSelected) {
        const filters: Record<string, string> = {}
        searchParams.forEach((value, key) => { filters[key] = value })
        body = { cancelDate, mode: 'filtered', filters, cancelReason: cancelReason.trim() }
      } else {
        const items = selectedRows
          .map((row) => {
            const id = row.id
            if (typeof id !== 'string' && typeof id !== 'number' && typeof id !== 'bigint') return null
            const autoReason = getRowAutoRejectReason(row)
            const reason = autoReason || cancelReason.trim()
            return reason ? { id: String(id), cancelReason: reason } : null
          })
          .filter((item): item is { id: string; cancelReason: string } => item !== null)

        if (items.length === 0) {
          setActionStatus('Iptal edilecek kayit id bilgisi bulunamadi.')
          setIsCancelling(false)
          return
        }
        body = { cancelDate, items }
      }

      const response = await fetch(cancelConfig.endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayit iptal edilemedi.')
      }

      setActionStatus(`${payload.updatedCount ?? cancelTargetCount} müracaat iptal edildi.`)
      setSelectedRowIds([])
      setAllFilteredSelectedScope('')
      setCancelModalOpen(false)
      router.refresh()
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Kayit iptal edilemedi.')
    } finally {
      setIsCancelling(false)
    }
  }

  const goToPage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const requestedPage = Math.max(1, Math.min(totalPages, Number(formData.get('page')) || currentPage))
    router.push(buildPageUrl(routePath, searchParams, requestedPage, searchTerm))
  }

  return (
    <div className="space-y-6 text-slate-950" onContextMenu={openContextMenu}>
      <ReportPageHeader
        eyebrow={eyebrow}
        title={title}
        description={`${firstRecord}-${lastRecord} arası kayıtlar gösteriliyor.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {newButtonLabel && (
              <button
                type="button"
                className={`${reportHeaderGhostButton} opacity-70`}
                disabled
              >
                {newButtonLabel}
              </button>
            )}
            <button type="button" className={reportHeaderGhostButton} onClick={() => window.print()}>
              Yazdır (Ctrl+P)
            </button>
          </div>
        }
      />
      {afterHeader}

      {importConfig && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.tsv,.xlsx"
          className="hidden"
          onChange={(event) => void handleImportFile(event.target.files?.[0])}
        />
      )}

      {actionStatus && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${
          actionStatus.includes('silindi') || actionStatus.includes('aktarıldı') || actionStatus.includes('aktarildi') || actionStatus.includes('iptal edildi') || actionStatus.includes('atandi') || actionStatus.includes('kopyalandi') || actionStatus.includes('eklendi') || actionStatus.includes('guncellendi')
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {actionStatus}
        </div>
      )}

      {bulkProgress && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-800">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span>{bulkProgress.label}: {bulkProgress.total} kayit isleniyor</span>
            <span>{bulkProgress.completed} tamamlandi, {bulkProgress.remaining} kaldi</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[#0076b6] transition-all"
              style={{ width: `${bulkProgress.total > 0 ? Math.min(100, Math.round((bulkProgress.completed / bulkProgress.total) * 100)) : 0}%` }}
            />
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-4 border bg-white p-4 print:hidden ${organizedToolbar ? 'rounded-2xl border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-emerald-50/60 shadow-[0_14px_35px_rgba(0,118,182,0.10)]' : 'rounded-lg border-slate-200 shadow-sm md:flex-row md:items-center md:justify-between'}`}>
        <form onSubmit={handleSearch} className={`flex w-full gap-2 ${organizedToolbar ? '' : 'md:w-auto'}`}>
          {organizedToolbar ? (
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                <ToolbarIcon type="search" />
              </div>
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-h-9 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-[12.5px] font-bold text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[#0076b6] md:min-h-12 md:py-2 md:text-[16px]"
              />
            </div>
          ) : (
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-[#0076b6] md:w-96 md:py-2 md:text-[16px]"
            />
          )}
          <button
            type="submit"
            className={organizedToolbar
              ? 'inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-[#0076b6] px-3 text-[12px] font-extrabold text-white shadow-sm hover:bg-[#00649b] md:min-h-12 md:px-4 md:text-[15px]'
              : 'rounded-md bg-[#0076b6] px-3 py-1.5 text-[12px] font-extrabold text-white hover:bg-[#00649b] md:px-4 md:py-2 md:text-[15px]'}
          >
            {organizedToolbar && <ToolbarIcon type="search" />}
            Ara
          </button>
          {searchTerm && (
            <button
              type="button"
              onClick={clearFilters}
              className={organizedToolbar
                ? 'inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-extrabold text-slate-600 shadow-sm hover:bg-slate-50 md:min-h-12 md:px-4 md:text-[15px]'
                : 'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-extrabold text-slate-600 hover:bg-slate-50 md:px-4 md:py-2 md:text-[15px]'}
            >
              {organizedToolbar && <ToolbarIcon type="clear" />}
              Temizle
            </button>
          )}
        </form>

        <div className="flex w-full flex-col gap-2">
          {/* Kullanici istegi: sayfaya ozel toplu-islem butonlari (ör. Nakit
              Yardimi'nin "Müracaatları Güncelle"/"Kriterleri Uygula") ve
              Excel aktarim butonlari, geri kalan standart arac cubugundan
              (Seçili, Yenile, Toplu Guncelle vb.) AYRI, kendi turune ozel
              gruplanmis kucuk bir "cip" alaninda gosterilir - boylece hem
              butonlar dar/kompakt kalir hem de hangi butonun ne ise
              yaradigi turune gore ayirt edilebilir. */}
          {!organizedToolbar && (extraToolbarButtons || importConfig) && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2 [&>button]:min-h-9 [&>button]:rounded-lg [&>button]:shadow-sm">
              {extraToolbarButtons}
              {importConfig && (
                <>
                  {extraToolbarButtons && <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-slate-300" />}
                  <button
                    type="button"
                    onClick={downloadImportTemplate}
                    disabled={importConfig.columns.length === 0}
                    title={importConfig.description}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    ⬇ Excel Şablonu İndir
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    title={importConfig.description}
                    className="rounded-md bg-slate-800 px-3 py-2 text-[16px] font-black text-white hover:bg-slate-900 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isImporting ? 'Aktarılıyor...' : '⬆ Excel Verisi Yükle'}
                  </button>
                </>
              )}
            </div>
          )}

        {organizedToolbar ? (
          <div className="flex flex-wrap items-stretch gap-2">
            <span className={`${TOOLBAR_ITEM_BASE} ${TOOLBAR_TONE_CLASSES.neutral} flex-none basis-auto`}>
              <ToolbarIcon type="selected" /> Seçili: {selectedDisplayCount}
            </span>
            {totalCount > data.length && (
              <button
                type="button"
                onClick={() => {
                  setAllFilteredSelectedScope((current) => current === selectionScope ? '' : selectionScope)
                  setSelectedRowIds([])
                  setActionStatus('')
                }}
                disabled={totalCount === 0}
                className={`${TOOLBAR_ITEM_BASE} ${
                  allFilteredSelected
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : TOOLBAR_TONE_CLASSES.neutral
                }`}
              >
                <ToolbarIcon type="selectAll" />
                {allFilteredSelected ? 'Filtrelenen Secimi Kaldir' : `Filtrelenen Tumunu Sec (${totalCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={refreshPage}
              disabled={refreshing}
              className={`${TOOLBAR_ITEM_BASE} ${TOOLBAR_TONE_CLASSES.cyan}`}
            >
              <ToolbarIcon type="refresh" /> {refreshing ? 'Yenileniyor...' : 'Yenile'}
            </button>

            {/* Kullanici istegi: rapor basliklarindan birine gore gruplama -
                ör. "Dosyano" secilirse ayni dosyaya ait TUM (sadece bu sayfa
                degil) kayitlar acilir/kapanir bir baslik altinda toplanip
                kac kayit oldugu gosterilir (bkz. yukaridaki groupedSections). */}
            <label className={`${TOOLBAR_ITEM_BASE} ${TOOLBAR_TONE_CLASSES.neutral} cursor-pointer gap-2`}>
              <ToolbarIcon type="settings" />
              <span className="shrink-0">Grupla:</span>
              <select
                value={groupByColumn}
                onChange={(event) => setGroupByColumn(event.target.value)}
                className="min-w-0 flex-1 cursor-pointer border-none bg-transparent text-[16px] font-black text-slate-700 outline-none"
              >
                <option value="">Gruplama Yok</option>
                {reportColumns.map((column) => (
                  <option key={column.key} value={column.key}>{column.label}</option>
                ))}
              </select>
            </label>

            {(extraToolbarButtons || importConfig) && (
              <ToolbarDropdown label="Sayfaya Özel İşlemler" icon="settings" tone="violet">
                {extraToolbarButtons}
                {importConfig && (
                  <>
                    {extraToolbarButtons && <span aria-hidden className="my-1 h-px w-full shrink-0 bg-slate-200" />}
                    <button
                      type="button"
                      onClick={downloadImportTemplate}
                      disabled={importConfig.columns.length === 0}
                      title={importConfig.description}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[16px] font-black text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                    >
                      <ToolbarIcon type="exportFile" /> Excel Şablonu İndir
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                      title={importConfig.description}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-[16px] font-black text-white shadow-sm hover:bg-slate-900 disabled:cursor-wait disabled:opacity-60"
                    >
                      <ToolbarIcon type="exportCloud" /> {isImporting ? 'Aktarılıyor...' : 'Excel Verisi Yükle'}
                    </button>
                  </>
                )}
              </ToolbarDropdown>
            )}

            {(
              <ToolbarDropdown label="Kayıt İşlemleri" icon="openFile" tone="brand">
                {/* Bu buton, secili kaydin bagli oldugu dosyayi acar (openRowDocument). Online basvuru
                    ekraninda (onlineApplicationEditConfig) cift tiklama zaten "Basvuruyu Duzenle"
                    modalini actigi ve ayni islevi goren ozel bir buton zaten toolbar'da bulundugu
                    icin orada gereksizdir; ama Yardimlar/Muracaatlar listelerinde tek dosya acma
                    kisayolu olarak mevcut ozellik olarak korunmalidir. */}
                {!onlineApplicationEditConfig && <button
                  type="button"
                  onClick={openSelectedDocument}
                  disabled={selectedRows.length !== 1}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#0076b6] bg-white px-3 text-[16px] font-black text-[#0076b6] shadow-sm hover:bg-[#eaf7fd] disabled:pointer-events-none disabled:opacity-50"
                >
                  <ToolbarIcon type="openFile" /> Seçili Dosyayı Aç
                </button>}
                {recordUpdateConfig && (
                  <button
                    type="button"
                    onClick={openRecordUpdateModal}
                    disabled={(selectedRows.length === 0 && !allFilteredSelected) || isUpdatingRecord}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-[16px] font-black text-white shadow-sm hover:bg-slate-950 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <ToolbarIcon type="bulkEdit" /> Toplu Guncelle
                  </button>
                )}
                {onlineApplicationEditConfig && (
                  <button
                    type="button"
                    onClick={() => selectedRows[0] && openOnlineApplicationEditModal(selectedRows[0])}
                    disabled={selectedRows.length !== 1 || isSavingOnlineEdit}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#0076b6] px-3 text-[16px] font-black text-white shadow-sm hover:bg-[#00649b] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <ToolbarIcon type="bulkEdit" /> {onlineApplicationEditConfig.label || 'Basvuruyu Duzenle'}
                  </button>
                )}
                {transferConfig && (
                  <button
                    type="button"
                    onClick={() => void transferRecords()}
                    disabled={isTransferring || totalCount === 0 || (selectedRows.length === 0 && !hasActiveFilter && !allFilteredSelected)}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-[16px] font-black text-white shadow-sm hover:bg-emerald-800 disabled:pointer-events-none disabled:opacity-50"
                    title={selectedRows.length > 0 ? 'Secili kayitlari aktarir' : 'Aktif filtre veya arama sonucundaki kayitlari aktarir'}
                  >
                    <ToolbarIcon type="transfer" /> {isTransferring ? 'Aktariliyor...' : transferConfig.filteredLabel || transferConfig.label}
                  </button>
                )}
              </ToolbarDropdown>
            )}

            <ToolbarDropdown label="Dışa Aktar & İletişim" icon="exportCloud" tone="emerald">
              {/* Kullanici istegi: "Filtrelenen Tümünü Seç" aktifken bu buton da
                  CALISMALI - eskiden sadece o an SAYFADA GORUNEN secili
                  satirlari (selectedRows) baz aliyordu, "Filtrelenen Tümünü
                  Seç" ile secilenler o an sayfada gorunmeyebilecegi icin buton
                  hep pasif kaliyordu. Bu durumda "Seçilenler" = "filtrelenen
                  TÜM kayıtlar" oldugu icin, ayni exportEndpoint'i kullanan
                  exportListedRows() cagrilir (Tüm Kayıtları XLSX Aktar ile
                  AYNI mekanizma). */}
              <button
                type="button"
                onClick={() => (allFilteredSelected ? void exportListedRows() : exportSelectedRows())}
                disabled={(selectedRows.length === 0 && !allFilteredSelected) || (allFilteredSelected && (isExportingAllRows || totalCount === 0))}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#3f7f28] px-3 text-[16px] font-black text-white shadow-sm hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50"
              >
                <ToolbarIcon type="exportFile" /> {allFilteredSelected && isExportingAllRows ? 'Aktarılıyor...' : 'Seçilenleri XLSX Aktar'}
              </button>
              <BulkWhatsappSendButton
                recipients={bulkWhatsappRecipients}
                buttonLabel={isLoadingAllFilteredWhatsapp ? 'Alıcılar hazırlanıyor...' : undefined}
                disabled={isLoadingAllFilteredWhatsapp}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-[16px] font-black text-white shadow-sm hover:bg-emerald-800 disabled:pointer-events-none disabled:opacity-50"
              />
              <BulkSmsSendButton
                recipients={bulkWhatsappRecipients}
                buttonLabel={isLoadingAllFilteredWhatsapp ? 'Alıcılar hazırlanıyor...' : undefined}
                disabled={isLoadingAllFilteredWhatsapp}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#1E2A38] px-3 text-[16px] font-black text-white shadow-sm hover:bg-[#15202c] disabled:pointer-events-none disabled:opacity-50"
              />
              <MarkManualSentButton
                recipients={bulkWhatsappRecipients}
                disabled={isLoadingAllFilteredWhatsapp}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-700 px-3 text-[16px] font-black text-white shadow-sm hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void exportListedRows()}
                disabled={totalCount === 0 || isExportingAllRows}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[16px] font-black text-white shadow-sm hover:bg-amber-600 disabled:pointer-events-none disabled:opacity-60"
              >
                <ToolbarIcon type="exportCloud" /> {isExportingAllRows ? 'Aktarılıyor...' : `Tüm Kayıtları XLSX Aktar (${totalCount})`}
              </button>
              <button
                type="button"
                onClick={() => setIsReportModalOpen(true)}
                disabled={data.length === 0}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#0076b6] bg-white px-3 text-[16px] font-black text-[#0076b6] shadow-sm hover:bg-[#eaf7fd] disabled:pointer-events-none disabled:opacity-50"
              >
                <ToolbarIcon type="report" /> Rapor Oluştur
              </button>
            </ToolbarDropdown>

            {(deleteConfig?.showToolbarButton || deleteConfig?.allowFilteredDelete) && (
              <ToolbarDropdown label="Tehlikeli İşlemler" icon="trash" tone="danger">
                {deleteConfig?.showToolbarButton && (
                  <button
                    type="button"
                    onClick={() => void deleteSelectedRows()}
                    disabled={selectedRows.length === 0 || isDeleting}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-[16px] font-black text-white shadow-sm hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <ToolbarIcon type="trash" /> {isDeleting ? 'Siliniyor...' : `${deleteConfig.label || 'Seçilenleri Sil'}${selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}`}
                  </button>
                )}
                {deleteConfig?.allowFilteredDelete && (
                  <button
                    type="button"
                    onClick={deleteFilteredRows}
                    disabled={!hasActiveFilter || totalCount === 0 || isDeleting}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-red-700 px-3 text-[16px] font-black text-white shadow-sm hover:bg-red-800 disabled:pointer-events-none disabled:opacity-50"
                    title={hasActiveFilter ? 'Aktif filtre veya arama sonucundaki tüm kayıtları siler' : 'Önce arama veya filtre uygulayın'}
                  >
                    <ToolbarIcon type="trash" /> {isDeleting ? 'Siliniyor...' : deleteConfig.filteredLabel || 'Filtrelenen Tümünü Sil'}
                  </button>
                )}
              </ToolbarDropdown>
            )}

            <button
              type="button"
              onClick={clearFilters}
              className={`${TOOLBAR_ITEM_BASE} ${TOOLBAR_TONE_CLASSES.neutral} flex-none basis-auto`}
            >
              <ToolbarIcon type="clear" /> Filtreleri Temizle
            </button>

            {quickFilterConfig && (
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-bold text-[#1E2A38] shadow-sm md:min-h-10 md:px-4 md:text-[12.5px]">
                <ToolbarIcon type="settings" />
                <span className="shrink-0">{quickFilterConfig.label}:</span>
                <select
                  value={searchParams.get(`f_${quickFilterConfig.fieldKey}`) || ''}
                  onChange={(event) => applyQuickFilter(quickFilterConfig.fieldKey, event.target.value)}
                  className="min-w-0 max-w-[220px] cursor-pointer border-none bg-transparent text-[12px] font-bold text-[#1E2A38] outline-none md:text-[12.5px]"
                >
                  <option value="">{quickFilterConfig.placeholder || 'Tümü'}</option>
                  {(filterValueOptions?.[quickFilterConfig.fieldKey] || []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label} ({option.count})</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[16px] font-black text-slate-600">
            Seçili: {selectedDisplayCount}
          </span>
          {totalCount > data.length && (
            <button
              type="button"
              onClick={() => {
                setAllFilteredSelectedScope((current) => current === selectionScope ? '' : selectionScope)
                setSelectedRowIds([])
                setActionStatus('')
              }}
              disabled={totalCount === 0}
              className={`rounded-md border px-3 py-2 text-[16px] font-black disabled:pointer-events-none disabled:opacity-50 ${
                allFilteredSelected
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {allFilteredSelected ? 'Filtrelenen Secimi Kaldir' : `Filtrelenen Tumunu Sec (${totalCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={refreshPage}
            disabled={refreshing}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {refreshing ? 'Yenileniyor...' : 'Yenile'}
          </button>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50">
            <span className="shrink-0">Grupla:</span>
            <select
              value={groupByColumn}
              onChange={(event) => setGroupByColumn(event.target.value)}
              className="min-w-0 cursor-pointer border-none bg-transparent text-[16px] font-black text-slate-700 outline-none"
            >
              <option value="">Gruplama Yok</option>
              {reportColumns.map((column) => (
                <option key={column.key} value={column.key}>{column.label}</option>
              ))}
            </select>
          </label>
          {/* Bu buton, secili kaydin bagli oldugu dosyayi acar (openRowDocument). Online basvuru
              ekraninda (onlineApplicationEditConfig) cift tiklama zaten "Basvuruyu Duzenle"
              modalini actigi ve ayni islevi goren ozel bir buton zaten toolbar'da bulundugu
              icin orada gereksizdir; ama Yardimlar/Muracaatlar listelerinde tek dosya acma
              kisayolu olarak mevcut ozellik olarak korunmalidir. */}
          {!onlineApplicationEditConfig && <button
            type="button"
            onClick={openSelectedDocument}
            disabled={selectedRows.length !== 1}
            className="rounded-md border border-[#0076b6] bg-white px-3 py-2 text-[16px] font-black text-[#0076b6] hover:bg-[#eaf7fd] disabled:pointer-events-none disabled:opacity-50"
          >
            Seçili Dosyayı Aç
          </button>}
          {recordUpdateConfig && (
            <button
              type="button"
              onClick={openRecordUpdateModal}
              disabled={(selectedRows.length === 0 && !allFilteredSelected) || isUpdatingRecord}
              className="rounded-md bg-slate-800 px-3 py-2 text-[16px] font-black text-white hover:bg-slate-950 disabled:pointer-events-none disabled:opacity-50"
            >
              Toplu Guncelle
            </button>
          )}
          {onlineApplicationEditConfig && (
            <button
              type="button"
              onClick={() => selectedRows[0] && openOnlineApplicationEditModal(selectedRows[0])}
              disabled={selectedRows.length !== 1 || isSavingOnlineEdit}
              className="rounded-md bg-[#0076b6] px-3 py-2 text-[16px] font-black text-white hover:bg-[#00649b] disabled:pointer-events-none disabled:opacity-50"
            >
              {onlineApplicationEditConfig.label || 'Basvuruyu Duzenle'}
            </button>
          )}
          {transferConfig && (
            <button
              type="button"
              onClick={() => void transferRecords()}
              disabled={isTransferring || totalCount === 0 || (selectedRows.length === 0 && !hasActiveFilter && !allFilteredSelected)}
              className="rounded-md bg-emerald-700 px-3 py-2 text-[16px] font-black text-white hover:bg-emerald-800 disabled:pointer-events-none disabled:opacity-50"
              title={selectedRows.length > 0 ? 'Secili kayitlari aktarir' : 'Aktif filtre veya arama sonucundaki kayitlari aktarir'}
            >
              {isTransferring ? 'Aktariliyor...' : transferConfig.filteredLabel || transferConfig.label}
            </button>
          )}
          {/* Kullanici istegi: "Filtrelenen Tümünü Seç" aktifken bu buton da
              CALISMALI - eskiden sadece o an SAYFADA GORUNEN secili
              satirlari (selectedRows) baz aliyordu, "Filtrelenen Tümünü
              Seç" ile secilenler o an sayfada gorunmeyebilecegi icin buton
              hep pasif kaliyordu. Bu durumda "Seçilenler" = "filtrelenen
              TÜM kayıtlar" oldugu icin, ayni exportEndpoint'i kullanan
              exportListedRows() cagrilir (Tüm Kayıtları XLSX Aktar ile
              AYNI mekanizma). */}
          <button
            type="button"
            onClick={() => (allFilteredSelected ? void exportListedRows() : exportSelectedRows())}
            disabled={(selectedRows.length === 0 && !allFilteredSelected) || (allFilteredSelected && (isExportingAllRows || totalCount === 0))}
            className="rounded-md bg-[#3f7f28] px-3 py-2 text-[16px] font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50"
          >
            {allFilteredSelected && isExportingAllRows ? 'Aktarılıyor...' : 'Seçilenleri XLSX Aktar'}
          </button>
          <BulkWhatsappSendButton
            recipients={bulkWhatsappRecipients}
            buttonLabel={isLoadingAllFilteredWhatsapp ? 'Alıcılar hazırlanıyor...' : undefined}
            disabled={isLoadingAllFilteredWhatsapp}
            className="rounded-md bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-[16px] font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
          />
          <BulkSmsSendButton
            recipients={bulkWhatsappRecipients}
            buttonLabel={isLoadingAllFilteredWhatsapp ? 'Alıcılar hazırlanıyor...' : undefined}
            disabled={isLoadingAllFilteredWhatsapp}
            className="rounded-md bg-gradient-to-r from-[#0076b6] to-sky-600 px-3 py-2 text-[16px] font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
          />
          <MarkManualSentButton
            recipients={bulkWhatsappRecipients}
            disabled={isLoadingAllFilteredWhatsapp}
            className="rounded-md bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-2 text-[16px] font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
          />
          {deleteConfig?.showToolbarButton && (
            <button
              type="button"
              onClick={() => void deleteSelectedRows()}
              disabled={selectedRows.length === 0 || isDeleting}
              className="rounded-md bg-rose-600 px-3 py-2 text-[16px] font-black text-white shadow-sm hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50"
            >
              {isDeleting ? 'Siliniyor...' : `${deleteConfig.label || 'Seçilenleri Sil'}${selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}`}
            </button>
          )}
          {deleteConfig?.allowFilteredDelete && (
            <button
              type="button"
              onClick={deleteFilteredRows}
              disabled={!hasActiveFilter || totalCount === 0 || isDeleting}
              className="rounded-md bg-red-700 px-3 py-2 text-[16px] font-black text-white hover:bg-red-800 disabled:pointer-events-none disabled:opacity-50"
              title={hasActiveFilter ? 'Aktif filtre veya arama sonucundaki tüm kayıtları siler' : 'Önce arama veya filtre uygulayın'}
            >
              {isDeleting ? 'Siliniyor...' : deleteConfig.filteredLabel || 'Filtrelenen Tümünü Sil'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void exportListedRows()}
            disabled={totalCount === 0 || isExportingAllRows}
            className="rounded-md bg-amber-500 px-3 py-2 text-[16px] font-black text-white hover:bg-amber-600 disabled:pointer-events-none disabled:opacity-60"
          >
            {isExportingAllRows ? 'Aktarılıyor...' : `Tüm Kayıtları XLSX Aktar (${totalCount})`}
          </button>
          <button
            type="button"
            onClick={() => setIsReportModalOpen(true)}
            disabled={data.length === 0}
            className="rounded-md border border-[#0076b6] bg-white px-3 py-2 text-[16px] font-black text-[#0076b6] hover:bg-[#eaf7fd] disabled:pointer-events-none disabled:opacity-50"
          >
            Rapor Oluştur
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50"
          >
            Filtreleri Temizle
          </button>

          {quickFilterConfig && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#0076b6] bg-[#eaf7fd] px-3 py-2 text-[16px] font-black text-[#0076b6]">
              <span className="shrink-0">{quickFilterConfig.label}:</span>
              <select
                value={searchParams.get(`f_${quickFilterConfig.fieldKey}`) || ''}
                onChange={(event) => applyQuickFilter(quickFilterConfig.fieldKey, event.target.value)}
                className="min-w-0 max-w-[220px] cursor-pointer border-none bg-transparent text-[16px] font-black text-[#0076b6] outline-none"
              >
                <option value="">{quickFilterConfig.placeholder || 'Tümü'}</option>
                {(filterValueOptions?.[quickFilterConfig.fieldKey] || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label} ({option.count})</option>
                ))}
              </select>
            </label>
          )}
        </div>
        )}
        </div>
      </div>


      {contextMenuPosition && typeof document !== 'undefined' && createPortal((
        <div
          ref={contextMenuRef}
          className="fixed z-[2147483647] max-h-[calc(100vh-1rem)] w-72 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_50px_rgba(15,23,42,0.20)] ring-1 ring-slate-950/5 print:hidden"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="mb-1 flex items-center justify-between border-b border-slate-100 px-2.5 pb-2 pt-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Kayıt İşlemleri</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedDisplayCount || 0}</span>
          </div>

          {personnelAssignConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                void openPersonnelModal()
              }}
              disabled={selectedRows.length === 0 || allFilteredSelected || isAssigningPersonnel}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="personnel" />
              </span>
              <span className="min-w-0 flex-1">Personel Ata</span>
              {selectedRows.length > 0 && !allFilteredSelected && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedRows.length}</span>
              )}
            </button>
          )}

          {copyConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                openCopyModal()
              }}
              disabled={totalCount === 0 || isCopying}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="update" />
              </span>
              <span className="min-w-0 flex-1">Kayıtları Kopyala</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedDisplayCount || totalCount}</span>
            </button>
          )}

          {investigationReportConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                openInvestigationReportModal()
              }}
              disabled={selectedRows.length === 0 && !allFilteredSelected}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="report" />
              </span>
              <span className="min-w-0 flex-1">Toplu Tahkikat Raporu</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedDisplayCount}</span>
            </button>
          )}

          {recordUpdateConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                openRecordUpdateModal()
              }}
              disabled={(selectedRows.length === 0 && !allFilteredSelected) || isUpdatingRecord}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="copy" />
              </span>
              <span className="min-w-0 flex-1">Kayıt Bilgisi Güncelle</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedDisplayCount}</span>
            </button>
          )}

          {/* Kullanici istegi (2026-09-22): "müracaatlar, yardımlar ve iptal
              edilenler sekmelerinde bir müracaat seçilip sağ tık
              yaptığımızda ... müracaatı aç butonu ekleyelim ve ...
              müracaat bilgilerini gösten müracaat penceresi açılsın ve
              yetkili kullanıcı burada güncelleme ve değişiklik yapabilsin" -
              online basvuru sayfasinda AYNI islevi onlineApplicationEditConfig
              zaten yaptigi icin (!onlineApplicationEditConfig) ile disarida
              birakildi - "cash" metin eslesmesi yuzunden isCashStageContext
              online sayfasinda da yanlislikla true olabiliyor (bkz.
              cashStageContextText), bu yuzden bu ek kontrol sart. */}
          {isCashStageContext && !onlineApplicationEditConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                if (selectedRows[0]) openNoFileCashApplicationEditModal(selectedRows[0])
              }}
              disabled={selectedRows.length !== 1}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="update" />
              </span>
              <span className="min-w-0 flex-1">Müracaatı Aç</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">1</span>
            </button>
          )}

          {onlineApplicationEditConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                if (selectedRows[0]) openOnlineApplicationEditModal(selectedRows[0])
              }}
              disabled={selectedRows.length !== 1 || isSavingOnlineEdit}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="update" />
              </span>
              <span className="min-w-0 flex-1">{onlineApplicationEditConfig.label || 'Basvuruyu Duzenle'}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">1</span>
            </button>
          )}

          {transferConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                void transferRecords()
              }}
              disabled={isTransferring || totalCount === 0 || (selectedRows.length === 0 && !hasActiveFilter && !allFilteredSelected)}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="copy" />
              </span>
              <span className="min-w-0 flex-1">{transferConfig.label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedDisplayCount || totalCount}</span>
            </button>
          )}

          {cancelConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                openCancelModal()
              }}
              disabled={cancelTargetCount === 0 || isCancelling}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-rose-700 transition hover:bg-rose-50 disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white transition group-hover:bg-rose-700">
                <ContextActionIcon type="cancel" />
              </span>
              <span className="min-w-0 flex-1">{cancelTargetCount > 1 ? 'Toplu İptal Et' : 'Iptal Et'}</span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-700">{cancelTargetCount || 1}</span>
            </button>
          )}

          {createFileConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                void createFilesForSelectedRows()
              }}
              disabled={selectedRows.length === 0 || isCreatingFile}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-slate-800 transition hover:bg-[#EEF1F3] hover:text-[#1E2A38] disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E2A38] text-white transition group-hover:bg-[#2A3B4D]">
                <ContextActionIcon type="add" />
              </span>
              <span className="min-w-0 flex-1">{isCreatingFile ? 'Dosyalar sırayla oluşturuluyor...' : (createFileConfig.label || 'Yeni Dosya Oluştur')}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{selectedRows.length || 1}</span>
            </button>
          )}

          {deleteConfig && (
            <button
              type="button"
              onClick={() => {
                closeContextMenu()
                void deleteSelectedRows()
              }}
              disabled={selectedRows.length === 0 || isDeleting}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[13px] font-black text-rose-700 transition hover:bg-rose-50 disabled:pointer-events-none disabled:grayscale disabled:opacity-35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white transition group-hover:bg-rose-700">
                <ContextActionIcon type="delete" />
              </span>
              <span className="min-w-0 flex-1">Secileni Sil</span>
              {selectedRows.length > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-700">{selectedRows.length}</span>
              )}
            </button>
          )}
        </div>
      ), document.body)}

      {investigationReportConfig && investigationReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 print:hidden">
          <form onSubmit={saveInvestigationReports} className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-[16px] font-black uppercase text-cyan-700">Toplu Tahkikat Raporu</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">Rapor bilgilerini girin</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {allFilteredSelected
                  ? `Rapor eklenecek filtrelenen toplam kayit: ${totalCount}`
                  : selectedRows.length > 0
                  ? `Secili kayit: ${selectedRows.length} / Filtrelenen toplam: ${totalCount}`
                  : `Rapor eklenecek filtrelenen toplam kayit: ${totalCount}`}
              </p>
            </div>

            <div className="mb-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              {selectedRows.length > 0 && !allFilteredSelected && (
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="investigationReportMode"
                    value="selected"
                    checked={investigationReportMode === 'selected'}
                    onChange={() => setInvestigationReportMode('selected')}
                    className="h-4 w-4 border-slate-300 text-cyan-700"
                  />
                  Secilen kayitlara ekle
                  </span>
                  <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-cyan-100 px-2.5 py-1 text-[16px] font-black text-cyan-800">
                    {selectedRows.length}
                  </span>
                </label>
              )}
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded bg-white px-3 py-2 text-sm font-bold text-slate-700">
                <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="investigationReportMode"
                  value="filtered"
                  checked={investigationReportMode === 'filtered' || selectedRows.length === 0 || allFilteredSelected}
                  onChange={() => setInvestigationReportMode('filtered')}
                  disabled={totalCount === 0}
                  className="h-4 w-4 border-slate-300 text-cyan-700"
                />
                Filtrelenen listedeki tum kayitlara ekle
                </span>
                <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-violet-100 px-2.5 py-1 text-[16px] font-black text-violet-800">
                  {totalCount}
                </span>
              </label>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Tarih</span>
                <input
                  type="date"
                  value={investigationReportForm.date}
                  onChange={(event) => setInvestigationReportForm((current) => ({ ...current, date: event.target.value }))}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-cyan-700"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Konu</span>
                <select
                  value={investigationReportForm.title}
                  onChange={(event) => setInvestigationReportForm((current) => ({ ...current, title: event.target.value }))}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-cyan-700"
                >
                  <option value="">Secin</option>
                  {investigationReportForm.title && !investigationSubjectOptions.some((option) => option.name === investigationReportForm.title) && (
                    <option value={investigationReportForm.title}>{investigationReportForm.title}</option>
                  )}
                  {investigationSubjectOptions.map((option) => (
                    <option key={option.id} value={option.name}>{option.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Aciklama</span>
                <textarea
                  value={investigationReportForm.content}
                  onChange={(event) => setInvestigationReportForm((current) => ({ ...current, content: event.target.value }))}
                  required
                  rows={6}
                  className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-cyan-700"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInvestigationReportModalOpen(false)}
                disabled={isSavingInvestigationReport}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Vazgec
              </button>
              <button
                type="submit"
                disabled={isSavingInvestigationReport}
                className="rounded-md bg-cyan-700 px-4 py-2 text-[16px] font-black text-white hover:bg-cyan-800 disabled:cursor-wait disabled:opacity-60"
              >
                {isSavingInvestigationReport ? 'Kaydediliyor...' : 'Toplu Tahkikat Raporu Ekle'}
              </button>
            </div>
          </form>
        </div>
      )}

      {onlineApplicationEditConfig && onlineEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 print:hidden">
          <form onSubmit={saveOnlineApplicationEdit} className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Kullanici istegi (2026-09-22): "yetkili kullanıcın online
                başvuruları güncellemesi için açılan bu pencereyi daha
                profesyonel yapalım başlıklar ve alanları renklendirilelim
                verilerin girildiği alanları ve veri yazı puntolarını
                küçültelim" - eski surum tum alanlar AYNI (16px, kalin, gri
                cerceveli) gorunumdeydi. Artik: (1) marka renkleriyle
                gradyanli bir baslik (bkz. Popup Bilgileri ile AYNI
                gradyan), (2) alanlar anlamsal olarak renkli/gruplu
                kartlara ayrildi (Kimlik/Iletisim/Arac-Gelir/Basvuru
                Sureci/Adres), (3) alan/yazi boyutlari kucultuldu
                (16px -> 12-13px, py-2 -> py-1.5).
            */}
            <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[#0076b6] via-[#0090c8] to-[#6fb744] px-5 py-3.5 text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wide text-white/80">Online Başvuru</p>
                <h2 className="mt-0.5 truncate text-base font-black text-white">Başvuru Bilgilerini Düzenle</h2>
              </div>
              <button
                type="button"
                onClick={() => setOnlineEditModalOpen(false)}
                disabled={isSavingOnlineEdit}
                className="shrink-0 rounded-lg border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-black text-white hover:bg-white/20 disabled:pointer-events-none disabled:opacity-50"
              >
                Kapat
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
              <EditModalSection title="Kimlik Bilgileri" tone="indigo">
                <EditModalField label="TC Kimlik No" tone="indigo">
                  <input
                    value={onlineEditForm.tc}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, tc: event.target.value.replace(/\D/g, '').slice(0, 11) }))}
                    required
                    maxLength={11}
                    inputMode="numeric"
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Ad Soyad" tone="indigo">
                  <input
                    value={onlineEditForm.fullName}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, fullName: event.target.value }))}
                    required
                    maxLength={120}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Doğum Tarihi" tone="indigo">
                  <input
                    type="date"
                    value={onlineEditForm.birthDate}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, birthDate: event.target.value }))}
                    className={editModalInputClass}
                  />
                </EditModalField>
              </EditModalSection>

              <EditModalSection title="İletişim ve Banka" tone="sky">
                <EditModalField label="Telefon" tone="sky">
                  <input
                    value={onlineEditForm.phone}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, phone: event.target.value }))}
                    maxLength={20}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="IBAN" tone="sky">
                  <input
                    value={onlineEditForm.iban}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, iban: event.target.value.toUpperCase() }))}
                    maxLength={45}
                    className={editModalInputClass}
                  />
                </EditModalField>
              </EditModalSection>

              <EditModalSection title="Araç ve Gelir Bilgileri" tone="amber">
                <EditModalField label="Aylık Gelir" tone="amber">
                  <input
                    value={onlineEditForm.income}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, income: event.target.value }))}
                    inputMode="numeric"
                    maxLength={30}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Araç Durumu" tone="amber">
                  <input
                    value={onlineEditForm.vehicleStatus}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, vehicleStatus: event.target.value }))}
                    maxLength={30}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Araç Modeli" tone="amber">
                  <input
                    value={onlineEditForm.vehicleModelYear}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, vehicleModelYear: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    inputMode="numeric"
                    maxLength={4}
                    className={editModalInputClass}
                  />
                </EditModalField>
              </EditModalSection>

              <EditModalSection title="Başvuru Süreci" tone="emerald">
                <EditModalField label="Yardım Türü" tone="emerald" span>
                  <input
                    value={onlineEditForm.assistanceType}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, assistanceType: event.target.value }))}
                    maxLength={150}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Miktar" tone="emerald">
                  <input
                    value={onlineEditForm.amount}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, amount: event.target.value.replace(/[^\d.,]/g, '') }))}
                    inputMode="decimal"
                    maxLength={30}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Durum" tone="emerald">
                  <input
                    value={onlineEditForm.status}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, status: event.target.value }))}
                    maxLength={50}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Dönem" tone="emerald">
                  {useCashPeriodOptions ? (
                    <select
                      value={resolvePredefinedSelectValue(onlineEditForm.period, cashPeriodOptions)}
                      onChange={(event) => {
                        const selected = cashPeriodOptions.find((option) => option.id === event.target.value)
                        setOnlineEditForm((current) => ({ ...current, period: selected?.name ?? event.target.value }))
                      }}
                      className={editModalInputClass}
                    >
                      <option value="">Seçin</option>
                      {cashPeriodOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={onlineEditForm.period}
                      onChange={(event) => setOnlineEditForm((current) => ({ ...current, period: event.target.value }))}
                      maxLength={50}
                      className={editModalInputClass}
                    />
                  )}
                </EditModalField>
                <EditModalField label="Etiket" tone="emerald">
                  {useCashLabelOptions ? (
                    <select
                      value={resolvePredefinedSelectValue(onlineEditForm.label, cashLabelOptions)}
                      onChange={(event) => {
                        const selected = cashLabelOptions.find((option) => option.id === event.target.value)
                        setOnlineEditForm((current) => ({ ...current, label: selected?.name ?? event.target.value }))
                      }}
                      className={editModalInputClass}
                    >
                      <option value="">Seçin</option>
                      {cashLabelOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={onlineEditForm.label}
                      onChange={(event) => setOnlineEditForm((current) => ({ ...current, label: event.target.value }))}
                      maxLength={100}
                      className={editModalInputClass}
                    />
                  )}
                </EditModalField>
                <EditModalField label="Aşama" tone="emerald">
                  {useCashStageOptions ? (
                    <select
                      value={resolvePredefinedSelectValue(onlineEditForm.stage, cashStageOptions)}
                      onChange={(event) => {
                        const selected = cashStageOptions.find((option) => option.id === event.target.value)
                        setOnlineEditForm((current) => ({ ...current, stage: selected?.name ?? event.target.value }))
                      }}
                      className={editModalInputClass}
                    >
                      <option value="">Seçin</option>
                      {cashStageOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={onlineEditForm.stage}
                      onChange={(event) => setOnlineEditForm((current) => ({ ...current, stage: event.target.value }))}
                      maxLength={50}
                      className={editModalInputClass}
                    />
                  )}
                </EditModalField>
              </EditModalSection>

              <EditModalSection title="Adres Bilgileri" tone="violet">
                <EditModalField label="Mahalle" tone="violet" span>
                  <input
                    value={onlineEditForm.neighborhood}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, neighborhood: event.target.value }))}
                    maxLength={120}
                    className={editModalInputClass}
                  />
                </EditModalField>
                <EditModalField label="Adres" tone="violet" span>
                  <textarea
                    value={onlineEditForm.address}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, address: event.target.value }))}
                    rows={2}
                    maxLength={500}
                    className={`${editModalInputClass} resize-none`}
                  />
                </EditModalField>
                <EditModalField label="Açıklama" tone="violet" span>
                  <textarea
                    value={onlineEditForm.description}
                    onChange={(event) => setOnlineEditForm((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    maxLength={1000}
                    className={`${editModalInputClass} resize-none`}
                  />
                </EditModalField>
              </EditModalSection>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button
                type="button"
                onClick={() => setOnlineEditModalOpen(false)}
                disabled={isSavingOnlineEdit}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={isSavingOnlineEdit}
                className="rounded-lg bg-[#0076b6] px-4 py-2 text-xs font-black text-white hover:bg-[#00649b] disabled:cursor-wait disabled:opacity-60"
              >
                {isSavingOnlineEdit ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}

      {noFileEditModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/60 p-2 backdrop-blur-sm print:hidden">
          <form
            onSubmit={saveNoFileCashApplicationEdit}
            className="flex max-h-[97vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border border-white bg-white shadow-2xl ring-1 ring-slate-200"
          >
            {/* Kullanici istegi: bu pencere, Dosya Yonetimi'ndeki "Ayni Nakti
                Yardım Müracaatı" penceresi ile AYNI gorunumde olsun -
                asagidaki basli/renk/fieldset duzeni o pencereyle (bkz.
                documents/page.tsx, addApplicationForm.type === 'Ayni/Nakdi')
                birebir aynidir. Sadece dosyaya bagli olmayan bir kayit
                oldugu icin dosya/belge kaynakli paneller (Diger Kurum
                Yardimlari, Belgelerden Alinan Bilgiler) bilgilendirme
                mesajiyla gosterilir - o veriler bir DOSYAYA bagli olmadan
                var olamaz. */}
            <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-rose-600 via-rose-500 to-pink-400 px-5 py-4 text-white shadow-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/30 bg-white/15 shadow-inner">
                  <ContextActionIcon type="update" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-white/80">Ayni/Nakdi</p>
                  <h3 className="truncate text-lg font-black leading-tight">Nakit Yardımı Müracaatı</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNoFileEditModalOpen(false)}
                disabled={isSavingNoFileEdit}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white transition hover:bg-white/25"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gradient-to-b from-rose-50 via-white to-white p-4 md:p-6">
              {noFileEditForm.hasFile ? (
                <div className="mb-3 rounded-lg border-2 border-sky-300 bg-sky-50 px-3 py-2 text-[12px] font-bold text-sky-800">
                  ℹ️ Bu müracaat bir dosyaya bağlı. Müracaat bilgilerini burada görüntüleyip güncelleyebilirsiniz; dosyanın tüm ayrıntıları (diğer yardımlar, belgeler vb.) için Dosya Yönetimi ekranını kullanın.
                </div>
              ) : (
                <div className="mb-3 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800">
                  🔒 Bu müracaat henüz hiçbir dosyaya bağlı değil - bu yüzden Dosya Yönetimi ekranı açılamıyor, içeriğini buradan görüntüleyip güncelleyebilirsiniz.
                  Kalıcı olarak bir dosyaya bağlamak isterseniz listede kayda sağ tıklayıp &quot;Yeni Dosya Oluştur&quot;u ya da &quot;Müracaatları Güncelle&quot; butonunu kullanabilirsiniz.
                </div>
              )}

              <div className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-rose-600 via-rose-500 to-pink-400 px-3 py-2 text-white shadow-sm">
                <span className="text-[13px] font-black uppercase tracking-widest">Ayni/Nakdi - Yardım Detayları</span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-4 text-[12px] font-semibold text-slate-950 lg:grid-cols-[1fr_340px] lg:items-start">
                <div className="space-y-2">
                  <fieldset className="border border-slate-300 px-3 pb-3 pt-2">
                    <legend className="px-1 text-[13px] font-bold">Müracaatçı Bilgisi</legend>
                    <div className="grid grid-cols-[106px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                      <label htmlFor="nofile-tc">TC Kimlikno</label>
                      <input
                        id="nofile-tc"
                        value={noFileEditForm.tc}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, tc: event.target.value.replace(/\D/g, '').slice(0, 11) }))}
                        maxLength={11}
                        inputMode="numeric"
                        className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-muracaat-eden">Müracaat Eden</label>
                      <input
                        id="nofile-muracaat-eden"
                        value={noFileEditForm.fullName}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, fullName: event.target.value }))}
                        required
                        maxLength={120}
                        className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-dogum-tarihi">Doğum Tarihi</label>
                      <input
                        id="nofile-dogum-tarihi"
                        type="date"
                        value={noFileEditForm.birthDate}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, birthDate: event.target.value }))}
                        className="h-5 w-44 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-telefon">Telefon</label>
                      <input
                        id="nofile-telefon"
                        value={noFileEditForm.phone}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, phone: event.target.value }))}
                        maxLength={20}
                        className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-iban">IBAN</label>
                      <input
                        id="nofile-iban"
                        value={noFileEditForm.iban}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, iban: event.target.value.toUpperCase() }))}
                        maxLength={45}
                        className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-aylik-gelir">Aylık Gelir</label>
                      <input
                        id="nofile-aylik-gelir"
                        type="number"
                        value={noFileEditForm.income}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, income: event.target.value }))}
                        className="h-5 w-24 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-mulkiyet">Mülkiyet Bilgisi</label>
                      <div className="flex flex-col gap-1">
                        <select
                          id="nofile-mulkiyet"
                          value={['Kendi Evi', 'Kira', 'Yakınının Evi', 'Lojman', 'Diğer'].includes(noFileEditForm.propertyInfo) ? noFileEditForm.propertyInfo : ''}
                          onChange={(event) => setNoFileEditForm((current) => ({ ...current, propertyInfo: event.target.value }))}
                          className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                        >
                          <option value=""></option>
                          <option value="Kendi Evi">Kendi Evi</option>
                          <option value="Kira">Kira</option>
                          <option value="Yakınının Evi">Yakınının Evi</option>
                          <option value="Lojman">Lojman</option>
                          <option value="Diğer">Diğer</option>
                        </select>
                        <input
                          value={noFileEditForm.propertyInfo}
                          onChange={(event) => setNoFileEditForm((current) => ({ ...current, propertyInfo: event.target.value }))}
                          maxLength={100}
                          placeholder="Manuel değer"
                          className="h-5 border border-sky-300 bg-sky-50/40 px-1 text-[12px] outline-none"
                        />
                      </div>

                      <label htmlFor="nofile-arac">Araç Modeli</label>
                      <input
                        id="nofile-arac"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={noFileEditForm.vehicleInfo}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, vehicleInfo: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                        placeholder="Örn. 2015"
                        className="h-5 w-24 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />
                    </div>
                  </fieldset>

                  <fieldset className="border border-slate-300 px-3 pb-3 pt-2">
                    <legend className="px-1 text-[13px] font-bold">Yardım Bilgisi</legend>
                    <div className="grid grid-cols-[106px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                      <label htmlFor="nofile-muracaat-tarihi">Müracaat Tarihi</label>
                      <input
                        id="nofile-muracaat-tarihi"
                        type="date"
                        value={noFileEditForm.applicationDate}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, applicationDate: event.target.value }))}
                        className="h-5 w-44 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-donem">Dönem</label>
                      {useCashPeriodOptions ? (
                        <div className="flex flex-col gap-1">
                          <select
                            id="nofile-donem"
                            value={resolvePredefinedSelectValue(noFileEditForm.period, cashPeriodOptions)}
                            onChange={(event) => {
                              const selected = cashPeriodOptions.find((option) => option.id === event.target.value)
                              setNoFileEditForm((current) => ({ ...current, period: selected?.name ?? event.target.value }))
                            }}
                            className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                          >
                            <option value=""></option>
                            {cashPeriodOptions.map((option) => (
                              <option key={option.id} value={option.id}>{option.name}</option>
                            ))}
                          </select>
                          {/* Kullanici istegi (2026-09-22): "dönem, etiket,
                              aşama gibi bazı veri alanları boş geliyor -
                              ne kadar veri var ise görünsün" - kaydin gercek
                              degeri (ör. "2026 KIRTASİYE") Hazir Degerler
                              listesinde YOKSA yukaridaki select bos gorunur
                              (hicbir <option> eslesmez); bu manuel alan
                              GERCEK degeri HER ZAMAN gosterir/duzenlenebilir
                              kilar - Toplu Guncelle/Basvuruyu Duzenle
                              pencerelerindeki AYNI desen. */}
                          <input
                            value={noFileEditForm.period}
                            onChange={(event) => setNoFileEditForm((current) => ({ ...current, period: event.target.value }))}
                            maxLength={50}
                            placeholder="Manuel değer"
                            className="h-5 border border-sky-300 bg-sky-50/40 px-1 text-[12px] outline-none"
                          />
                        </div>
                      ) : (
                        <input
                          id="nofile-donem"
                          value={noFileEditForm.period}
                          onChange={(event) => setNoFileEditForm((current) => ({ ...current, period: event.target.value }))}
                          maxLength={50}
                          className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                        />
                      )}

                      <label htmlFor="nofile-etiket">Etiket</label>
                      {useCashLabelOptions ? (
                        <div className="flex flex-col gap-1">
                          <select
                            id="nofile-etiket"
                            value={resolvePredefinedSelectValue(noFileEditForm.label, cashLabelOptions)}
                            onChange={(event) => {
                              const selected = cashLabelOptions.find((option) => option.id === event.target.value)
                              setNoFileEditForm((current) => ({ ...current, label: selected?.name ?? event.target.value }))
                            }}
                            className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                          >
                            <option value=""></option>
                            {cashLabelOptions.map((option) => (
                              <option key={option.id} value={option.id}>{option.name}</option>
                            ))}
                          </select>
                          <input
                            value={noFileEditForm.label}
                            onChange={(event) => setNoFileEditForm((current) => ({ ...current, label: event.target.value }))}
                            maxLength={100}
                            placeholder="Manuel değer"
                            className="h-5 border border-sky-300 bg-sky-50/40 px-1 text-[12px] outline-none"
                          />
                        </div>
                      ) : (
                        <input
                          id="nofile-etiket"
                          value={noFileEditForm.label}
                          onChange={(event) => setNoFileEditForm((current) => ({ ...current, label: event.target.value }))}
                          maxLength={100}
                          className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                        />
                      )}

                      <label htmlFor="nofile-miktar">Miktar</label>
                      <input
                        id="nofile-miktar"
                        type="number"
                        value={noFileEditForm.amount}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, amount: event.target.value }))}
                        className="h-5 w-24 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-aciklama">Açıklama</label>
                      <textarea
                        id="nofile-aciklama"
                        value={noFileEditForm.description}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, description: event.target.value }))}
                        className="h-14 resize-none border border-slate-300 bg-white px-1 py-0.5 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-ozel-kod">Özel Kod</label>
                      <input
                        id="nofile-ozel-kod"
                        value={noFileEditForm.specialCode}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, specialCode: event.target.value }))}
                        className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />
                    </div>
                  </fieldset>

                  <fieldset className="border border-slate-300 px-3 pb-3 pt-2">
                    <legend className="px-1 text-[13px] font-bold">Müracaat Aşamaları</legend>
                    <div className="grid grid-cols-[106px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                      <label htmlFor="nofile-durumu">Durumu</label>
                      {useCashStageOptions ? (
                        <div className="flex flex-col gap-1">
                          <select
                            id="nofile-durumu"
                            value={resolvePredefinedSelectValue(noFileEditForm.stage, cashStageOptions)}
                            onChange={(event) => {
                              const selected = cashStageOptions.find((option) => option.id === event.target.value)
                              setNoFileEditForm((current) => ({ ...current, stage: selected?.name ?? event.target.value }))
                            }}
                            className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                          >
                            <option value=""></option>
                            {cashStageOptions.map((option) => (
                              <option key={option.id} value={option.id}>{option.name}</option>
                            ))}
                          </select>
                          <input
                            value={noFileEditForm.stage}
                            onChange={(event) => setNoFileEditForm((current) => ({ ...current, stage: event.target.value }))}
                            maxLength={50}
                            placeholder="Manuel değer"
                            className="h-5 border border-sky-300 bg-sky-50/40 px-1 text-[12px] outline-none"
                          />
                        </div>
                      ) : (
                        <input
                          id="nofile-durumu"
                          value={noFileEditForm.stage}
                          onChange={(event) => setNoFileEditForm((current) => ({ ...current, stage: event.target.value }))}
                          maxLength={50}
                          className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                        />
                      )}

                      <label htmlFor="nofile-asama-aciklama">Açıklama</label>
                      <textarea
                        id="nofile-asama-aciklama"
                        value={noFileEditForm.stageDescription}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, stageDescription: event.target.value }))}
                        className="h-14 resize-none border border-slate-300 bg-white px-1 py-0.5 text-[12px] outline-none"
                      />

                      <label htmlFor="nofile-asama-ozel-kod">Özel Kod</label>
                      <input
                        id="nofile-asama-ozel-kod"
                        value={noFileEditForm.stageCode}
                        onChange={(event) => setNoFileEditForm((current) => ({ ...current, stageCode: event.target.value }))}
                        className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                      />
                    </div>
                  </fieldset>
                </div>

                <div className="space-y-3">
                  <fieldset className="border border-sky-300 bg-sky-50/40 px-3 pb-3 pt-2">
                    <legend className="px-1 text-[13px] font-bold text-sky-800">Müracaat Sırasında Verilen Bilgiler</legend>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 border-b border-sky-100 py-0.5 text-[12px]">
                        <span className="font-semibold text-slate-700">Aylık Gelir</span>
                        <span className="font-black text-sky-700">{noFileEditForm.income.trim() || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-sky-100 py-0.5 text-[12px]">
                        <span className="font-semibold text-slate-700">Mülkiyet Bilgisi</span>
                        <span className="font-black text-sky-700">{noFileEditForm.propertyInfo.trim() || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 py-0.5 text-[12px]">
                        <span className="font-semibold text-slate-700">Araç Modeli</span>
                        <span className="font-black text-sky-700">{noFileEditForm.vehicleInfo.trim() || '-'}</span>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="border border-violet-300 bg-violet-50/40 px-3 pb-3 pt-2">
                    <legend className="px-1 text-[13px] font-bold text-violet-800">Diğer Kurumlardan Alınan Yardımlar</legend>
                    <p className="py-1 text-[12px] font-semibold text-slate-500">
                      {noFileEditForm.hasFile
                        ? 'Bu bilgiyi görüntülemek için Dosya Yönetimi ekranını kullanın.'
                        : 'Bu müracaat bir dosyaya bağlı olmadığı için bu bilgi mevcut değil.'}
                    </p>
                  </fieldset>

                  <fieldset className="border border-amber-300 bg-amber-50/40 px-3 pb-3 pt-2">
                    <legend className="px-1 text-[13px] font-bold text-amber-800">Belgelerden Alınan Bilgiler</legend>
                    <p className="py-1 text-[12px] font-semibold text-slate-500">
                      {noFileEditForm.hasFile
                        ? 'Bu bilgiyi görüntülemek için Dosya Yönetimi ekranını kullanın.'
                        : 'Bu müracaat bir dosyaya bağlı olmadığı için bu bilgi mevcut değil.'}
                    </p>
                  </fieldset>
                </div>
              </div>

              {noFileEditStatus && (
                <div className="mt-4 rounded-lg border-2 border-rose-300 bg-rose-50 px-3 py-2.5 text-[12px] font-bold text-rose-700">
                  {noFileEditStatus}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t-2 border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white px-5 py-3">
              <button
                type="submit"
                disabled={isSavingNoFileEdit}
                className="inline-flex items-center gap-2 rounded-lg border-2 border-rose-200 bg-white px-5 py-2.5 text-[15px] font-extrabold text-rose-800 shadow-sm transition-colors disabled:cursor-wait disabled:opacity-60"
              >
                {isSavingNoFileEdit ? 'Kaydediliyor...' : 'Kaydet (F2)'}
              </button>
              <button
                type="button"
                onClick={() => setNoFileEditModalOpen(false)}
                disabled={isSavingNoFileEdit}
                className="inline-flex items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 py-2.5 text-[15px] font-extrabold text-slate-600 hover:bg-slate-100"
              >
                Kapat
              </button>
            </div>
          </form>
        </div>
      )}

      {recordUpdateConfig && recordUpdateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 print:hidden">
          <form onSubmit={updateRecordFields} className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-[16px] font-black uppercase text-slate-700">Kayıt Bilgisi Güncelle</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">{recordUpdateConfig.label || 'Durum, donem, etiket, asama ve personel'}</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">Bos birakilan alanlar guncellenmez.</p>
            </div>

            <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              Guncellenecek secili kayit: {selectedDisplayCount}
            </div>

            {actionStatus && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-sm font-bold ${
                actionStatus.includes('guncellendi')
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                {actionStatus}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {recordUpdateFields.includes('durumu') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Durumu</span>
                <select
                  value={recordUpdateForm.durumu}
                  onChange={(event) => setRecordUpdateForm((current) => ({ ...current, durumu: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                >
                  <option value="">Degistirme</option>
                  {Object.entries(statusMap).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              )}

              {recordUpdateFields.includes('donem') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Donem</span>
                {useCashPeriodOptions ? (
                  <div className="grid gap-2">
                    <select
                      value={resolvePredefinedSelectValue(recordUpdateForm.donem, cashPeriodOptions)}
                      onChange={(event) => {
                        const selected = cashPeriodOptions.find((option) => option.id === event.target.value)
                        setRecordUpdateForm((current) => ({ ...current, donem: selected?.name || '' }))
                      }}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                    >
                      <option value="">Listeden seçin</option>
                      {cashPeriodOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <input value={recordUpdateForm.donem} onChange={(event) => setRecordUpdateForm((current) => ({ ...current, donem: event.target.value }))} maxLength={50} placeholder="Manuel değer girin" className="w-full rounded-md border border-sky-300 bg-sky-50/40 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-sky-600" />
                  </div>
                ) : (
                  <input
                    value={recordUpdateForm.donem}
                    onChange={(event) => setRecordUpdateForm((current) => ({ ...current, donem: event.target.value }))}
                    maxLength={50}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                  />
                )}
              </label>
              )}

              {recordUpdateFields.includes('etiket') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Etiket</span>
                {useCashLabelOptions ? (
                  <div className="grid gap-2">
                    <select
                      value={resolvePredefinedSelectValue(recordUpdateForm.etiket, cashLabelOptions)}
                      onChange={(event) => {
                        const selected = cashLabelOptions.find((option) => option.id === event.target.value)
                        setRecordUpdateForm((current) => ({ ...current, etiket: selected?.name || '' }))
                      }}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                    >
                      <option value="">Listeden seçin</option>
                      {cashLabelOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <input value={recordUpdateForm.etiket} onChange={(event) => setRecordUpdateForm((current) => ({ ...current, etiket: event.target.value }))} maxLength={100} placeholder="Manuel değer girin" className="w-full rounded-md border border-sky-300 bg-sky-50/40 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-sky-600" />
                  </div>
                ) : (
                  <input
                    value={recordUpdateForm.etiket}
                    onChange={(event) => setRecordUpdateForm((current) => ({ ...current, etiket: event.target.value }))}
                    maxLength={100}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                  />
                )}
              </label>
              )}

              {recordUpdateFields.includes('asama') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Asama</span>
                {useCashStageOptions ? (
                  <div className="grid gap-2">
                    <select
                      value={resolvePredefinedSelectValue(recordUpdateForm.asama, cashStageOptions)}
                      onChange={(event) => {
                        const selected = cashStageOptions.find((option) => option.id === event.target.value)
                        setRecordUpdateForm((current) => ({ ...current, asama: selected?.name || '' }))
                      }}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                    >
                      <option value="">Listeden seçin</option>
                      {cashStageOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <input value={recordUpdateForm.asama} onChange={(event) => setRecordUpdateForm((current) => ({ ...current, asama: event.target.value }))} maxLength={50} placeholder="Manuel değer girin" className="w-full rounded-md border border-sky-300 bg-sky-50/40 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-sky-600" />
                  </div>
                ) : (
                  <input
                    value={recordUpdateForm.asama}
                    onChange={(event) => setRecordUpdateForm((current) => ({ ...current, asama: event.target.value }))}
                    maxLength={50}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                  />
                )}
              </label>
              )}

              {recordUpdateFields.includes('miktar') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Miktar</span>
                <div className="grid gap-2">
                  {cashAmountOptions.length > 0 && (
                    <select
                      value={cashAmountOptions.some((option) => option.value === recordUpdateForm.miktar) ? recordUpdateForm.miktar : ''}
                      onChange={(event) => setRecordUpdateForm((current) => ({ ...current, miktar: event.target.value }))}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                    >
                      <option value="">Listeden seçin</option>
                      {cashAmountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  )}
                  <input value={recordUpdateForm.miktar} onChange={(event) => setRecordUpdateForm((current) => ({ ...current, miktar: event.target.value.replace(/[^\d.,]/g, '') }))} inputMode="decimal" maxLength={30} placeholder="Manuel miktar girin" className="w-full rounded-md border border-sky-300 bg-sky-50/40 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-sky-600" />
                </div>
              </label>
              )}

              {recordUpdateFields.includes('tahkikatpers') && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Tahkikat Personeli</span>
                <div className={isCashStageContext ? 'grid gap-2' : ''}>
                <select
                  value={recordUpdateForm.tahkikatpers}
                  onChange={(event) => setRecordUpdateForm((current) => ({ ...current, tahkikatpers: event.target.value }))}
                  disabled={personnelLoading}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                >
                  <option value="">{personnelLoading ? 'Personeller yukleniyor...' : 'Degistirme'}</option>
                  {recordUpdateForm.tahkikatpers && !personnelOptions.some((personnel) => personnel.name === recordUpdateForm.tahkikatpers) && (
                    <option value={recordUpdateForm.tahkikatpers}>{recordUpdateForm.tahkikatpers}</option>
                  )}
                  {personnelOptions.map((personnel) => (
                    <option key={personnel.id} value={personnel.name}>
                      {personnel.name}
                    </option>
                  ))}
                </select>
                {isCashStageContext && (
                  <input
                    value={recordUpdateForm.tahkikatpers}
                    onChange={(event) => setRecordUpdateForm((current) => ({ ...current, tahkikatpers: event.target.value }))}
                    maxLength={100}
                    placeholder="Manuel personel adı girin"
                    className="w-full rounded-md border border-sky-300 bg-sky-50/40 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-sky-600"
                  />
                )}
                </div>
              </label>
              )}

              {recordUpdateFields.includes('tarih') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Tarih</span>
                <input
                  type="date"
                  value={recordUpdateForm.tarih}
                  onChange={(event) => setRecordUpdateForm((current) => ({ ...current, tarih: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                />
              </label>
              )}

              {recordUpdateFields.includes('kurban_turu') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Kurban Turu</span>
                <select
                  value={recordUpdateForm.kurban_turu}
                  onChange={(event) => setRecordUpdateForm((current) => ({ ...current, kurban_turu: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                >
                  <option value="">Degistirme</option>
                  <option value="Vekaleten Kurban Kesimi">Vekaleten Kurban Kesimi</option>
                  <option value="Vacip Kurban Kesimi">Vacip Kurban Kesimi</option>
                </select>
              </label>
              )}

              {recordUpdateFields.includes('kurban_cinsi') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Kurban Cinsi</span>
                <select
                  value={recordUpdateForm.kurban_cinsi}
                  onChange={(event) => setRecordUpdateForm((current) => ({ ...current, kurban_cinsi: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                >
                  <option value="">Degistirme</option>
                  <option value="Küçük Baş Kurban">Küçük Baş Kurban</option>
                  <option value="Büyük Baş Kurban">Büyük Baş Kurban</option>
                </select>
              </label>
              )}

              {recordUpdateFields.includes('adet') && (
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Adet</span>
                <input
                  value={recordUpdateForm.adet}
                  onChange={(event) => setRecordUpdateForm((current) => ({ ...current, adet: event.target.value.replace(/\D/g, '') }))}
                  inputMode="numeric"
                  maxLength={10}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-slate-800"
                />
              </label>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordUpdateModalOpen(false)}
                disabled={isUpdatingRecord}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Vazgec
              </button>
              <button
                type="submit"
                disabled={isUpdatingRecord}
                className="rounded-md bg-slate-800 px-4 py-2 text-[16px] font-black text-white hover:bg-slate-950 disabled:cursor-wait disabled:opacity-60"
              >
                {isUpdatingRecord ? 'Kaydediliyor...' : 'Guncelle'}
              </button>
            </div>
          </form>
        </div>
      )}
      {cancelConfig && cancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm print:hidden">
          <form onSubmit={cancelSelectedRow} className="w-full max-w-lg overflow-hidden rounded-2xl border-2 border-rose-200 bg-white shadow-2xl">
            <div className="flex items-center gap-3 bg-gradient-to-r from-rose-600 via-rose-500 to-orange-500 px-6 py-5 text-white">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
                ⛔
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-black uppercase tracking-wide text-white/80">
                  {cancelTargetCount > 1 ? 'Toplu Müracaat İptali' : 'Müracaat İptali'}
                </p>
                <h2 className="mt-0.5 text-lg font-black leading-tight">
                  {cancelTargetCount} kayıt iptal edilecek
                </h2>
                {allFilteredSelected && (
                  <p className="mt-0.5 text-[12px] font-bold text-white/80">Filtrelenen tüm sayfalardaki kayıtlar dahildir.</p>
                )}
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              {allFilteredSelected ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-bold text-amber-800">
                  ⚠️ Bu kayıtlardan &quot;Otomatik Red&quot; aşamasında olanlar için aşağıdaki metin yerine kaydın kendi otomatik red açıklaması iptal nedeni olarak kullanılacak. Diğer tüm kayıtlar için aşağıdaki metin kullanılacak.
                </div>
              ) : cancelAutoReasonCount > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-bold text-amber-800">
                  ⚠️ {cancelAutoReasonCount} kayıt &quot;Otomatik Red&quot; aşamasında - bunlar için aşağıdaki metin yerine kaydın kendi otomatik red açıklaması iptal nedeni olarak kullanılacak.
                  {cancelManualReasonCount > 0 && ` Kalan ${cancelManualReasonCount} kayıt için aşağıdaki metin kullanılacak.`}
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-[13px] font-black uppercase tracking-wide text-slate-600">İptal Tarihi</span>
                <input
                  type="date"
                  value={cancelDate}
                  onChange={(event) => setCancelDate(event.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] font-bold text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[13px] font-black uppercase tracking-wide text-slate-600">
                  İptal Nedeni {!cancelReasonRequired && <span className="normal-case text-slate-400">(bu seçimde kullanılmayacak)</span>}
                </span>
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  required={cancelReasonRequired}
                  disabled={!cancelReasonRequired}
                  maxLength={100}
                  rows={4}
                  placeholder={!cancelReasonRequired ? 'Tüm seçili kayıtlar otomatik red açıklamasını kullanacak.' : 'Örn: Belge eksikliği, hak sahibi vazgeçti, vb.'}
                  className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] font-bold text-slate-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </label>

              {actionStatus && (
                <div className={`rounded-lg border px-4 py-2.5 text-sm font-bold ${
                  actionStatus.includes('iptal edildi')
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}>
                  {actionStatus}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                disabled={isCancelling}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[14px] font-black text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={isCancelling}
                className="rounded-lg bg-gradient-to-r from-rose-600 to-orange-600 px-5 py-2.5 text-[14px] font-black text-white shadow-sm transition hover:from-rose-700 hover:to-orange-700 disabled:cursor-wait disabled:opacity-60"
              >
                {isCancelling ? 'Kaydediliyor...' : `İptal Et (${cancelTargetCount})`}
              </button>
            </div>
          </form>
        </div>
      )}

      {personnelAssignConfig && personnelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 print:hidden">
          <form onSubmit={assignPersonnel} className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-[16px] font-black uppercase text-[#0076b6]">Personel Ata</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">Kayıtlı personeller</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">Secili kayit: {selectedRows.length}</p>
            </div>

            {actionStatus && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-sm font-bold ${
                actionStatus.includes('atandi')
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                {actionStatus}
              </div>
            )}

            <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              {personnelLoading ? (
                <div className="px-3 py-6 text-center text-sm font-bold text-slate-500">Personeller yukleniyor...</div>
              ) : personnelOptions.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm font-bold text-slate-500">Kayıtlı personel bulunamadı.</div>
              ) : (
                personnelOptions.map((personnel) => (
                  <label
                    key={personnel.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm font-bold ${
                      selectedPersonnel === personnel.name
                        ? 'border-[#0076b6] bg-white text-[#005f95]'
                        : 'border-transparent bg-white text-slate-700 hover:border-slate-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="personnel"
                      value={personnel.name}
                      checked={selectedPersonnel === personnel.name}
                      onChange={(event) => setSelectedPersonnel(event.target.value)}
                      className="h-4 w-4 border-slate-300 text-[#0076b6]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{personnel.name}</span>
                      {personnel.username && (
                        <span className="block truncate text-[11px] font-semibold text-slate-400">{personnel.username}</span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>

            {/* Kullanici istegi/hata raporu (2026-09-12): "kayıtlı personeli
                seçince kaydediyor ama manuel bir değer yazınca sanki bu
                isimde personel yok diye güncellemiyor" - kok neden, bu
                pencerenin sadece listeden secim (radio) sunmasi, sistemde
                KAYITLI OLMAYAN (ör. gecici/dis kurum) bir tahkikatci ismini
                yazmanin FIZIKSEL OLARAK mumkun olmamasiydi - backend
                (/api/assistance/nakit/personnel) zaten HERHANGI bir serbest
                metni (personel dogrulamasi yapmadan) kaydediyordu, engel
                sadece arayuzdeydi. "Kayıt Güncelle" penceresindeki
                "Manuel deger girin" deseniyle AYNI mantik burada da eklendi. */}
            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-black uppercase text-slate-500">Ya da manuel personel adı girin</span>
              <input
                value={selectedPersonnel}
                onChange={(event) => setSelectedPersonnel(event.target.value)}
                maxLength={100}
                placeholder="Kayıtlı listede olmayan bir isim yazın"
                className="w-full rounded-md border border-sky-300 bg-sky-50/40 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-sky-600"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPersonnelModalOpen(false)}
                disabled={isAssigningPersonnel}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Vazgec
              </button>
              <button
                type="submit"
                disabled={isAssigningPersonnel || personnelLoading || !selectedPersonnel}
                className="rounded-md bg-[#0076b6] px-4 py-2 text-[16px] font-black text-white hover:bg-[#00649b] disabled:cursor-wait disabled:opacity-60"
              >
                {isAssigningPersonnel ? 'Kaydediliyor...' : 'Ata'}
              </button>
            </div>
          </form>
        </div>
      )}

      {copyConfig && copyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 print:hidden">
          <form onSubmit={copyRecords} className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-[16px] font-black uppercase text-indigo-600">Kayıt Kopyala</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">Yeni kayit bilgileri</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {allFilteredSelected
                  ? `Kopyalanacak filtrelenen toplam kayit: ${totalCount}`
                  : selectedRows.length > 0
                  ? `Secili kayit: ${selectedRows.length} / Filtrelenen toplam: ${totalCount}`
                  : `Kopyalanacak filtrelenen toplam kayit: ${totalCount}`}
              </p>
            </div>

            <div className="mb-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              {selectedRows.length > 0 && !allFilteredSelected && (
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="copyMode"
                      value="selected"
                      checked={copyMode === 'selected'}
                      onChange={() => setCopyMode('selected')}
                      className="h-4 w-4 border-slate-300 text-indigo-600"
                    />
                    Secilen kayitlari kopyala
                  </span>
                  <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-indigo-100 px-2.5 py-1 text-[16px] font-black text-indigo-700">
                    {selectedRows.length}
                  </span>
                </label>
              )}
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded bg-white px-3 py-2 text-sm font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="copyMode"
                    value="filtered"
                    checked={copyMode === 'filtered' || selectedRows.length === 0 || allFilteredSelected}
                    onChange={() => setCopyMode('filtered')}
                    className="h-4 w-4 border-slate-300 text-indigo-600"
                  />
                  Filtrelenen tum kayitlari kopyala
                </span>
                <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-sky-100 px-2.5 py-1 text-[16px] font-black text-sky-700">
                  {totalCount}
                </span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Donem</span>
                <input
                  list={useCashPeriodOptions ? 'copy-cash-period-options' : undefined}
                  value={copyForm.donem}
                  onChange={(event) => setCopyForm((current) => ({ ...current, donem: event.target.value }))}
                  required
                  maxLength={50}
                  placeholder="Listeden seçin veya yazın"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                />
                {useCashPeriodOptions && (
                  <datalist id="copy-cash-period-options">
                    {cashPeriodOptions.map((option) => <option key={option.id} value={option.name} />)}
                  </datalist>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Etiket</span>
                <input
                  list={useCashLabelOptions ? 'copy-cash-label-options' : undefined}
                  value={copyForm.etiket}
                  onChange={(event) => setCopyForm((current) => ({ ...current, etiket: event.target.value }))}
                  required
                  maxLength={100}
                  placeholder="Listeden seçin veya yazın"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                />
                {useCashLabelOptions && (
                  <datalist id="copy-cash-label-options">
                    {cashLabelOptions.map((option) => <option key={option.id} value={option.name} />)}
                  </datalist>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Asama</span>
                <input
                  list={useCashStageOptions ? 'copy-cash-stage-options' : undefined}
                  value={copyForm.asama}
                  onChange={(event) => setCopyForm((current) => ({ ...current, asama: event.target.value }))}
                  required
                  maxLength={50}
                  placeholder="Listeden seçin veya yazın"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                />
                {useCashStageOptions && (
                  <datalist id="copy-cash-stage-options">
                    {cashStageOptions.map((option) => <option key={option.id} value={option.name} />)}
                  </datalist>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-[16px] font-black uppercase text-slate-600">Durum</span>
                <select
                  value={copyForm.durumu}
                  onChange={(event) => setCopyForm((current) => ({ ...current, durumu: event.target.value }))}
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-bold text-slate-950 outline-none focus:border-[#0076b6]"
                >
                  <option value="">Secin</option>
                  {Object.entries(statusMap).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                disabled={isCopying}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[16px] font-black text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
              >
                Vazgec
              </button>
              <button
                type="submit"
                disabled={isCopying}
                className="rounded-md bg-indigo-600 px-4 py-2 text-[16px] font-black text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
              >
                {isCopying ? 'Kopyalaniyor...' : 'Kopyala'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className={`border bg-white p-4 ${organizedToolbar ? 'rounded-2xl border-sky-200 shadow-[0_14px_35px_rgba(15,23,42,0.08)]' : 'rounded-xl border-slate-200 shadow-sm'}`}>
          {/* Kullanici istegi: kayit olmasa (filtre sonucu bos donse) bile
              sutun basliklari - ve icindeki filtre/siralama kontrolleri -
              KAYBOLMASIN diye tablo ARTIK HER ZAMAN render edilir; "kayit
              yok" mesaji artik AdvancedTable'in kendi govdesinde, baslik
              ALTINDA gosterilir (bkz. emptyMessage prop). */}
          {groupByColumn ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
              {/* Kullanici istegi (2026-09-30): "Grupla" acikken altta cikan
                  liste (grup basligi + acilinca goruen ic ice tablo), sayfanin
                  geri kalaniyla (navy/beyaz "kurumsal" tema, Excel tarzi izgara,
                  ~11-12.5px yazi olcegi) AYNI dile kavusturuldu - eskiden duz
                  gri bir serit, siyah 16px yazilar ve TAMAMEN renksiz/izgarasiz
                  bir ic tablo (sadece alt cizgiler) idi. */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
                <p className="text-[14.5px] font-semibold uppercase tracking-wide text-[#1E2A38]">
                  {groupColumnLabel} alanına göre gruplandı
                  {groupedSections && ` — ${groupedSections.length} grup, toplam ${groupSourceRows?.length ?? 0} kayıt`}
                </p>
                <div className="flex items-center gap-2">
                  {groupedSections && groupedSections.length > 0 && (
                    <>
                      {/* Kullanici istegi: gruplar, grup icindeki kayit
                          SAYISINA gore de siralanabilsin. */}
                      <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[14px] font-bold text-[#1E2A38]">
                        <span className="shrink-0 text-slate-400">Sırala:</span>
                        <select
                          value={groupSortMode}
                          onChange={(event) => setGroupSortMode(event.target.value as typeof groupSortMode)}
                          className="cursor-pointer border-none bg-transparent text-[14px] font-bold text-[#1E2A38] outline-none"
                        >
                          <option value="label">Grup Adına Göre</option>
                          <option value="count-desc">Kayıt Sayısı (Çoktan Aza)</option>
                          <option value="count-asc">Kayıt Sayısı (Azdan Çoğa)</option>
                          <option value="sum-desc">Toplam Miktar (Çoktan Aza)</option>
                          <option value="sum-asc">Toplam Miktar (Azdan Çoğa)</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => setExpandedGroups(new Set(groupedSections.map((section) => section.label)))}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[14px] font-bold text-[#1E2A38] hover:bg-slate-50"
                      >
                        Tümünü Aç
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedGroups(new Set())}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[14px] font-bold text-[#1E2A38] hover:bg-slate-50"
                      >
                        Tümünü Kapat
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setGroupByColumn('')}
                    className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[14px] font-bold text-rose-600 hover:bg-rose-50"
                  >
                    Gruplamayı Kaldır
                  </button>
                </div>
              </div>

              {isLoadingGroups ? (
                <div className="p-8 text-center text-sm font-bold text-slate-500">Kayıtlar gruplanıyor...</div>
              ) : groupsError ? (
                <div className="p-8 text-center text-sm font-bold text-rose-600">{groupsError}</div>
              ) : groupedSections && groupedSections.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {groupedSections.map((section) => {
                    const isExpanded = expandedGroups.has(section.label)
                    return (
                      <div key={section.label}>
                        <button
                          type="button"
                          onClick={() => toggleGroupExpanded(section.label)}
                          className="flex w-full items-center justify-between gap-3 bg-white px-4 py-2.5 text-left transition hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2 text-[15px] font-semibold text-[#1E2A38]">
                            <span className={`inline-block text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
                            {groupColumnLabel}: {section.label}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded-full bg-[#1E2A38] px-2.5 py-0.5 text-[13px] font-bold text-white">{section.count} kayıt</span>
                            {section.sum !== 0 && (
                              <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[13px] font-bold text-white">Toplam: {section.sum.toLocaleString('tr-TR')}</span>
                            )}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="overflow-x-auto border-t border-slate-200">
                            <table className="w-full border-collapse whitespace-nowrap text-left text-[15px]">
                              <thead className="bg-gradient-to-r from-[#0c6f9e] via-[#127f92] to-[#1c9a7a] text-white">
                                <tr>
                                  {reportColumns.map((column) => (
                                    <th key={column.key} className="border-b border-r border-white/35 px-3 py-2.5 text-[13.5px] font-semibold uppercase tracking-wide last:border-r-0">{column.label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {section.rows.map((row, index) => (
                                  <tr
                                    key={String(row.id ?? index)}
                                    onClick={() => (onlineApplicationEditConfig ? openOnlineApplicationEditModal(row) : undefined)}
                                    onDoubleClick={() => handleRowDoubleClick(row)}
                                    className={`cursor-pointer transition-colors hover:bg-[#f1faed] ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                                  >
                                    {reportColumns.map((column) => (
                                      <td key={column.key} className="border-b border-r border-slate-200 px-3 py-2.5 font-medium text-slate-800 last:border-r-0">
                                        {String(resolveReportCellValue(column.key, row[column.key] as string | number | null | undefined) ?? '-')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="p-8 text-center text-sm font-bold text-slate-500">Gruplanacak kayıt bulunamadı.</div>
              )}
            </div>
          ) : (
          <AdvancedTable
            key={`${tableKey || tableId}-${filterSignature}`}
            data={data}
            tableId={tableId}
            emptyMessage={emptyMessage}
            statusMap={statusMap}
            excludedColumns={excludedColumns}
            requiredVisibleColumns={requiredVisibleColumns}
            preferredColumnOrder={preferredColumnOrder}
            extraFilterColumns={extraFilterColumns}
            columnLabels={columnLabels}
            fileStatusColumns={['dosya_durumu', 'fileStatus', 'dosyaDurumu', 'ddurumu']}
            assistanceStatusColumns={['durumu', 'yardim_durumu', 'assistanceStatus', 'yardimDurumu', 'ydurumu']}
            stageColumns={['asama', 'aşama', 'stage']}
            assistanceStatusVariant={assistanceStatusVariant}
            maritalStatusColumns={['medeniHali', 'medenihali', 'medeni_hal', 'maritalStatus', 'marital_status', 'medeniDurum']}
            relationshipColumns={['yakinligi', 'yakinlik', 'yakinlik_derecesi', 'yakinlikDerecesi', 'yakınlığı', 'yakınlık', 'yakınlıkDerecesi', 'relation', 'relationship', 'relationStatus', 'relationshipStatus']}
            filterValueOptions={filterValueOptions}
            columnTotals={columnTotals}
            columnTotalsLabel={columnTotalsLabel}
            columnReorderingControls={columnReorderingControls}
            onRowClick={onlineApplicationEditConfig ? openOnlineApplicationEditModal : undefined}
            onRowDoubleClick={handleRowDoubleClick}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={(ids) => {
              setAllFilteredSelectedScope('')
              setSelectedRowIds(ids)
            }}
            getRowId={(row, index) => String(row.id ?? index)}
            showRowNumber
            rowNumberStart={firstRecord || 1}
            compactText={compactText}
            serverSideFiltering
            serverSideSorting
            sortSpecs={parseSortParam(searchParams.get('sort'))}
            onSortChange={(specs) => {
              const params = new URLSearchParams(searchParams.toString())
              if (specs.length > 0) params.set('sort', encodeSortParam(specs))
              else params.delete('sort')
              params.delete('dir')
              params.set('page', '1')
              router.push(`?${params.toString()}`)
            }}
          />
          )}

        {!groupByColumn && (
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 print:hidden md:flex-row md:items-center md:justify-between">
          <div className="text-xs font-bold text-slate-500">
            Sayfa {currentPage} / {totalPages} (Toplam {totalCount} kayıt)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(buildPageUrl(routePath, searchParams, currentPage - 1, searchTerm))}
              disabled={!canGoPrevious}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() => router.push(buildPageUrl(routePath, searchParams, currentPage + 1, searchTerm))}
              disabled={!canGoNext}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            >
              Sonraki
            </button>
            <form onSubmit={goToPage} className="flex items-center gap-2">
              <input
                key={currentPage}
                name="page"
                type="number"
                min={1}
                max={totalPages}
                defaultValue={currentPage}
                className="w-20 rounded border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-[#0076b6]"
                aria-label="Sayfa numarası"
              />
              <button
                type="submit"
                className="rounded border border-[#0076b6] bg-white px-3 py-1.5 text-xs font-extrabold text-[#0076b6] transition-colors hover:bg-[#eaf7fd]"
              >
                Sayfaya Git
              </button>
            </form>
          </div>
        </div>
        )}
      </div>

      <ColumnPickerReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title={title}
        reportHeading={title}
        columns={reportColumns}
        scopes={reportScopes}
        fetchRows={fetchReportRows}
        fileNamePrefix={exportFilePrefix}
        resolveCellValue={resolveReportCellValue}
      />
    </div>
  )
}
