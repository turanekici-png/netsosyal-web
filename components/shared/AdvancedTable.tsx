'use client'

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatDate, formatFileNo, foldTurkish, isDateField, MULTI_VALUE_FILTER_SEPARATOR } from '@/lib/utils'
import { type SortSpec, toggleSortSpec } from '@/lib/sortSpec'
import {
  DEFAULT_PREDEFINED_VALUES,
  normalizePredefinedText,
  type PredefinedValue,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import { fetchPredefinedValuesOnce } from '@/lib/hooks/predefinedValuesClient'
import { useListAutoRefresh } from '@/lib/hooks/useListAutoRefresh'

interface Column {
  key: string
  label: string
  visible: boolean
  order: number
  // Kullanici istegi: sutun genislikleri elle (surukleyerek) ayarlanabilsin
  // - belirtilmemisse (undefined) sutun eskisi gibi icerige gore otomatik
  // genislikte kalir (bkz. <colgroup> render'i).
  width?: number
}

interface AdvancedTableProps {
  data: any[]
  tableId: string
  statusMap?: Record<string, string>
  excludedColumns?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRowClick?: (row: any) => void
  onRowDoubleClick?: (row: any) => void
  selectable?: boolean
  selectedRowIds?: string[]
  selectedRowHighlightClassName?: string
  // Kullanici istegi: bir satira, satirin verisine gore ozel bir sinif
  // verilebilsin (ör. olum tarihi olan bireyi SIYAH gostermek). Bos string
  // dondururse satir normal (zebra) gorunumde kalir. Doldururса o sinif
  // zebra zemininin YERINE gecer ve hover devre disi kalir.
  rowClassName?: (row: any, index: number) => string
  onSelectedRowIdsChange?: (ids: string[]) => void
  getRowId?: (row: any, index: number) => string
  preferredColumnOrder?: string[]
  columnLabels?: Record<string, string>
  requiredVisibleColumns?: string[]
  extraFilterColumns?: string[]
  filterValueOptions?: Record<string, ColumnValueOption[]>
  // Kullanici istegi: "Miktar", "Yardım Kişi Sayısı" gibi sayisal sutunlarin
  // TOPLAMI listenin ALTINDA gorunsun - bkz. asagidaki <tfoot>. Deger,
  // sunucu tarafinda TUM FILTRELENMIS veri kumesi (sadece ekrandaki sayfa
  // DEGIL) uzerinden hesaplanip gecirilir. Sadece bu map'te anahtari olan
  // sutunlar icin toplam gosterilir, digerleri bos kalir.
  columnTotals?: Record<string, number>
  columnTotalsLabel?: string
  showRowNumber?: boolean
  rowNumberStart?: number
  serverSideFiltering?: boolean
  serverSideSorting?: boolean
  // Kullanici istegi: baslikta bir sutuna tikla = o sutuna gore sirala,
  // Shift+tikla = mevcut siralamaya EK bir kademe (2., 3. siralama olcutu)
  // olarak ekle - bu yuzden TEK bir {key,direction} yerine SIRALI bir
  // SortSpec dizisi tutulur (bkz. lib/sortSpec.ts).
  sortSpecs?: SortSpec[]
  onSortChange?: (specs: SortSpec[]) => void
  fileStatusColumns?: string[]
  fileStatusVariant?: 'default' | 'solid'
  assistanceStatusColumns?: string[]
  assistanceStatusVariant?: 'default' | 'dgn'
  maritalStatusColumns?: string[]
  genderColumns?: string[]
  relationshipColumns?: string[]
  columnReorderingControls?: boolean
  // Kullanici istegi: filtre/sonuc bos oldugunda bile sutun basliklari
  // (ve icindeki filtre/siralama kontrolleri) KAYBOLMASIN - eskiden cagiran
  // sayfalar veri yoksa AdvancedTable'i hic RENDER ETMIYOR, yerine ayri bir
  // "kayit bulunamadi" mesaji gosteriyordu; bu da basligi da goturuyordu.
  // Artik tablo HER ZAMAN render edilir, veri yoksa bu mesaj govde (tbody)
  // icinde, baslik ALTINDA gosterilir - bkz. asagidaki bos-durum satiri.
  emptyMessage?: string
  // Kullanici istegi: "Aşama" gibi metinsel (Uygundur/Uygun Değil/
  // Otomatik Red/İncelenecek) durum sutunlari renkli rozet olarak
  // gosterilsin - bkz. getStageBadgeClass.
  stageColumns?: string[]
  // Kullanici istegi (15 Eylul 2026, 44. tur): "yardım müracaatı alanlarında
  // veriler büyük, alan küçük - veriler tam okunmuyor, yazı puntosunu
  // küçült" - SADECE bunu isteyen sayfalar (bkz. AssistanceRequestListPage.tsx)
  // bu bayragi TRUE gecer; varsayilan FALSE, yani Dosya Yönetimi/diğer TÜM
  // AdvancedTable kullanan ekranlar (bkz. memory "tipografi-tutarlilik-sistemi"
  // - AdvancedTable'a BİLİNÇLİ dokunulmamıştı) ETKİLENMEZ.
  compactText?: boolean
}

const OPERATORS = [
  { id: 'contains', label: 'İçerir' },
  { id: 'not_contains', label: 'İçermez' },
  { id: 'eq', label: 'Eşittir (=)' },
  { id: 'neq', label: 'Eşit Değil (!=)' },
  { id: 'empty', label: 'Boş' },
  { id: 'not_empty', label: 'Boş Değil' },
  { id: 'starts', label: 'İle Başlar' },
  { id: 'ends', label: 'İle Biter' },
  { id: 'gt', label: 'Büyüktür (>)' },
  { id: 'lt', label: 'Küçüktür (<)' },
  { id: 'gte', label: 'Büyük Eşit (>=)' },
  { id: 'lte', label: 'Küçük Eşit (<=)' },
  { id: 'between', label: 'Arasında' },
]

type ColumnFilter = { value: string; op: string; value2?: string }
type ColumnValueOption = { value: string; label: string; count: number }

const EMPTY_COLUMNS: string[] = []
const EMPTY_SORT_SPECS: SortSpec[] = []
const VALUELESS_FILTER_OPERATORS = new Set(['empty', 'not_empty'])
const collator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' })
const numericTextPattern = /^-?\d+$/
// Kisa/sabit bicimli "kod gibi" degerler (dosya no, kayit no, dosyaid,
// TC kimlik no, kart no, inceleme puani, cinsiyet, yakinlik, medeni hali,
// adres no, tarih) sola dayali degil, sutun icinde ORTALI gosterilir.
const CENTERED_SHORT_VALUE_COLUMNS = new Set([
  'no', 'id', 'dosyaId', 'dosyaid', 'dosyaNo', 'dosyano', 'kartNo', 'kartno',
  'tc', 'tckimlikno', 'identityNumber', 'incelemePuani', 'inceleme_puani',
  'cinsiyet', 'gender', 'yakinlik', 'relation', 'medeniHali', 'medenihali',
  'maritalStatus', 'adresNo', 'adresno', 'addressNo', 'status', 'durum',
  'durumu', 'ydurumu', 'amount', 'miktar',
])
// Kullanici istegi (2026-09-30, 6. tur - CANLI ekran goruntusuyle):
// "işaretli alandaki bilgilerin arka plan rengini beyaz yapalım ama yazı
// yine renkli ve koyu olsun" - once beyaz zemin + renkli kenarlikli "rozet"
// denendi.
// Kullanici istegi (7. tur, devam): "kenar çizgilerini de kaldıralım, DEĞER
// VERİLER GİBİ görünsün ama renkli ve renkleri belirgin ve koyu olsun" -
// rozet/kenarlik/zemin TAMAMEN kaldirildi, artik diger hucrelerdeki duz veri
// gibi (arka plan yok, cerceve yok) SADECE KALIN ve KOYU renkli bir metin.
// Her rengin AILESI (kirmizi/yesil/amber/mavi/gri) AYNEN korunur.
const fileStatusBadgeClasses: Record<string, string> = {
  '0': 'text-slate-700',
  '1': 'text-orange-700',
  '2': 'text-blue-700',
  '3': 'text-emerald-700',
  '4': 'text-red-700',
  '5': 'text-yellow-800',
}
const defaultFileStatusBadgeClass = 'text-slate-700'
const solidFileStatusBadgeClasses: Record<string, string> = {
  '0': 'text-slate-800',
  '1': 'text-orange-800',
  '2': 'text-blue-800',
  '3': 'text-emerald-800',
  '4': 'text-red-800',
  '5': 'text-yellow-900',
}
const defaultSolidFileStatusBadgeClass = 'text-slate-800'
const assistanceStatusBadgeClasses: Record<string, string> = {
  '0': 'text-amber-700',
  '2': 'text-emerald-700',
  '3': 'text-rose-700',
  '4': 'text-sky-700',
}
const dgnAssistanceStatusBadgeClasses: Record<string, string> = {
  '0': 'text-amber-700',
  '1': 'text-rose-700',
  '6': 'text-emerald-700',
}
const defaultAssistanceStatusBadgeClass = 'text-amber-700'

function findPredefinedCategory(
  values: PredefinedValuesMap,
  titles: PredefinedValueTitlesMap,
  candidates: string[],
) {
  const normalizedCandidates = candidates.map(normalizePredefinedText)

  return Object.keys(values).find((key) => {
    const normalizedKey = normalizePredefinedText(key)
    const normalizedTitle = normalizePredefinedText(titles[key] ?? key)

    return normalizedCandidates.some((candidate) => (
      normalizedKey === candidate ||
      normalizedTitle === candidate ||
      normalizedKey.includes(candidate) ||
      normalizedTitle.includes(candidate)
    ))
  }) ?? null
}

function buildPredefinedMap(values: PredefinedValue[] | undefined, fallback: PredefinedValue[]) {
  return (values?.length ? values : fallback).reduce((acc, item) => {
    acc[item.id] = item.name
    return acc
  }, {} as Record<string, string>)
}

function getLocalLayoutKey(tableId: string) {
  return `table_layout_${tableId}`
}

function normalizeLayout(layout: Column[], allKeys: string[], getColumnLabel: (key: string) => string, requiredVisibleColumns: string[]) {
  const usedKeys = new Set<string>()
  const normalized = layout
    .filter((column) => allKeys.includes(column.key))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((column, index) => {
      usedKeys.add(column.key)
      return {
        key: column.key,
        label: getColumnLabel(column.key),
        visible: requiredVisibleColumns.includes(column.key) ? true : column.visible ?? true,
        order: index,
        width: typeof column.width === 'number' && column.width > 0 ? column.width : undefined,
      }
    })

  allKeys.forEach((key) => {
    if (!usedKeys.has(key)) {
      normalized.push({ key, label: getColumnLabel(key), visible: true, order: normalized.length, width: undefined })
    }
  })

  return normalized.map((column, index) => ({ ...column, order: index }))
}

function getComparableValue(key: string, value: unknown) {
  if (value === null || value === undefined) return ''
  if (isDateField(key)) return `${formatDate(value)} ${String(value)}`
  return String(value)
}

function getCellDisplayValue(
  key: string,
  value: unknown,
  statusMap: Record<string, string>,
  fileStatusMap: Record<string, string>,
  fileStatusColumns: string[],
  assistanceStatusMap: Record<string, string>,
  assistanceStatusColumns: string[],
  maritalStatusMap: Record<string, string>,
  maritalStatusColumns: string[],
  genderMap: Record<string, string>,
  genderColumns: string[],
  relationshipMap: Record<string, string>,
  relationshipColumns: string[],
) {
  if (value === null || value === undefined || value === '') return '-'
  if (fileStatusColumns.includes(key)) {
    const rawValue = String(value).trim()
    return numericTextPattern.test(rawValue) ? fileStatusMap[rawValue] || rawValue : rawValue
  }
  if (assistanceStatusColumns.includes(key)) {
    const rawValue = String(value).trim()
    return numericTextPattern.test(rawValue) ? statusMap[rawValue] || assistanceStatusMap[rawValue] || rawValue : rawValue
  }
  if (maritalStatusColumns.includes(key)) {
    const rawValue = String(value).trim()
    return numericTextPattern.test(rawValue) ? maritalStatusMap[rawValue] || rawValue : rawValue
  }
  if (genderColumns.includes(key)) {
    const rawValue = String(value).trim()
    return genderMap[rawValue] || rawValue
  }
  if (relationshipColumns.includes(key)) {
    const rawValue = String(value).trim()
    return numericTextPattern.test(rawValue) ? relationshipMap[rawValue] || rawValue : rawValue
  }
  if (key === 'durumu') return statusMap[String(value)] || String(value)
  if (isDateField(key)) return formatDate(value)
  if (key === 'dosyaNo' || key === 'dosyano') return formatFileNo(value as string | number | null)
  return String(value)
}

function getMappedStatusCode(value: unknown, valueMap: Record<string, string>) {
  if (value === null || value === undefined || value === '') return ''
  const rawValue = String(value).trim()
  if (numericTextPattern.test(rawValue)) return rawValue
  const normalizedValue = rawValue.toLocaleLowerCase('tr-TR')
  return Object.entries(valueMap).find(([, label]) => label.toLocaleLowerCase('tr-TR') === normalizedValue)?.[0] || ''
}

function getFileStatusBadgeClass(value: unknown, fileStatusMap: Record<string, string>, variant: 'default' | 'solid') {
  const statusCode = getMappedStatusCode(value, fileStatusMap)
  return variant === 'solid'
    ? solidFileStatusBadgeClasses[statusCode] || defaultSolidFileStatusBadgeClass
    : fileStatusBadgeClasses[statusCode] || defaultFileStatusBadgeClass
}

function getAssistanceStatusBadgeClass(
  value: unknown,
  assistanceStatusMap: Record<string, string>,
  statusMap: Record<string, string>,
  assistanceStatusVariant: 'default' | 'dgn',
) {
  const statusClasses = assistanceStatusVariant === 'dgn'
    ? dgnAssistanceStatusBadgeClasses
    : assistanceStatusBadgeClasses

  return statusClasses[getMappedStatusCode(value, { ...assistanceStatusMap, ...statusMap })] || defaultAssistanceStatusBadgeClass
}

function getGenericStatusBadgeClass(value: unknown) {
  if (value === 1 || value === '1') return 'text-emerald-700'
  if (value === 2 || value === '2') return 'text-blue-700'
  return 'text-amber-700'
}

// Kullanici istegi: "Aşama" gibi metinsel (numerik kod DEGIL) durum
// sutunlari da diger listelerdeki gibi renklensin. Bu, Ana Sayfa'daki
// "Tahkikat Personeline Göre Nakit Yardımlar" widget'inda (bkz.
// app/(modules)/dashboard/page.tsx) ZATEN kullanilan AYNI renk kurali -
// Uygundur yesil, Uygun Degil kirmizi.
// Kullanici istegi (2026-09-22): "asama alanındaki incelenecek yazısı
// yeşil, otomatik red yazısıda kırmızı olsun" - Incelenecek ARTIK yesil
// (once amberdi), Otomatik Red ARTIK kirmizi (once koyu/siyaha yakindi).
// Kullanici istegi (2026-09-30, 8. tur): "otomatik red ile uygun değil
// verilerinin rengi aynı, ayırt edilemiyor" - rose-700 ve rose-800 gozle
// neredeyse ayni gorunuyordu; "Otomatik Red" artik TAMAMEN FARKLI bir
// tondan (turuncu), "Uygun Değil" ise kirmizi/rose ailesinde kaliyor.
const stageBadgeClasses: { test: (normalized: string) => boolean; className: string }[] = [
  { test: (v) => v === 'uygundur', className: 'text-emerald-700' },
  { test: (v) => v === 'uygun değil' || v === 'uygun degil', className: 'text-rose-700' },
  { test: (v) => v.includes('otomatik red'), className: 'text-orange-700' },
  { test: (v) => v.includes('ince'), className: 'text-emerald-600' },
]
const defaultStageBadgeClass = 'text-slate-600'

function getStageBadgeClass(value: unknown) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('tr-TR')
  if (!normalized || normalized === '-') return defaultStageBadgeClass
  return stageBadgeClasses.find((entry) => entry.test(normalized))?.className || defaultStageBadgeClass
}

function getFilterOptionValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  if (!isDateField(key)) return String(value)

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const text = String(value)
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (isoDate) return isoDate

  return text
}

function matchesColumnFilter(key: string, value: unknown, filter: ColumnFilter) {
  const filterValue = filter.value.trim()
  const op = filter.op || 'contains'

  if (op === 'empty') return value === null || value === undefined || String(value).trim() === ''
  if (op === 'not_empty') return value !== null && value !== undefined && String(value).trim() !== ''
  if (!filterValue) return true

  const rawText = getComparableValue(key, value)
  // Türkçe-duyarsız: büyük/küçük harf + aksan yok sayılır ("Şişli" ~ "sisli").
  const text = foldTurkish(rawText)
  const firstValue = foldTurkish(filterValue)
  const secondValue = foldTurkish(filter.value2?.trim() || '')
  const textComparison = collator.compare(rawText, filter.value)

  switch (op) {
    case 'eq':
      return text === firstValue || collator.compare(rawText, filter.value) === 0
    case 'neq':
      return text !== firstValue && collator.compare(rawText, filter.value) !== 0
    case 'starts':
      return text.startsWith(firstValue)
    case 'ends':
      return text.endsWith(firstValue)
    case 'not_contains':
      return !text.includes(firstValue)
    case 'gt':
      return textComparison > 0
    case 'lt':
      return textComparison < 0
    case 'gte':
      return textComparison >= 0
    case 'lte':
      return textComparison <= 0
    case 'between':
      if (!secondValue) return text.includes(firstValue)
      return collator.compare(rawText, filter.value) >= 0 && collator.compare(rawText, filter.value2 || '') <= 0
    case 'contains':
    default:
      return text.includes(firstValue)
  }
}

export function AdvancedTable({ 
  data, 
  tableId, 
  statusMap = {}, 
  excludedColumns = [],
  onRowClick,
  onRowDoubleClick,
  rowClassName,
  selectable = false,
  selectedRowIds = [],
  selectedRowHighlightClassName = 'bg-[#eaf7fd]',
  onSelectedRowIdsChange,
  getRowId,
  preferredColumnOrder = EMPTY_COLUMNS,
  columnLabels = {},
  requiredVisibleColumns = EMPTY_COLUMNS,
  extraFilterColumns = EMPTY_COLUMNS,
  filterValueOptions = {},
  columnTotals,
  columnTotalsLabel = 'Toplam (Tüm Sonuçlar)',
  showRowNumber = false,
  rowNumberStart = 1,
  serverSideFiltering = false,
  serverSideSorting = false,
  sortSpecs = EMPTY_SORT_SPECS,
  onSortChange,
  fileStatusColumns = EMPTY_COLUMNS,
  fileStatusVariant = 'default',
  assistanceStatusColumns = EMPTY_COLUMNS,
  assistanceStatusVariant = 'default',
  maritalStatusColumns = EMPTY_COLUMNS,
  genderColumns = EMPTY_COLUMNS,
  relationshipColumns = EMPTY_COLUMNS,
  columnReorderingControls = false,
  emptyMessage = 'Görüntülenecek kayıt bulunamadı.',
  stageColumns = EMPTY_COLUMNS,
  compactText = false,
}: AdvancedTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Kullanici istegi (2026-09-30): "Nakit Yardımları"nda (ve bu bileseni
  // paylasan TUM Yardımlar tablolarinda) renkler AYNEN kalsin ama yazi
  // fontu/puntosu GENELE (Dosya Yönetimi tablolarinda kullanilan ~11-13px
  // olcek) uygun olsun, "daha kurumsal ve Excel tarzi" gorunsun. Eskiden
  // baslik/govde/rozet/link YAZILARI BIRBIRINDEN FARKLI, tutarsiz ve masaustunde
  // ASIRI BUYUK (govde 17px, link 16px, rozet 14-15px, baslik 15px) idi - bu
  // hem "genel" gorunumle uyumsuzdu hem de spreadsheet/rapor hissi vermiyordu.
  // Artik TUM metin kategorileri TEK bir kompakt olcekte (govde ~12.5px,
  // baslik/rozet/link ~11-12px) - compactText=true daha da kuculten bir ust
  // kademe olarak kalir.
  // Kullanici istegi (2026-09-30, 5. tur - CANLI ekran goruntusuyle):
  // "müracaat listesinin yazi boyutunu biraz daha büyütelim" - bir ust
  // adim daha (govde ~17px masaustunde).
  const cellTextSize = compactText ? 'text-[11px] md:text-[12px]' : 'text-[15.5px] md:text-[17px]'
  const headTextSize = compactText ? 'text-[10px] md:text-[10.5px]' : 'text-[14.5px] md:text-[15.5px]'
  const dataTextSize = compactText ? 'text-[10px] md:text-[10.5px]' : 'text-[14.5px] md:text-[15.5px]'
  // Kullanici istegi (7. tur, devam): "liste alanının yazı boyutunun tüm
  // verilerinkini aynı yapalım" - rozet/durum yazilari artik AYRI bir boyut
  // TASIMIYOR, hucrenin (ve tablonun geri kalaninin) ambient cellTextSize'ini
  // dogrudan miras aliyor - boylece TUM veriler (normal metin + renkli
  // durum degerleri) BIREBIR AYNI boyutta gorunur.
  const linkTextSize = compactText ? 'text-[10px] md:text-[11px]' : 'text-[14.5px] md:text-[16px]'
  // Acik liste her 15 sn'de bir sunucudan tazelenir (baska kullanicinin
  // girdigi veri, sayfa yenilenmeden gorunsun). Sekme arka plandayken durur;
  // ayni sayfadaki birden fazla tablo tek zamanlayici paylasir.
  useListAutoRefresh(router)
  const [columns, setColumns] = useState<Column[]>([])
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [activeFilterMenu, setActiveFilterMenu] = useState<string | null>(null)
  const [filterMenuPosition, setFilterMenuPosition] = useState<{ left: number; top: number } | null>(null)
  // Kullanici istegi/hata raporu: "açılan liste ilgili filtrenin altında
  // değil farklı yerde açılıyor" - kok neden: acilan menunun yuksekligi
  // ONCEDEN SABIT bir TAHMINLE (480px) varsayilip, o tahmin ekranin alt
  // sinirini asarsa menu YUKARIYA (bazen tikladigin dugmeden COK uzak bir
  // noktaya) itiliyordu - gercek icerik (ör. "Sütundaki Değerler" listesi
  // az sayida ise) o kadar uzun olmadigi icin bu tahmin neredeyse HER
  // ZAMAN gereksiz yere tetikleniyordu. Simdi tiklanan dugmenin konumu bu
  // ref'te saklanir, menu ACILDIKTAN SONRA (asagidaki layout effect)
  // GERCEK olculen yuksekligiyle konum kesinlestirilir - menu varsayilan
  // olarak HER ZAMAN dugmenin TAM ALTINDA acilir, sadece GERCEKTEN ekrana
  // sigmayacaksa yukari (once dugmenin USTUNE, hala sigmazsa ekranin alt
  // sinirina) kaydirilir.
  const filterMenuAnchorRef = useRef<{ left: number; top: number; bottom: number } | null>(null)
  // "Arasında" operatoru secildiginde ikinci deger (Deger 2) alani gorunur
  // olsun diye ayrica tutuluyor. Operatör seçimi ARTIK kontrollü bir state -
  // Uygula butonu da dogrudan bunu okur (bkz. asagidaki custom "Operatör"
  // acilir listesi). Kullanici istegi: eskiden burada NATIF <select>
  // kullaniliyordu - Uzak Masaustu (RDP) uzerinden erisimde Chromium'un
  // native <select> acilir kutusu BOS/boyanmamis gorunuyordu (sadece ilk
  // secenek "İçerir" gorunup gerisi bos kaliyordu, hicbir secim
  // yapilamiyordu). Bu, RDP GPU kompozisyon kisitlamalariyla bilinen bir
  // Chromium sorunu - native OS acilir penceresi yerine, sayfanin KENDI
  // render ettigi (asagidaki "Sütundaki Değerler" listesiyle AYNI desen)
  // bir buton listesine gecilerek tamamen onune gecildi.
  const [activeFilterMenuOperator, setActiveFilterMenuOperator] = useState('contains')
  const [isFilterOperatorMenuOpen, setIsFilterOperatorMenuOpen] = useState(false)
  // Kullanici istegi (Ekim 2026): "Sütundaki Değerler listesinde tik
  // ekleyip birden fazlasini (ör. Otomatik Red + Uygun Değil) birlikte
  // secebilelim" - secimler burada TUTULUR (henuz uygulanmamis, sadece bu
  // acilir menu icin), "Uygula" butonuna basilinca applyFilter'a 'in'
  // operatoruyle tek parametrede birlestirilip gonderilir.
  const [selectedFilterValues, setSelectedFilterValues] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [sortConfigs, setSortConfigs] = useState<SortSpec[]>(EMPTY_SORT_SPECS)
  // Shift+tikla ile araligi secmek icin en son tiklanan satirin sirali
  // listedeki index'ini tutar (bkz. toggleRowSelection).
  const lastCheckedRowIndexRef = useRef<number | null>(null)
  const pendingShiftClickRef = useRef(false)
  const activeSortConfigs = useMemo(
    () => (serverSideSorting && sortSpecs.length > 0 ? sortSpecs : sortConfigs),
    [serverSideSorting, sortSpecs, sortConfigs],
  )
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [fileStatusMap, setFileStatusMap] = useState<Record<string, string>>({})
  const [assistanceStatusMap, setAssistanceStatusMap] = useState<Record<string, string>>({})
  const [maritalStatusMap, setMaritalStatusMap] = useState<Record<string, string>>({})
  const [genderMap, setGenderMap] = useState<Record<string, string>>({})
  const [relationshipMap, setRelationshipMap] = useState<Record<string, string>>({})
  const menuRef = useRef<HTMLDivElement>(null)
  const searchParamSignature = searchParams.toString()
  const fileStatusColumnSignature = fileStatusColumns.join('|')
  const assistanceStatusColumnSignature = assistanceStatusColumns.join('|')
  const maritalStatusColumnSignature = maritalStatusColumns.join('|')
  const genderColumnSignature = genderColumns.join('|')
  const relationshipColumnSignature = relationshipColumns.join('|')
  const stageColumnSignature = stageColumns.join('|')
  const excludedColumnSignature = excludedColumns.join('|')
  const preferredColumnOrderSignature = preferredColumnOrder.join('|')
  const requiredVisibleColumnSignature = requiredVisibleColumns.join('|')
  const columnLabelSignature = JSON.stringify(columnLabels)
  const dataColumnSignature = data.length > 0 ? Object.keys(data[0]).join('|') : ''
  const activeFileStatusColumns = useMemo(
    () => fileStatusColumnSignature ? fileStatusColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [fileStatusColumnSignature]
  )
  const activeAssistanceStatusColumns = useMemo(
    () => assistanceStatusColumnSignature ? assistanceStatusColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [assistanceStatusColumnSignature]
  )
  const activeMaritalStatusColumns = useMemo(
    () => maritalStatusColumnSignature ? maritalStatusColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [maritalStatusColumnSignature]
  )
  const activeGenderColumns = useMemo(
    () => genderColumnSignature ? genderColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [genderColumnSignature]
  )
  const activeRelationshipColumns = useMemo(
    () => relationshipColumnSignature ? relationshipColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [relationshipColumnSignature]
  )
  const activeStageColumns = useMemo(
    () => stageColumnSignature ? stageColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [stageColumnSignature]
  )
  const getColumnLabel = (key: string) => columnLabels[key] || key.replaceAll('_', ' ').toLocaleUpperCase('tr-TR')

  useEffect(() => {
    if (activeFileStatusColumns.length === 0) return

    let isCancelled = false

    fetchPredefinedValuesOnce()
      .then((payload) => {
        if (isCancelled) return
        const fileStatusValues = (payload?.data?.values?.fileStatus ?? []) as PredefinedValue[]
        setFileStatusMap({
          ...Object.fromEntries(fileStatusValues.map((item) => [item.id, item.name])),
          '5': 'Ön İnceleme Yapılmış',
        })
      })
      .catch(() => {
        if (!isCancelled) setFileStatusMap({})
      })

    return () => {
      isCancelled = true
    }
  }, [activeFileStatusColumns])

  useEffect(() => {
    if (activeAssistanceStatusColumns.length === 0) return

    let isCancelled = false

    fetchPredefinedValuesOnce()
      .then((payload) => {
        if (isCancelled) return
        const values = (payload?.data?.values ?? {}) as PredefinedValuesMap
        const titles = (payload?.data?.titles ?? {}) as PredefinedValueTitlesMap
        const dgnCategory = assistanceStatusVariant === 'dgn'
          ? findPredefinedCategory(values, titles, [
              'd-g-n yardim durumu',
              'dgn yardim durumu',
              'd g n yardim durumu',
            ])
          : null
        const statusValues = dgnCategory
          ? values[dgnCategory]
          : values.assistanceStatus

        setAssistanceStatusMap(buildPredefinedMap(statusValues, DEFAULT_PREDEFINED_VALUES.assistanceStatus))
      })
      .catch(() => {
        if (!isCancelled) setAssistanceStatusMap({})
      })

    return () => {
      isCancelled = true
    }
  }, [activeAssistanceStatusColumns, assistanceStatusVariant])

  useEffect(() => {
    if (activeMaritalStatusColumns.length === 0) return

    let isCancelled = false

    fetchPredefinedValuesOnce()
      .then((payload) => {
        if (isCancelled) return
        const maritalStatusValues = (payload?.data?.values?.maritalStatus ?? []) as PredefinedValue[]
        setMaritalStatusMap(Object.fromEntries(maritalStatusValues.map((item) => [item.id, item.name])))
      })
      .catch(() => {
        if (!isCancelled) setMaritalStatusMap({})
      })

    return () => {
      isCancelled = true
    }
  }, [activeMaritalStatusColumns])

  useEffect(() => {
    if (activeGenderColumns.length === 0) return

    let isCancelled = false
    fetchPredefinedValuesOnce()
      .then((payload) => {
        if (isCancelled) return
        const genderValues = (payload?.data?.values?.gender ?? []) as PredefinedValue[]
        setGenderMap(buildPredefinedMap(genderValues, DEFAULT_PREDEFINED_VALUES.gender))
      })
      .catch(() => {
        if (!isCancelled) setGenderMap(buildPredefinedMap(undefined, DEFAULT_PREDEFINED_VALUES.gender))
      })

    return () => { isCancelled = true }
  }, [activeGenderColumns])

  useEffect(() => {
    if (activeRelationshipColumns.length === 0) return

    let isCancelled = false

    fetchPredefinedValuesOnce()
      .then((payload) => {
        if (isCancelled) return
        const relationshipValues = (payload?.data?.values?.relationship ?? []) as PredefinedValue[]
        setRelationshipMap(Object.fromEntries(relationshipValues.map((item) => [item.id, item.name])))
      })
      .catch(() => {
        if (!isCancelled) setRelationshipMap({})
      })

    return () => {
      isCancelled = true
    }
  }, [activeRelationshipColumns])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveFilterMenu(null)
        setFilterMenuPosition(null)
        filterMenuAnchorRef.current = null
        setIsFilterOperatorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    let isCancelled = false

    const initColumns = async () => {
      let savedLayout: any = null
      try {
        const localLayout = window.localStorage.getItem(getLocalLayoutKey(tableId))
        if (localLayout) savedLayout = JSON.parse(localLayout)

        const res = await fetch(`/api/table-settings?tableId=${tableId}`)
        if (res.ok) {
          const remoteLayout = await res.json()
          if (!savedLayout && Array.isArray(remoteLayout)) {
            savedLayout = remoteLayout
            window.localStorage.setItem(getLocalLayoutKey(tableId), JSON.stringify(remoteLayout))
          }
        }
      } catch (e) { console.error('Ayarlar yüklenemedi', e) }

      if (!isCancelled) {
        // Kullanici istegi: veri (sonuc) olmasa bile sutun basliklari (ve
        // icindeki filtre/siralama kontrolleri) KAYBOLMASIN. Eskiden sutun
        // listesi SADECE gercek satirlardan (Object.keys(data[0])) cikariliyordu
        // - veri yoksa hicbir sutun bilinemiyordu. Artik veri yoksa ONCE
        // KAYITLI DUZEN (savedLayout - kullanicinin daha once bu tabloda
        // ayarladigi sutunlar), o da yoksa columnLabels'ta bilinen sutunlar
        // kullanilir - boylece baslik satiri, o an ekranda satir olmasa bile
        // (ör. bir filtre sifir sonuc dondurdugunde) gorunmeye devam eder.
        const allKeys = data.length > 0
          ? Object.keys(data[0]).filter(key => !excludedColumns.includes(key))
          : (Array.isArray(savedLayout) && savedLayout.length > 0
              ? savedLayout.map((col: { key: string }) => col.key).filter((key: string) => !excludedColumns.includes(key))
              : Object.keys(columnLabels).filter(key => !excludedColumns.includes(key)))
        let cols: Column[] = []
        if (savedLayout && Array.isArray(savedLayout)) {
          cols = normalizeLayout(savedLayout, allKeys, getColumnLabel, requiredVisibleColumns)
        } else {
          cols = allKeys.map((key, index) => ({ key, label: getColumnLabel(key), visible: true, order: index }))
        }
        const sortedColumns = cols.sort((a, b) => a.order - b.order)

        if (!savedLayout && preferredColumnOrder.length > 0) {
          const preferredColumns = preferredColumnOrder
            .map((key) => sortedColumns.find((column) => column.key === key))
            .filter((column): column is Column => Boolean(column))
          const remainingColumns = sortedColumns.filter((column) => !preferredColumnOrder.includes(column.key))
          setColumns([...preferredColumns, ...remainingColumns].map((column, index) => ({ ...column, order: index })))
          return
        }

        setColumns(sortedColumns)
      }
    }
    void initColumns()

    return () => {
      isCancelled = true
    }
  }, [tableId, dataColumnSignature, excludedColumnSignature, preferredColumnOrderSignature, columnLabelSignature, requiredVisibleColumnSignature])

  useEffect(() => {
    const nextFilters: Record<string, ColumnFilter> = {}

    searchParams.forEach((value, key) => {
      if (!key.startsWith('f_') || !value) return

      if (key.endsWith('_op')) {
        const field = key.replace('f_', '').replace('_op', '')
        nextFilters[field] = { ...(nextFilters[field] || { value: '', op: 'contains' }), op: value }
        return
      }

      if (key.endsWith('_v2')) {
        const field = key.replace('f_', '').replace('_v2', '')
        nextFilters[field] = { ...(nextFilters[field] || { value: '', op: 'between' }), value2: value }
        return
      }

      const field = key.replace('f_', '')
      nextFilters[field] = { ...(nextFilters[field] || { value: '', op: 'contains' }), value }
    })

    setColumnFilters(nextFilters)
  }, [searchParamSignature, searchParams])

  const applyFilter = (key: string, value: string, op: string, value2?: string) => {
    const hasFilter = Boolean(value) || VALUELESS_FILTER_OPERATORS.has(op)

    setColumnFilters((current) => {
      const nextFilters = { ...current }
      if (hasFilter) {
        nextFilters[key] = { value, op, value2 }
      } else {
        delete nextFilters[key]
      }
      return nextFilters
    })

    const params = new URLSearchParams(searchParams.toString())
    if (hasFilter) {
      if (value) params.set(`f_${key}`, value)
      else params.delete(`f_${key}`)
      params.set(`f_${key}_op`, op)
      if (op === 'between' && value2) {
        params.set(`f_${key}_v2`, value2)
      } else {
        params.delete(`f_${key}_v2`)
      }
    } else {
      params.delete(`f_${key}`)
      params.delete(`f_${key}_op`)
      params.delete(`f_${key}_v2`)
    }
    params.set('page', '1')
    router.push(`?${params.toString()}`)
    setActiveFilterMenu(null)
  }

  // Kullanici istegi: baslikta hangi sutunun GERCEKTEN (URL'e/sunucuya
  // uygulanmis) aktif bir filtresi oldugu tek bakista gorulsun - henuz
  // Enter'a basilmamis, sadece yazilmakta olan metin degil, GERCEKTEN
  // uygulanan filtre (searchParams) esas alinir.
  const isColumnFiltered = (key: string) => {
    const opParam = searchParams.get(`f_${key}_op`)
    return Boolean(searchParams.get(`f_${key}`)) || (opParam ? VALUELESS_FILTER_OPERATORS.has(opParam) : false)
  }

  const saveLayout = async () => {
    setIsSaving(true)
    try {
      const normalizedLayout = columns.map((column, index) => ({ ...column, order: index }))
      window.localStorage.setItem(getLocalLayoutKey(tableId), JSON.stringify(normalizedLayout))
      setColumns(normalizedLayout)
      const res = await fetch('/api/table-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, layout: normalizedLayout })
      })
      if (res.ok) alert('Tablo düzeni kaydedildi.')
    } catch (e) { alert('Hata oluştu.') } finally { setIsSaving(false) }
  }

  const onDragStart = (key: string) => setDraggedColumn(key)
  const onDragOver = (e: React.DragEvent) => e.preventDefault()
  const onDrop = (targetKey: string) => {
    if (!draggedColumn || draggedColumn === targetKey) return
    const newColumns = [...columns]
    const draggedIdx = newColumns.findIndex(c => c.key === draggedColumn)
    const targetIdx = newColumns.findIndex(c => c.key === targetKey)
    const [removed] = newColumns.splice(draggedIdx, 1)
    newColumns.splice(targetIdx, 0, removed)
    setColumns(newColumns.map((c, i) => ({ ...c, order: i })))
    setDraggedColumn(null)
  }

  const toggleVisibility = (key: string) => {
    if (requiredVisibleColumns.includes(key)) return
    setColumns((current) => current.map(c => c.key === key ? { ...c, visible: !c.visible } : c))
  }

  // Kullanici istegi: sutun genisligi fareyle surukleyerek ayarlanabilsin.
  // Performans icin surukleme sirasinda TUM tabloyu her piksel hareketinde
  // yeniden render ETMEK yerine, sadece o an suruklenen sutunun genisligi
  // guncellenir (digerleri degismedigi icin React bu tek sutunun DOM'unu
  // ilgilendiren kucuk bir yeniden cizim yapar).
  const columnResizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const handleColumnResizeMove = (event: MouseEvent) => {
    const resizing = columnResizeRef.current
    if (!resizing) return
    const delta = event.clientX - resizing.startX
    const nextWidth = Math.max(90, Math.min(640, Math.round(resizing.startWidth + delta)))
    setColumns((current) => current.map((c) => (c.key === resizing.key ? { ...c, width: nextWidth } : c)))
  }

  const handleColumnResizeEnd = () => {
    columnResizeRef.current = null
    document.removeEventListener('mousemove', handleColumnResizeMove)
    document.removeEventListener('mouseup', handleColumnResizeEnd)
  }

  const startColumnResize = (key: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const thElement = event.currentTarget.closest('th')
    const startWidth = thElement?.getBoundingClientRect().width || 170
    columnResizeRef.current = { key, startX: event.clientX, startWidth }
    document.addEventListener('mousemove', handleColumnResizeMove)
    document.addEventListener('mouseup', handleColumnResizeEnd)
  }

  const moveColumn = (key: string, direction: -1 | 1) => {
    setColumns((current) => {
      const currentIndex = current.findIndex((column) => column.key === key)
      const targetIndex = currentIndex + direction
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return current

      const next = [...current]
      const [column] = next.splice(currentIndex, 1)
      next.splice(targetIndex, 0, column)
      return next.map((item, index) => ({ ...item, order: index }))
    })
  }

  const visibleColumns = columns.filter(c => c.visible)
  const extraFilterColumnSignature = extraFilterColumns.join('|')
  const activeExtraFilterColumns = useMemo(
    () => extraFilterColumnSignature ? extraFilterColumnSignature.split('|').filter(Boolean) : EMPTY_COLUMNS,
    [extraFilterColumnSignature]
  )
  const resolveRowId = (row: any, index: number) => getRowId?.(row, index) || String(row.id ?? index)
  const pageColumnValueOptions = useMemo(() => {
    const options: Record<string, ColumnValueOption[]> = {}

    visibleColumns.forEach((column) => {
      const valueMap = new Map<string, { value: string; label: string; count: number }>()
      const scopedRows = data.filter((row) =>
        Object.entries(columnFilters)
          .filter(([key, filter]) =>
            key !== column.key &&
            (filter.value.trim() || VALUELESS_FILTER_OPERATORS.has(filter.op))
          )
          .every(([key, filter]) => matchesColumnFilter(key, row[key], filter))
      )

      scopedRows.forEach((row) => {
        const optionValue = getFilterOptionValue(column.key, row[column.key])
        if (!optionValue) return

        const optionLabel = getCellDisplayValue(
          column.key,
          row[column.key],
          statusMap,
          fileStatusMap,
          activeFileStatusColumns,
          assistanceStatusMap,
          activeAssistanceStatusColumns,
          maritalStatusMap,
          activeMaritalStatusColumns,
          genderMap,
          activeGenderColumns,
          relationshipMap,
          activeRelationshipColumns,
        )
        const existing = valueMap.get(optionValue)
        if (existing) {
          existing.count += 1
          return
        }

        valueMap.set(optionValue, { value: optionValue, label: optionLabel, count: 1 })
      })

      options[column.key] = Array.from(valueMap.values())
        .sort((first, second) => collator.compare(first.label, second.label))
    })

    return options
  }, [activeAssistanceStatusColumns, activeFileStatusColumns, activeGenderColumns, activeMaritalStatusColumns, activeRelationshipColumns, assistanceStatusMap, columnFilters, data, genderMap, statusMap, visibleColumns, fileStatusMap, maritalStatusMap, relationshipMap])

  // Durum/medeni hal/cinsiyet/yakinlik gibi "siniflandirma" sutunlari sabit,
  // onceden tanimli bir deger kumesine sahiptir (ör. dosya durumu hep 0-6
  // arasidir) - bu yuzden bu sutunlarin secenek listesi HER ZAMAN tam
  // (onceden tanimli) listeden gelir, sayfadaki 50 kayittan DEGIL. Aksi
  // halde ör. "Yeni Müracaat" durumu o an ekrandaki sayfada hic yoksa
  // acilir menude hic gorunmezdi.
  const statusColumnFullOptions = useMemo(() => {
    const options: Record<string, ColumnValueOption[]> = {}

    activeFileStatusColumns.forEach((key) => {
      options[key] = Object.entries(fileStatusMap).map(([value, label]) => ({ value, label, count: 0 }))
    })
    activeAssistanceStatusColumns.forEach((key) => {
      options[key] = Object.entries({ ...assistanceStatusMap, ...statusMap }).map(([value, label]) => ({ value, label, count: 0 }))
    })
    activeMaritalStatusColumns.forEach((key) => {
      options[key] = Object.entries(maritalStatusMap).map(([value, label]) => ({ value, label, count: 0 }))
    })
    activeGenderColumns.forEach((key) => {
      options[key] = Object.entries(genderMap).map(([value, label]) => ({ value, label, count: 0 }))
    })
    activeRelationshipColumns.forEach((key) => {
      options[key] = Object.entries(relationshipMap).map(([value, label]) => ({ value, label, count: 0 }))
    })

    return options
  }, [
    activeFileStatusColumns, fileStatusMap,
    activeAssistanceStatusColumns, assistanceStatusMap, statusMap,
    activeMaritalStatusColumns, maritalStatusMap,
    activeGenderColumns, genderMap,
    activeRelationshipColumns, relationshipMap,
  ])

  const columnValueOptions = useMemo(() => {
    const options: Record<string, ColumnValueOption[]> = {}

    visibleColumns.forEach((column) => {
      options[column.key] = statusColumnFullOptions[column.key]?.length
        ? statusColumnFullOptions[column.key]
        : filterValueOptions[column.key]?.length
          ? filterValueOptions[column.key]
          : pageColumnValueOptions[column.key] || []
    })

    return options
  }, [filterValueOptions, pageColumnValueOptions, statusColumnFullOptions, visibleColumns])

  const extraFilterItems = useMemo(() => {
    const visibleKeys = new Set(visibleColumns.map((column) => column.key))

    return activeExtraFilterColumns
      .filter((key) => !visibleKeys.has(key) && !excludedColumns.includes(key))
      .map((key) => ({
        key,
        label: getColumnLabel(key),
        options: filterValueOptions[key] ?? [],
        value: searchParams.get(`f_${key}`) || '',
      }))
      .filter((item) => item.options.length > 0)
  }, [activeExtraFilterColumns, excludedColumns, filterValueOptions, searchParams, visibleColumns])

  const filteredData = useMemo(() => {
    if (serverSideFiltering) return data

    const activeFilters = Object.entries(columnFilters).filter(([, filter]) =>
      filter.value.trim() || VALUELESS_FILTER_OPERATORS.has(filter.op),
    )
    if (activeFilters.length === 0) return data

    return data.filter((row) =>
      activeFilters.every(([key, filter]) => matchesColumnFilter(key, row[key], filter))
    )
  }, [data, columnFilters, serverSideFiltering])

  const sortedData = useMemo(() => {
    if (serverSideSorting || activeSortConfigs.length === 0) return filteredData

    return [...filteredData].sort((firstRow, secondRow) => {
      // Coklu sutun siralama: ilk kademe esitse (0 donerse) bir sonraki
      // kademeye gecilir, o da esitse bir sonrakine - vb. Hicbiri ayirt
      // edemezse siralama korunur (stable sort).
      for (const spec of activeSortConfigs) {
        const firstValue = firstRow[spec.key]
        const secondValue = secondRow[spec.key]
        const firstEmpty = firstValue === null || firstValue === undefined || firstValue === ''
        const secondEmpty = secondValue === null || secondValue === undefined || secondValue === ''

        let comparison: number
        if (firstEmpty && secondEmpty) comparison = 0
        else if (firstEmpty) comparison = 1
        else if (secondEmpty) comparison = -1
        else comparison = collator.compare(String(firstValue), String(secondValue))

        if (comparison !== 0) {
          return spec.direction === 'asc' ? comparison : -comparison
        }
      }
      return 0
    })
  }, [activeSortConfigs, filteredData, serverSideSorting])
  const visibleRowIds = sortedData.map(resolveRowId)
  const selectedSet = new Set(selectedRowIds)
  const allVisibleSelected = selectable && visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedSet.has(id))
  // "Tumunu Sec" kutusu SADECE tam secili/tam bos gosteriyordu - ekrandaki
  // satirlarin BIR KISMI seciliyken de bos gorunuyordu, bu da "hicbir sey
  // secili degil" izlenimi veriyordu. Native checkbox'in "indeterminate"
  // (kismi secili - kisa cizgi) hali asagida bir ref ile ayarlanir.
  const someVisibleSelected = selectable && !allVisibleSelected && visibleRowIds.some((id) => selectedSet.has(id))
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected])

  // additive=true (Shift+tikla): mevcut siralamaya EK bir kademe ekler/onun
  // yonunu degistirir. additive=false (normal tikla): sadece bu sutuna gore
  // sirala (tek kademe, oncekileri sifirlar) - standart tablo davranisi.
  const toggleSort = (key: string, additive: boolean) => {
    if (serverSideSorting) {
      onSortChange?.(toggleSortSpec(sortSpecs, key, additive))
      return
    }

    setSortConfigs((current) => toggleSortSpec(current, key, additive))
  }

  const updateSelectedRows = (ids: string[]) => {
    onSelectedRowIdsChange?.(Array.from(new Set(ids)))
  }

  const toggleFilterMenu = (key: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (activeFilterMenu === key) {
      setActiveFilterMenu(null)
      setFilterMenuPosition(null)
      filterMenuAnchorRef.current = null
      setIsFilterOperatorMenuOpen(false)
      setSelectedFilterValues(new Set())
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 256
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12))
    // Ilk (provizyonel) konum - her zaman dugmenin TAM ALTI. Gercek
    // yukseklik olculdukten sonra (bkz. asagidaki layout effect) gerekirse
    // yukari dogru ayarlanir - bkz. yukaridaki filterMenuAnchorRef yorumu.
    filterMenuAnchorRef.current = { left: rect.left, top: rect.top, bottom: rect.bottom }

    setActiveFilterMenu(key)
    setFilterMenuPosition({ left, top: rect.bottom + 6 })
    const existingOp = searchParams.get(`f_${key}_op`) || 'contains'
    setActiveFilterMenuOperator(existingOp)
    setIsFilterOperatorMenuOpen(false)
    // Kolon daha once "in" (coklu deger) ile filtrelenmisse, tiklar yeniden
    // acilista ONCEKI secimi gostersin diye geri yuklenir.
    setSelectedFilterValues(
      existingOp === 'in'
        ? new Set((searchParams.get(`f_${key}`) || '').split(MULTI_VALUE_FILTER_SEPARATOR).filter(Boolean))
        : new Set()
    )
  }

  // Menu ACILDIKTAN (ve icerigi degistikce, ör. "Sütundaki Değerler"
  // listesi gec yuklendiginde ya da "Arasında" secilince 2. deger alani
  // belirince) SONRA gercek/olculen yuksekligine gore konumu kesinlestirir
  // - bkz. yukaridaki filterMenuAnchorRef notu. Boylece HER ZAMAN once
  // dugmenin tam altinda denenir; sadece GERCEKTEN ekranin altina tasarsa
  // yukari (once dugmenin USTU, hala sigmazsa ekranin alt sinirina) kaydirilir.
  useLayoutEffect(() => {
    if (!activeFilterMenu) return
    const anchor = filterMenuAnchorRef.current
    const menuEl = menuRef.current
    if (!anchor || !menuEl) return

    const menuHeight = menuEl.offsetHeight
    const menuWidth = menuEl.offsetWidth
    const spaceBelow = window.innerHeight - anchor.bottom - 6 - 12
    let top: number
    if (menuHeight <= spaceBelow) {
      // Sigıyor - dugmenin tam altinda kalir (istenen/varsayilan davranis).
      top = anchor.bottom + 6
    } else if (menuHeight <= anchor.top - 6 - 12) {
      // Altta yer yok ama ustte var - dugmenin hemen ustune donuk acilir.
      top = anchor.top - menuHeight - 6
    } else {
      // Ikisine de tam sigmiyor - ekranin sinirlari icinde kalacak sekilde
      // (en azindan tamamen gorunur olacak sekilde) konumlandirilir.
      top = Math.max(12, window.innerHeight - menuHeight - 12)
    }
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - menuWidth - 12))

    setFilterMenuPosition((current) => (
      current && current.top === top && current.left === left ? current : { left, top }
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterMenu, activeFilterMenuOperator, columnValueOptions[activeFilterMenu || '']?.length])

  const toggleAllVisibleRows = () => {
    if (!selectable) return
    if (allVisibleSelected) {
      updateSelectedRows(selectedRowIds.filter((id) => !visibleRowIds.includes(id)))
      return
    }
    updateSelectedRows([...selectedRowIds, ...visibleRowIds])
  }

  // Shift tuşu basılıyken bir satır işaretlenirse, en son işaretlenen satır ile
  // bu satır ARASINDAKİ TÜM satırlar da (o an ekranda görünen/sıralı liste
  // içinde) otomatik işaretlenir/kaldırılır - dosya yöneticilerindeki standart
  // "shift+tıkla aralık seç" davranışı. Tüm liste/rapor ekranları bu tek
  // bileşeni kullandığı için bu davranış hepsinde otomatik geçerli olur.
  const toggleRowSelection = (rowId: string, index: number, shiftKey: boolean) => {
    if (!selectable) return

    if (shiftKey && lastCheckedRowIndexRef.current !== null) {
      const start = Math.min(lastCheckedRowIndexRef.current, index)
      const end = Math.max(lastCheckedRowIndexRef.current, index)
      const rangeIds = sortedData.slice(start, end + 1).map((row, offset) => resolveRowId(row, start + offset))
      const willSelect = !selectedSet.has(rowId)

      if (willSelect) {
        updateSelectedRows([...selectedRowIds, ...rangeIds])
      } else {
        const rangeSet = new Set(rangeIds)
        updateSelectedRows(selectedRowIds.filter((id) => !rangeSet.has(id)))
      }
      lastCheckedRowIndexRef.current = index
      return
    }

    lastCheckedRowIndexRef.current = index
    if (selectedSet.has(rowId)) {
      updateSelectedRows(selectedRowIds.filter((id) => id !== rowId))
      return
    }
    updateSelectedRows([...selectedRowIds, rowId])
  }

  // Kullanici istegi (Ekim 2026): "hangi filtre/siralama aktif tek bakista
  // gorunsun, tek tusla temizleyebileyim". Tablonun ustunde aktif filtre ve
  // siralama olcutleri "cip" olarak listelenir; her cipin X'i sadece onu
  // kaldirir, "Tumunu Temizle" hepsini birden kaldirir.
  const removeSort = (key: string) => {
    const next = activeSortConfigs.filter((spec) => spec.key !== key)
    if (serverSideSorting) onSortChange?.(next)
    else setSortConfigs(next)
  }

  const clearAllFiltersAndSorts = () => {
    const params = new URLSearchParams(searchParams.toString())
    Array.from(params.keys()).forEach((paramKey) => {
      if (paramKey.startsWith('f_')) params.delete(paramKey)
    })
    params.set('page', '1')
    setColumnFilters({})
    if (serverSideSorting) onSortChange?.([])
    else setSortConfigs([])
    router.push(`?${params.toString()}`)
  }

  const activeFilterChips = (() => {
    const chips: { key: string; label: string; text: string }[] = []
    const seenKeys = new Set<string>()
    searchParams.forEach((_paramValue, paramKey) => {
      if (!paramKey.startsWith('f_')) return
      const key = paramKey.replace(/^f_/, '').replace(/_op$/, '').replace(/_v2$/, '')
      if (seenKeys.has(key)) return
      seenKeys.add(key)
      const op = searchParams.get(`f_${key}_op`) || 'contains'
      const rawValue = searchParams.get(`f_${key}`) || ''
      const rawValue2 = searchParams.get(`f_${key}_v2`) || ''
      if (!rawValue && !VALUELESS_FILTER_OPERATORS.has(op)) return
      const opLabel = OPERATORS.find((operator) => operator.id === op)?.label || ''
      const matchedOption = (columnValueOptions[key] || []).find((option) => option.value === rawValue)
      const shownValue = matchedOption ? matchedOption.label : rawValue
      const text = VALUELESS_FILTER_OPERATORS.has(op)
        ? opLabel
        : op === 'between'
          ? `${shownValue} – ${rawValue2}`
          : op === 'contains' || op === 'eq'
            ? shownValue
            : `${opLabel}: ${shownValue}`
      chips.push({ key, label: getColumnLabel(key), text })
    })
    return chips
  })()

  return (
    <div className="relative">
      {/* Kullanici istegi: bu iki buton (Sütun Ayarları/Görünümü Kaydet) ve
          asagidaki "Görünürlük" paneli daha profesyonel/renkli/kullanışlı
          hale getirildi - ikon eklendi, "Sütun Ayarları" panel acikken
          belirgin bir aktif durum alir, "Görünümü Kaydet" yesil vurgusu
          korunarak biraz daha canli hale getirildi. */}
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-black shadow-sm transition md:px-3 md:py-1.5 md:text-[15px] ${
            showSettings
              ? 'border-[#0076b6] bg-[#0076b6] text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:border-[#0076b6] hover:text-[#0076b6]'
          }`}
        >
          <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
          Sütun Ayarları
        </button>
        <button
          type="button"
          onClick={saveLayout}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-2.5 py-1 text-[11px] font-black text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50 md:px-3 md:py-1.5 md:text-[15px]"
        >
          <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
            <path d="M17 21v-8H7v8" />
            <path d="M7 3v5h8" />
          </svg>
          {isSaving ? 'Kaydediliyor...' : 'Görünümü Kaydet'}
        </button>
      </div>

      {(activeFilterChips.length > 0 || activeSortConfigs.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 print:hidden">
          <span className="text-[14.5px] font-black uppercase tracking-wide text-amber-700">Aktif</span>
          {activeFilterChips.map((chip) => (
            <span key={`filter-${chip.key}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[14.5px] font-bold text-slate-700">
              <span className="shrink-0 text-amber-700">{chip.label}:</span>
              <span className="max-w-[220px] truncate">{chip.text}</span>
              <button
                type="button"
                onClick={() => applyFilter(chip.key, '', 'contains')}
                title="Bu filtreyi kaldır"
                className="ml-0.5 shrink-0 rounded-full px-1 leading-none text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                ✕
              </button>
            </span>
          ))}
          {activeSortConfigs.map((spec, specIndex) => (
            <span key={`sort-${spec.key}`} className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[14.5px] font-bold text-slate-700">
              <span className="shrink-0 text-sky-700">
                {activeSortConfigs.length > 1 ? `${specIndex + 1}. ` : ''}Sırala:
              </span>
              <span>{getColumnLabel(spec.key)} {spec.direction === 'asc' ? '↑' : '↓'}</span>
              <button
                type="button"
                onClick={() => removeSort(spec.key)}
                title="Bu sıralamayı kaldır"
                className="ml-0.5 shrink-0 rounded-full px-1 leading-none text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAllFiltersAndSorts}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-300 bg-white px-2.5 py-0.5 text-[14.5px] font-black text-rose-600 hover:bg-rose-50"
          >
            Tümünü Temizle
          </button>
        </div>
      )}

      {extraFilterItems.length > 0 && (
        <div className="mb-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3 print:hidden">
          {extraFilterItems.map((item) => (
            <label key={item.key} className="min-w-0">
              <span className="mb-1 block text-[10px] font-black uppercase text-slate-500">{item.label}</span>
              <select
                value={item.value}
                onChange={(event) => applyFilter(item.key, event.target.value, event.target.value ? 'eq' : 'contains')}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-bold text-slate-700 outline-none focus:border-[#0076b6]"
              >
                <option value="">Tümü</option>
                {item.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {showSettings && (
        // Kullanici istegi (2026-09-30, 9. tur - CANLI ekran goruntusuyle):
        // "sütun ayarları içindeki veriler tam okunmuyor" - panel eskiden
        // 10-12px gibi, sayfanin geri kalanindan (artik ~16-17px) COK KUCUK
        // yazilar kullaniyordu. Tum yazi/kontrol boyutlari buyutuldu, panel
        // biraz genisletildi.
        <div className="absolute right-0 top-10 z-20 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#0c6f9e] via-[#127f92] to-[#1c9a7a] px-4 py-3">
            <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h18" />
              <path d="M6 4v16" />
              <path d="M12 4v16" />
              <path d="M18 4v16" />
            </svg>
            <h4 className="text-[15px] font-black uppercase tracking-wide text-white">Sütun Görünürlüğü</h4>
          </div>
          {/* Kullanici istegi ("bazı başlıkları pasif kaldıramıyorum"): zorunlu
              (requiredVisibleColumns) sutunlar SADECE gri/soluk gorunup NEDEN
              kapatilamadigi belli olmuyordu - kilit ikonu + kisa aciklama
              satiriyla bu artik NET. Sayfaya gore zorunlu sutun sayisi
              degisebilir/hic olmayabilir (bkz. ilgili sayfalardaki
              requiredVisibleColumns prop'u). */}
          {requiredVisibleColumns.length > 0 && (
            <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-[13px] font-bold leading-snug text-amber-800">
              <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="10" x="5" y="11" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span>Kilitli sütunlar bu rapor için her zaman görünür kalmalıdır.</span>
            </div>
          )}
          <div className="max-h-80 space-y-1 overflow-y-auto p-2.5">
            {columns.map((col, index) => {
              const isLocked = requiredVisibleColumns.includes(col.key)
              return (
              <div key={col.key} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition ${isLocked ? 'bg-amber-50/60' : 'hover:bg-sky-50'}`}>
                <label
                  className={`flex min-w-0 flex-1 items-center gap-2.5 ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  title={isLocked ? 'Bu sütun her zaman görünür olmalıdır' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={col.visible}
                    disabled={isLocked}
                    onChange={() => toggleVisibility(col.key)}
                    className="h-5 w-5 shrink-0 rounded border-slate-300 text-[#0076b6] focus:ring-[#0076b6] disabled:opacity-60"
                  />
                  <span className={`truncate text-[14.5px] font-bold uppercase ${isLocked ? 'text-amber-700' : 'text-slate-700'}`}>{col.label}</span>
                  {isLocked && (
                    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <rect width="14" height="10" x="5" y="11" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  )}
                </label>
                {columnReorderingControls && (
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => moveColumn(col.key, -1)} disabled={index === 0} className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-[13px] font-black text-slate-700 hover:bg-sky-50 disabled:opacity-30" title="Sütunu sola taşı">←</button>
                    <button type="button" onClick={() => moveColumn(col.key, 1)} disabled={index === columns.length - 1} className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-[13px] font-black text-slate-700 hover:bg-sky-50 disabled:opacity-30" title="Sütunu sağa taşı">→</button>
                  </span>
                )}
              </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="w-full overflow-hidden">
        <div
          className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-inner"
        >
          {/* Mobilde (md altı) yazı/boşluk daha kompakt - ekran taşmasın,
              profesyonel dursun; md ve üstünde masaüstü boyutları korunur. */}
          <table className={`w-full border-collapse text-left font-semibold table-auto ${cellTextSize}`}>
            <colgroup>
              {showRowNumber && <col style={{ width: 64 }} />}
              {selectable && <col style={{ width: 48 }} />}
              {visibleColumns.map((col) => (
                <col key={col.key} style={col.width ? { width: col.width } : undefined} />
              ))}
            </colgroup>
            <thead className={`bg-gradient-to-r from-[#0c6f9e] via-[#127f92] to-[#1c9a7a] font-semibold uppercase tracking-wide text-white sticky top-0 z-10 shadow-[0_2px_10px_rgba(2,60,90,0.25)] ${headTextSize}`}>
              <tr>
                {showRowNumber && (
                  <th className="w-16 border-b border-r border-white/35 px-1.5 py-1.5 text-center md:px-3 md:py-2.5">
                    <div className="flex min-h-[40px] items-center justify-center whitespace-nowrap md:min-h-[58px]">
                      Sıra
                    </div>
                  </th>
                )}
                {selectable && (
                  <th className="w-12 border-b border-r border-white/35 px-1.5 py-1.5 text-center md:px-3 md:py-2.5">
                    <div className="flex min-h-[40px] items-center justify-center md:min-h-[58px]">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisibleRows}
                        className="h-4 w-4 rounded border-white/60 text-[#0076b6]"
                        aria-label="Tum satirlari sec"
                      />
                    </div>
                  </th>
                )}
                {visibleColumns.map((col) => {
                  const sortIndex = activeSortConfigs.findIndex((spec) => spec.key === col.key)
                  const isSorted = sortIndex !== -1
                  const sortDirectionForColumn = isSorted ? activeSortConfigs[sortIndex].direction : null
                  const isFiltered = isColumnFiltered(col.key)
                  const filterValue = columnFilters[col.key]?.value || ''
                  return (
                  <th key={col.key} draggable onDragStart={() => onDragStart(col.key)} onDragOver={onDragOver} onDrop={() => onDrop(col.key)} className={`group cursor-move border-b border-r px-1.5 py-1.5 hover:bg-white/10 min-w-[104px] relative transition-colors md:px-3 md:py-2.5 md:min-w-[170px] ${isSorted ? 'border-amber-300 bg-white/10' : 'border-white/35'}`}>
                    <div className="flex flex-col gap-1 min-h-[40px] justify-between md:gap-1.5 md:min-h-[58px]">
                      <button
                        type="button"
                        onClick={(event) => toggleSort(col.key, event.shiftKey)}
                        className="flex max-w-full items-center gap-1.5 overflow-hidden text-left hover:text-amber-200"
                        title={`${col.label} sırala (birden fazla sütuna göre sıralamak için Shift+tıklayın)`}
                      >
                        <svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          {sortDirectionForColumn === 'asc' ? (
                            <path d="m18 15-6-6-6 6" />
                          ) : sortDirectionForColumn === 'desc' ? (
                            <path d="m6 9 6 6 6-6" />
                          ) : (
                            <>
                              <path d="m7 8 3-3 3 3" />
                              <path d="m7 15 3 3 3-3" />
                            </>
                          )}
                        </svg>
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap tracking-wide">{col.label.toLocaleUpperCase('tr-TR')}</span>
                        {isSorted && activeSortConfigs.length > 1 && (
                          <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-300 text-[9px] font-black text-[#0c6f9e]" title={`${sortIndex + 1}. sıralama ölçütü`}>
                            {sortIndex + 1}
                          </span>
                        )}
                        {isFiltered && (
                          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 shadow-[0_0_4px_rgba(252,211,77,0.9)]" title="Bu sütunda aktif filtre var" />
                        )}
                      </button>
                      <div className="flex items-center gap-1">
                        {/* Kullanici istegi (2026-09-30, 9. tur): "başlıklardaki
                            filtreleme özelliğini daha profesyonel yapalım" -
                            filtre kutulari (metin/tarih/secim) daha buyuk,
                            daha yuvarlak koseli, gorunur golgeli hale getirildi
                            - bu filtreler zaten SUNUCU TARAFINDA (URL'e
                            yazilip sayfa yenilenerek) calisir, yani ekranda o
                            an GORUNMEYEN kayitlar dahil TUM veri kumesinde
                            arama yapar (bkz. applyFilter -> router.push,
                            AssistanceRequestListPage.tsx -> buildFilterCondition). */}
                        {activeFileStatusColumns.includes(col.key) ? (
                          <select
                            value={filterValue}
                            onChange={(event) => applyFilter(col.key, event.target.value, event.target.value ? 'eq' : 'contains')}
                            className={`w-full min-w-0 rounded-lg border bg-white px-2 py-1.5 text-[12.5px] font-bold text-slate-800 shadow-sm outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-[#0076b6]/20 md:text-[15px] ${isFiltered ? 'border-amber-400 ring-2 ring-amber-200' : 'border-white/90'}`}
                            aria-label={`${col.label} filtresi - tüm kayıtlarda arar`}
                            title="Bu alan tüm kayıtlarda (sayfada görünmeyenler dahil) arama yapar"
                          >
                            <option value="">Tümü</option>
                            {(columnValueOptions[col.key] || []).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : isDateField(col.key) ? (
                          <div className="relative min-w-0 flex-1">
                            {/* Kullanici istegi: tarih sutunlarinda elle yazmak
                                yerine takvimden secilsin - native <input type=date>
                                hem dogru bicimi (YYYY-AA-GG) garanti eder hem de
                                SQL karsilastirmasiyla (BETWEEN/>/< vb.) birebir
                                uyumludur. Secim yapilir yapilmaz (Enter beklemeden)
                                dogrudan uygulanir - takvimden tek tikla tarih secmek
                                zaten ayrik/kesin bir eylemdir. */}
                            <input
                              type="date"
                              value={filterValue}
                              onChange={(e) => applyFilter(col.key, e.target.value, e.target.value ? 'eq' : 'contains')}
                              className={`w-full rounded-lg border bg-white px-2.5 py-1.5 text-[12.5px] normal-case text-slate-800 shadow-sm outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-[#0076b6]/20 md:text-[15px] ${isFiltered ? 'border-amber-400 ring-2 ring-amber-200' : 'border-white/90'}`}
                              title="Bu alan tüm kayıtlarda (sayfada görünmeyenler dahil) arama yapar"
                            />
                          </div>
                        ) : (
                          <div className="relative min-w-0 flex-1">
                            <input
                              type="text"
                              placeholder="Tüm kayıtlarda ara..."
                              value={filterValue}
                              onChange={(e) => {
                                const value = e.target.value
                                setColumnFilters((current) => {
                                  const nextFilters = { ...current }
                                  if (value) {
                                    nextFilters[col.key] = {
                                      value,
                                      op: current[col.key]?.op || searchParams.get(`f_${col.key}_op`) || 'contains',
                                      value2: current[col.key]?.value2,
                                    }
                                  } else {
                                    delete nextFilters[col.key]
                                  }
                                  return nextFilters
                                })
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') applyFilter(col.key, (e.target as HTMLInputElement).value, columnFilters[col.key]?.op || searchParams.get(`f_${col.key}_op`) || 'contains') }}
                              title="Enter'a basınca tüm kayıtlarda (sayfada görünmeyenler dahil) arama yapar"
                              className={`w-full rounded-lg border bg-white px-2.5 py-1.5 text-[12.5px] normal-case text-slate-800 shadow-sm outline-none focus:border-[#0076b6] focus:ring-2 focus:ring-[#0076b6]/20 md:text-[15px] ${filterValue ? 'pr-7' : ''} ${isFiltered ? 'border-amber-400 ring-2 ring-amber-200' : 'border-white/90'}`}
                            />
                            {filterValue && (
                              <button
                                type="button"
                                onClick={() => applyFilter(col.key, '', 'contains')}
                                title="Filtreyi temizle"
                                className="absolute inset-y-0 right-1 flex items-center px-1 text-slate-400 hover:text-rose-600"
                              >
                                <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(event) => toggleFilterMenu(col.key, event)}
                          title="Gelişmiş filtre - tüm kayıtlarda değere göre ara"
                          className={`shrink-0 rounded-lg border-2 px-2 py-1.5 text-[13px] normal-case shadow-sm ${isFiltered ? 'border-amber-400 bg-amber-400 text-white hover:bg-amber-500' : 'border-white/90 bg-white text-slate-700 hover:bg-slate-50'}`}
                        >
                          ▼
                        </button>
                      </div>
                    </div>

                    {activeFilterMenu === col.key && typeof document !== 'undefined' && createPortal(
                      // Kullanici istegi/hata raporu: "başlık filtresi alakasız
                      // ve farklı yerde çıkıyor - başlığın hemen altında çıksın".
                      // Kok neden: bu menu, kabuk `zoom` ile olceklenen (bkz.
                      // ScaledArea.tsx) agacin ICINDE render ediliyordu; `position:
                      // fixed` bir oge o `zoom`lu alt agacin icindeyken
                      // koordinatlari da o olcege gore YORUMLANIYOR - oysa konum,
                      // OLCEKSIZ (gercek ekran) koordinatiyla (getBoundingClientRect)
                      // hesaplaniyordu, ikisi uyusmuyordu. Cozum: menuyu
                      // document.body'ye PORTAL'la (olcegin DISINA) tasi - artik
                      // fixed koordinatlari gercek ekran koordinatiyla birebir ayni
                      // (uygulamadaki diger body-portal menuleriyle ayni desen).
                      // Kullanici istegi (2026-09-30, 10. tur - CANLI ekran
                      // goruntusuyle): "filtre penceresindeki veriler tam
                      // okunmuyor, büyütelim, profesyonel hale getirelim" -
                      // panel eskiden 256px genislikte, 9-11px yazilarla
                      // AŞIRI SIKIŞIKTI. Artik daha genis (320px), TUM
                      // etiket/deger/buton yazilari sayfanin geri kalanina
                      // uygun (~13-15px) buyuklukte, dolgu/aralik da
                      // buyutuldu.
                      <div
                        ref={menuRef}
                        style={filterMenuPosition ? { left: filterMenuPosition.left, top: filterMenuPosition.top } : undefined}
                        className="fixed z-[9999] w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl normal-case font-bold"
                      >
                        <div className="space-y-4">
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <label className="block text-[13px] font-bold text-slate-600">Sütundaki Değerler</label>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-slate-600">
                                {columnValueOptions[col.key]?.length || 0}
                              </span>
                            </div>
                            {/* Kullanici istegi (Ekim 2026): "yanina tik ekleyerek
                                birden fazla deger secebilelim (ör. Otomatik Red +
                                Uygun Değil)" - tek tikla hemen uygulayan eski
                                buton listesi yerine, isaretlendikce sadece bu
                                acilir menu icindeki secimi guncelleyen onay
                                kutulari; asagidaki "Uygula" butonu secili
                                degerlerin TUMUNU tek seferde (OR mantigiyla)
                                filtre olarak gonderir. */}
                            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                              {(columnValueOptions[col.key]?.length || 0) > 0 ? (
                                columnValueOptions[col.key].map((option) => {
                                  const isChecked = selectedFilterValues.has(option.value)
                                  return (
                                    <label
                                      key={option.value}
                                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] text-slate-800 hover:bg-white"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          setSelectedFilterValues((current) => {
                                            const next = new Set(current)
                                            if (isChecked) next.delete(option.value)
                                            else next.add(option.value)
                                            return next
                                          })
                                        }}
                                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#1E2A38] focus:ring-[#1E2A38]"
                                      />
                                      <span className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${isChecked ? 'text-[#1E2A38]' : ''}`} title={option.label}>
                                        {option.label}
                                      </span>
                                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[12px] text-slate-500">{option.count}</span>
                                    </label>
                                  )
                                })
                              ) : (
                                <div className="px-2 py-4 text-center text-[13px] text-slate-400">Değer bulunamadı</div>
                              )}
                            </div>
                            {selectedFilterValues.size > 0 && (
                              <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px] font-bold text-[#1E2A38]">
                                <span>{selectedFilterValues.size} değer seçildi</span>
                                <button type="button" onClick={() => setSelectedFilterValues(new Set())} className="text-slate-500 hover:text-rose-600">Seçimi temizle</button>
                              </div>
                            )}
                          </div>
                          {/* Kullanici istegi: birden fazla deger isaretliyken
                              Operatör/Değer alanlari KARISIKLIK yaratmasin diye
                              soluklastirilip devre disi birakilir - asagidaki
                              "Uygula" butonu bu durumda SADECE isaretli
                              degerleri gonderir. */}
                          <div className={selectedFilterValues.size > 0 ? 'pointer-events-none opacity-40' : ''}>
                          <div className="relative">
                            <label className="mb-1.5 block text-[13px] font-bold text-slate-600">Operatör</label>
                            <button
                              type="button"
                              onClick={() => setIsFilterOperatorMenuOpen((open) => !open)}
                              className="flex w-full items-center justify-between gap-2 rounded-lg border-2 border-slate-300 p-2.5 text-left text-[14px] text-slate-800 outline-none hover:bg-slate-50"
                            >
                              <span>{OPERATORS.find((op) => op.id === activeFilterMenuOperator)?.label || 'İçerir'}</span>
                              <span className="text-slate-400">▾</span>
                            </button>
                            {isFilterOperatorMenuOpen && (
                              <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                                {OPERATORS.map((op) => (
                                  <button
                                    key={op.id}
                                    type="button"
                                    onClick={() => {
                                      setActiveFilterMenuOperator(op.id)
                                      setIsFilterOperatorMenuOpen(false)
                                    }}
                                    className={`block w-full rounded-lg px-2.5 py-2 text-left text-[14px] ${op.id === activeFilterMenuOperator ? 'bg-[#0076b6] text-white' : 'text-slate-800 hover:bg-slate-100'}`}
                                  >
                                    {op.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {!VALUELESS_FILTER_OPERATORS.has(activeFilterMenuOperator) && (
                            <div className="mt-4">
                              <label className="mb-1.5 block text-[13px] font-bold text-slate-600">{activeFilterMenuOperator === 'between' ? 'Değer (Başlangıç)' : 'Değer'}</label>
                              {/* Kullanici istegi: yazilan metin gorunmuyordu - bu
                                  girdi rengi ACIKCA belirtilmemisti, bu yuzden
                                  bazi sayfalarda (ust bardaki mavi/beyaz-metin
                                  baglamdan) MIRAS alinan BEYAZ metin rengini
                                  aliyor, beyaz kutu icinde GORUNMEZ oluyordu -
                                  artik bg-white + text-slate-900 ACIKCA
                                  belirtiliyor. */}
                              <input id={`val-${col.key}`} type={isDateField(col.key) ? 'date' : 'text'} defaultValue={searchParams.get(`f_${col.key}`) || ''} className="w-full rounded-lg border-2 border-slate-300 bg-white p-2.5 text-[14px] text-slate-900 outline-none focus:border-[#0076b6]" />
                            </div>
                          )}
                          {activeFilterMenuOperator === 'between' && (
                            <div className="mt-4">
                              <label className="mb-1.5 block text-[13px] font-bold text-slate-600">Değer (Bitiş)</label>
                              <input id={`val2-${col.key}`} type={isDateField(col.key) ? 'date' : 'text'} defaultValue={searchParams.get(`f_${col.key}_v2`) || ''} className="w-full rounded-lg border-2 border-slate-300 bg-white p-2.5 text-[14px] text-slate-900 outline-none focus:border-[#0076b6]" />
                            </div>
                          )}
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => {
                              if (selectedFilterValues.size > 0) {
                                applyFilter(col.key, Array.from(selectedFilterValues).join(MULTI_VALUE_FILTER_SEPARATOR), 'in')
                                return
                              }
                              const val = (document.getElementById(`val-${col.key}`) as HTMLInputElement | null)?.value || ''
                              const val2 = (document.getElementById(`val2-${col.key}`) as HTMLInputElement | null)?.value || ''
                              applyFilter(col.key, val, activeFilterMenuOperator, val2 || undefined)
                            }} className="flex-1 rounded-lg bg-[#0076b6] py-2.5 text-[14px] text-white hover:bg-[#00649b]">Uygula</button>
                            <button type="button" onClick={() => { setSelectedFilterValues(new Set()); applyFilter(col.key, '', 'contains') }} className="flex-1 rounded-lg border-2 border-slate-300 bg-white py-2.5 text-[14px] text-slate-700 hover:bg-slate-50">Temizle</button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                    {/* Kullanici istegi: sutun genisligi elle ayarlanabilsin - bu
                        ince tutamac SADECE kendi uzerindeki mouse etkilesimini
                        yakalar (draggable=false + stopPropagation), boylece
                        ustteki <th>'nin surukle-birak SIRALAMA ozelligiyle
                        CAKISMAZ. */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      draggable={false}
                      onMouseDown={(event) => startColumnResize(col.key, event)}
                      onClick={(event) => event.stopPropagation()}
                      onDragStart={(event) => event.preventDefault()}
                      title="Sütun genişliğini ayarlamak için sürükleyin"
                      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-amber-300/70 active:bg-amber-300"
                    />
                  </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row, index) => {
                const rowId = resolveRowId(row, index)
                const selected = selectedSet.has(rowId)
                const customRowClass = rowClassName?.(row, index) || ''

                return (
                <tr
                  key={rowId}
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  className={`${selected ? selectedRowHighlightClassName : customRowClass || (index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60')} ${customRowClass && !selected ? '' : 'hover:bg-[#f1faed]'} transition-colors whitespace-nowrap ${onRowClick || onRowDoubleClick ? 'cursor-pointer' : ''}`}
                >
                  {showRowNumber && (
                    <td className={`border-b border-r border-slate-200 px-1.5 py-0.5 text-center font-semibold text-slate-500 md:px-3 md:py-1 ${dataTextSize}`}>
                      {rowNumberStart + index}
                    </td>
                  )}
                  {selectable && (
                    <td className="border-b border-r border-slate-200 px-1.5 py-0.5 text-center md:px-3 md:py-1">
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => {
                          event.stopPropagation()
                          // "change" olayi checkbox'larda shiftKey bilgisini TASIMAZ - bu yuzden
                          // gercek tiklama anindaki shift durumu burada (click, MouseEvent) yakalanip
                          // hemen ardindan tetiklenecek onChange icin bir ref'e kaydedilir.
                          pendingShiftClickRef.current = event.shiftKey
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onChange={() => toggleRowSelection(rowId, index, pendingShiftClickRef.current)}
                        className="h-4 w-4 rounded border-slate-300 text-[#0076b6]"
                        aria-label="Satiri sec"
                      />
                    </td>
                  )}
                  {visibleColumns.map((col) => {
                    const val = row[col.key]
                    const displayValue = getCellDisplayValue(
                      col.key,
                      val,
                      statusMap,
                      fileStatusMap,
                      activeFileStatusColumns,
                      assistanceStatusMap,
                      activeAssistanceStatusColumns,
                      maritalStatusMap,
                      activeMaritalStatusColumns,
                      genderMap,
                      activeGenderColumns,
                      relationshipMap,
                      activeRelationshipColumns,
                    )
                    const isFileStatusColumn = activeFileStatusColumns.includes(col.key)
                    const isAssistanceStatusColumn = activeAssistanceStatusColumns.includes(col.key)
                    const isStageColumn = activeStageColumns.includes(col.key)
                    const isCenteredShortValueColumn = CENTERED_SHORT_VALUE_COLUMNS.has(col.key) || isDateField(col.key) || isFileStatusColumn || isAssistanceStatusColumn || isStageColumn || col.key === 'durumu'
                    return (
                      <td key={col.key} className={`border-b border-r border-slate-200 px-1.5 py-0.5 font-bold text-slate-950 max-w-[220px] overflow-hidden text-ellipsis md:px-3 md:py-1 md:max-w-[400px] ${isCenteredShortValueColumn ? 'text-center' : ''}`}>
                        {isFileStatusColumn ? (
                          <span className={`font-extrabold ${getFileStatusBadgeClass(val, fileStatusMap, fileStatusVariant)}`}>{displayValue}</span>
                        ) : isAssistanceStatusColumn ? (
                          <span className={`font-black ${getAssistanceStatusBadgeClass(val, assistanceStatusMap, statusMap, assistanceStatusVariant)}`}>{displayValue}</span>
                        ) : col.key === 'durumu' ? (
                          <span className={`font-extrabold ${getGenericStatusBadgeClass(val)}`}>{displayValue}</span>
                        ) : isStageColumn ? (
                          <span className={`font-black ${getStageBadgeClass(val)}`}>{displayValue}</span>
                        ) : displayValue}
                      </td>
                    )
                  })}
                </tr>
                )
              })}
              {sortedData.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleColumns.length + (showRowNumber ? 1 : 0) + (selectable ? 1 : 0)}
                    className="border-b border-slate-100 px-4 py-10 text-center text-sm font-bold text-slate-500"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
            {/* Kullanici istegi: "yardım kişi sayısı, miktar gibi bazı
                alanların toplamlarını altta gösterelim" - sadece
                columnTotals map'inde anahtari olan sutunlarda deger
                gorunur, digerleri bos kalir. Toplam, TUM FILTRELENMIS
                veri kumesi uzerinden (sadece ekrandaki sayfa degil)
                sunucu tarafinda hesaplanir - bkz. cagiran sayfalardaki
                totalsQuery. */}
            {columnTotals && Object.keys(columnTotals).length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#0076b6]/30 bg-gradient-to-r from-sky-50 to-emerald-50 font-semibold">
                  {showRowNumber && <td className="border-r border-white/60 px-1.5 py-1.5 md:px-3 md:py-2" />}
                  {selectable && <td className="border-r border-white/60 px-1.5 py-1.5 md:px-3 md:py-2" />}
                  {visibleColumns.map((col, index) => {
                    const total = columnTotals[col.key]
                    if (total === undefined) {
                      return (
                        <td key={col.key} className={`border-r border-white/60 px-1.5 py-1.5 text-slate-500 md:px-3 md:py-2 ${dataTextSize}`}>
                          {index === 0 ? columnTotalsLabel : ''}
                        </td>
                      )
                    }
                    return (
                      <td key={col.key} className={`border-r border-white/60 px-1.5 py-1.5 text-right text-[#0076b6] md:px-3 md:py-2 ${linkTextSize}`}>
                        {total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
