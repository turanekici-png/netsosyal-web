'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormDesignRenderer } from '@/components/shared/FormDesignRenderer'
import { printFormDesignHtml } from '@/lib/printFormDesign'
import { VIRTUAL_PRINTER_NAME } from '@/lib/constants/virtualPrinter'
import { REQUIRED_PRINT_AGENT_VERSION } from '@/lib/printAgentClient'

export const dynamic = 'force-dynamic'

interface ReportBand {
  id: string
  type: 'ReportTitle' | 'PageHeader' | 'MasterData' | 'PageFooter'
  name: string
  height: number
}

interface DesignBlock {
  id: string
  bandId?: string
  type: 'text' | 'variable' | 'barcode' | 'qrcode' | 'line' | 'image'
  x: number
  y: number
  width?: number
  height?: number
  value: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textDirection?: 'horizontal' | 'vertical'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  autoFitText?: boolean
  textColor?: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
}

interface ReportField {
  token: string
  label: string
  source: string
}

interface ReportFieldGroup {
  id: string
  title: string
  fields: ReportField[]
}

interface FormDesign {
  id: string
  name: string
  type: 'barcode' | 'a4' | 'label'
  linkedAssistance: string
  width?: string
  height?: string
  printOffsetX?: string
  printOffsetY?: string
  printOffsetRight?: string
  printOffsetBottom?: string
  printerName?: string
  content: string
  bands?: ReportBand[]
  blocks?: DesignBlock[]
}

interface SettingResponse<T> {
  success: boolean
  data?: {
    value?: T
  }
  error?: string
}

interface ClientPrinterConfig {
  printers?: string[]
  preferences?: Record<string, string>
  designPrinters?: Record<string, string>
  assistancePrinters?: Record<string, string>
}

const PX_PER_MM = 96 / 25.4

const designToolTypes: Array<{ type: DesignBlock['type']; label: string; description: string }> = [
  { type: 'text', label: 'Metin', description: 'Sabit başlık veya açıklama' },
  { type: 'variable', label: 'Değişken', description: 'Dosya, birey veya yardım verisi' },
  { type: 'barcode', label: 'Barkod', description: 'Barkod alanı' },
  { type: 'qrcode', label: 'QR Kod', description: 'QR kod alanı' },
  { type: 'line', label: 'Çizgi', description: 'Ayırıcı çizgi' },
]

const formDesignTypes: Array<{ value: FormDesign['type']; label: string; size: string }> = [
  { value: 'label', label: 'Etiket', size: 'Barkod yazıcı' },
  { value: 'barcode', label: 'Küçük Barkod', size: 'Kompakt çıktı' },
  { value: 'a4', label: 'A4 Form', size: '210 x 297 mm' },
]

const assistanceTemplateOptions = [
  'Tümü',
  'Dosya',
  'Aceze',
  'Ekmek',
  'Gıda Bankası',
  'Hazır Yemek',
  'Destek Paketi',
  'Giyim',
  'Ayni/Nakdi',
  'Dönem Dışı Gıda',
  'Kırtasiye',
  'Yakacak',
  'Emtia',
  'Diğer Kurum Yardımı',
]

const commonAidFields: ReportField[] = [
  { token: 'yardim.id', label: 'Yardım ID', source: 'seçili yardım.id' },
  { token: 'yardim.turu', label: 'Yardım Türü', source: 'seçili yardım.type' },
  { token: 'yardim.muracaat_eden', label: 'Müracaat Eden', source: 'seçili yardım.muracaateden' },
  { token: 'yardim.tc', label: 'Yardım T.C. Kimlik No', source: 'seçili yardım.tckimlikno' },
  { token: 'yardim.telefon', label: 'Yardım Telefon', source: 'seçili yardım.ceptel' },
  { token: 'yardim.muracaat_tarihi', label: 'Müracaat Tarihi', source: 'seçili yardım.muracaattarihi' },
  { token: 'yardim.bas_tarih', label: 'Başlangıç Tarihi', source: 'seçili yardım.bastarih' },
  { token: 'yardim.bit_tarih', label: 'Bitiş Tarihi', source: 'seçili yardım.bittarih' },
  { token: 'yardim.miktar', label: 'Miktar', source: 'seçili yardım.miktar' },
  { token: 'yardim.durum', label: 'Yardım Durumu', source: 'seçili yardım.durumu' },
  { token: 'yardim.donem', label: 'Dönem', source: 'seçili yardım.donem' },
  { token: 'yardim.etiket', label: 'Etiket', source: 'seçili yardım.etiket' },
  { token: 'yardim.aciklama', label: 'Yardım Açıklama', source: 'seçili yardım.aciklama' },
  { token: 'yardim.odeme_gunu', label: 'Ödeme Günü', source: 'seçili yardım.odemegunu' },
]

const reportFieldGroups: ReportFieldGroup[] = [
  {
    id: 'dosya',
    title: 'Dosyalar',
    fields: [
      { token: 'dosya.id', label: 'Dosya ID', source: 'dosyalar.id' },
      { token: 'dosya.dosyano', label: 'Dosya No', source: 'dosyalar.dosyano' },
      { token: 'dosya.muracaat_tarihi', label: 'Dosya Müracaat Tarihi', source: 'dosyalar.muracaattarihi' },
      { token: 'dosya.durum', label: 'Dosya Durumu', source: 'dosyalar.durumu' },
      { token: 'dosya.durum_tarihi', label: 'Dosya Durum Tarihi', source: 'dosyalar.durumutarih' },
      { token: 'dosya.durum_aciklama', label: 'Dosya Durum Açıklama', source: 'dosyalar.durumuaciklama' },
      { token: 'dosya.mahalle', label: 'Mahalle', source: 'dosyalar.mahalleadi' },
      { token: 'dosya.cadde', label: 'Cadde', source: 'dosyalar.cadde' },
      { token: 'dosya.sokak', label: 'Sokak', source: 'dosyalar.sokak' },
      { token: 'dosya.site', label: 'Site', source: 'dosyalar.site' },
      { token: 'dosya.blok', label: 'Blok', source: 'dosyalar.blok' },
      { token: 'dosya.bina_no', label: 'Bina No', source: 'dosyalar.binano' },
      { token: 'dosya.daire_no', label: 'Daire No', source: 'dosyalar.daireno' },
      { token: 'dosya.adres', label: 'Açık Adres', source: 'dosyalar.adres' },
      { token: 'dosya.telefon', label: 'Telefon', source: 'dosyalar.telefon' },
      { token: 'dosya.adres_no', label: 'Adres No', source: 'dosyalar.adresno' },
      { token: 'dosya.kart_no', label: 'Kart No', source: 'dosyalar.kartno' },
      { token: 'dosya.toplam_birey', label: 'Toplam Birey', source: 'dosyalar.topbirey' },
      { token: 'dosya.aciklama', label: 'Dosya Açıklama', source: 'dosyalar.aciklama' },
      { token: 'dosya.kayit_tarihi', label: 'İlk Kayıt Tarihi', source: 'dosyalar.ilkislemtarihi' },
      { token: 'dosya.guncelleme_tarihi', label: 'Güncelleme Tarihi', source: 'dosyalar.islemtarihi' },
      { token: 'dosya.konum_enlem', label: 'Konum Enlem', source: 'dosyalar.konum_enlem' },
      { token: 'dosya.konum_boylam', label: 'Konum Boylam', source: 'dosyalar.konum_boylam' },
    ],
  },
  {
    id: 'birey',
    title: 'Bireyler ve Hane',
    fields: [
      { token: 'kisi.id', label: 'Birey ID', source: 'bireyler.id' },
      { token: 'kisi.tc', label: 'T.C. Kimlik No', source: 'bireyler.tckimlikno' },
      { token: 'kisi.ad', label: 'Ad', source: 'bireyler.adi' },
      { token: 'kisi.soyad', label: 'Soyad', source: 'bireyler.soyadi' },
      { token: 'kisi.ad_soyad', label: 'Ad Soyad', source: 'bireyler.adisoyadi' },
      { token: 'kisi.baba_adi', label: 'Baba Adı', source: 'bireyler.babaadi' },
      { token: 'kisi.ana_adi', label: 'Ana Adı', source: 'bireyler.anaadi' },
      { token: 'kisi.dogum_yeri', label: 'Doğum Yeri', source: 'bireyler.dogumyeri' },
      { token: 'kisi.dogum_tarihi', label: 'Doğum Tarihi', source: 'bireyler.dogumtarihi' },
      { token: 'kisi.olum_tarihi', label: 'Ölüm Tarihi', source: 'bireyler.olumtarihi' },
      { token: 'kisi.cinsiyet', label: 'Cinsiyet', source: 'bireyler.cinsiyeti' },
      { token: 'kisi.yakinlik', label: 'Yakınlık', source: 'bireyler.yakinligi' },
      { token: 'kisi.uyruk', label: 'Uyruk', source: 'bireyler.uyrugu' },
      { token: 'kisi.medeni_hal', label: 'Medeni Hal', source: 'bireyler.medenihali' },
      { token: 'kisi.saglik', label: 'Sağlık Durumu', source: 'bireyler.saglikdurumu' },
      { token: 'kisi.telefon', label: 'Cep Telefonu', source: 'bireyler.ceptel' },
      { token: 'kisi.iban', label: 'IBAN', source: 'bireyler.iban' },
      { token: 'kisi.adres', label: 'Birey Adresi', source: 'bireyler.adres' },
      { token: 'kisi.adres_no', label: 'Birey Adres No', source: 'bireyler.adresno' },
      { token: 'kisi.resim', label: 'Birey Fotoğrafı', source: 'bireyresim.resim' },
      { token: 'hane.kisi_sayisi', label: 'Hane Kişi Sayısı', source: 'dosyalar.topbirey' },
      { token: 'hane.konut_turu', label: 'Konut Türü', source: 'dosyalar.konutturu' },
      { token: 'hane.isinma_turu', label: 'Isınma Türü', source: 'dosyalar.isinmaturu' },
      { token: 'hane.mulkiyet', label: 'Mülkiyet Durumu', source: 'dosyalar.mulkiyetdurumu' },
      { token: 'hane.kira', label: 'Kira Miktarı', source: 'dosyalar.kiramiktari' },
    ],
  },
  { id: 'yardim_ortak', title: 'Ortak Yardım Alanları', fields: commonAidFields },
  {
    id: 'ekmek',
    title: 'Ekmek Yardımı',
    fields: [
      { token: 'ekmek.durak', label: 'Durak Adı', source: 'yrd_ekmek.durakadi' },
      { token: 'ekmek.kart_no', label: 'Kart No', source: 'yrd_ekmek.kartno' },
      { token: 'ekmek.kart_tarih', label: 'Kart Tarihi', source: 'yrd_ekmek.karttarih' },
      { token: 'ekmek.kart_aciklama', label: 'Kart Açıklama', source: 'yrd_ekmek.kartaciklama' },
    ],
  },
  {
    id: 'gida',
    title: 'Gıda Bankası',
    fields: [
      { token: 'gida.odeme_gunu', label: 'Ödeme Günü', source: 'yrd_gidabankasi.odemegunu' },
      { token: 'gida.enson_donem', label: 'En Son Dönem', source: 'yrd_gidabankasi.ensondonem' },
      { token: 'gida.donem_adi', label: 'Dönem Adı', source: 'yrd_gidabankasi.donemadi' },
    ],
  },
  {
    id: 'destekpaketi',
    title: 'Destek Paketi',
    fields: [
      { token: 'destekpaketi.odeme_gunu', label: 'Ödeme Günü', source: 'yrd_destekpaketi.odemegunu' },
      { token: 'destekpaketi.enson_donem', label: 'En Son Dönem', source: 'yrd_destekpaketi.ensondonem' },
    ],
  },
  {
    id: 'haziryemek',
    title: 'Hazır Yemek',
    fields: [
      { token: 'haziryemek.kisi_sayisi', label: 'Kişi Sayısı', source: 'yrd_haziryemek.kisisayisi' },
      { token: 'haziryemek.ekmek_miktari', label: 'Ekmek Miktarı', source: 'yrd_haziryemek.ekmekmiktari' },
    ],
  },
  {
    id: 'aceze',
    title: 'Aceze Yardımı',
    fields: [
      { token: 'aceze.id', label: 'Aceze Kayıt No', source: 'yrd_aceze.id' },
      { token: 'aceze.tc', label: 'T.C. Kimlik No', source: 'yrd_aceze.tckimlikno' },
      { token: 'aceze.ad_soyad', label: 'Ad Soyad', source: 'yrd_aceze.adisoyadi' },
      { token: 'aceze.baba_adi', label: 'Baba Adı', source: 'yrd_aceze.babaadi' },
      { token: 'aceze.ana_adi', label: 'Ana Adı', source: 'yrd_aceze.anaadi' },
      { token: 'aceze.dogum_yeri', label: 'Doğum Yeri', source: 'yrd_aceze.dogumyeri' },
      { token: 'aceze.dogum_tarihi', label: 'Doğum Tarihi', source: 'yrd_aceze.dogumtarihi' },
      { token: 'aceze.uyruk', label: 'Uyruğu', source: 'yrd_aceze.uyrugu' },
      { token: 'aceze.medeni_hal', label: 'Medeni Hali', source: 'yrd_aceze.medenihali' },
      { token: 'aceze.cinsiyet', label: 'Cinsiyeti', source: 'yrd_aceze.cinsiyeti' },
      { token: 'aceze.nufusa_kayitli_il', label: 'Nüfusa Kayıtlı İl', source: 'yrd_aceze.nufuskytili' },
      { token: 'aceze.telefon', label: 'Telefon No', source: 'yrd_aceze.ceptel' },
      { token: 'aceze.kisi_sayisi', label: 'Kişi Sayısı', source: 'yrd_aceze.kisisayisi' },
      { token: 'aceze.tarih', label: 'Başvuru Tarihi', source: 'yrd_aceze.tarih' },
      { token: 'aceze.saglik_durumu', label: 'Sağlık Durumu', source: 'yrd_aceze.saglikdurumu' },
      { token: 'aceze.hastalik', label: 'Hastalık Adı', source: 'yrd_aceze.hastalikadi' },
      { token: 'aceze.gidecegi_yer', label: 'Gideceği Yer', source: 'yrd_aceze.gidecegiyer' },
      { token: 'aceze.neden', label: 'Nedeni', source: 'yrd_aceze.nedeni' },
    ],
  },
  {
    id: 'ayninakdi',
    title: 'Ayni/Nakdi Yardım',
    fields: [
      { token: 'ayninakdi.asama', label: 'Aşama', source: 'yrd_ayninakti.asama' },
      { token: 'ayninakdi.iban', label: 'IBAN', source: 'yrd_ayninakti.iban' },
      { token: 'ayninakdi.aylik_gelir', label: 'Aylık Gelir', source: 'yrd_ayninakti.aylikgelir' },
    ],
  },
  {
    id: 'ddgida',
    title: 'Dönem Dışı Gıda',
    fields: [
      { token: 'ddgida.neden', label: 'Nedeni', source: 'yrd_ddgidadosyali.nedeni' },
      { token: 'ddgida.yetkili', label: 'Yetkili', source: 'yrd_ddgidadosyali.yetkiliadi' },
    ],
  },
  {
    id: 'giyim',
    title: 'Giyim Yardımı',
    fields: [
      { token: 'giyim.miktar', label: 'Miktar', source: 'yrd_giyim.miktar' },
    ],
  },
  {
    id: 'kirtasiye',
    title: 'Kırtasiye Yardımı',
    fields: [
      { token: 'kirtasiye.kisi_sayisi', label: 'Kişi Sayısı', source: 'yrd_kirtasiye.kisisayisi' },
    ],
  },
  {
    id: 'yakacak',
    title: 'Yakacak Yardımı',
    fields: [
      { token: 'yakacak.miktar', label: 'Miktar', source: 'yrd_yakacak.miktar' },
    ],
  },
  {
    id: 'emtia',
    title: 'Emtia Yardımı',
    fields: [
      { token: 'emtia.miktar', label: 'Miktar', source: 'yrd_emtia.miktar' },
    ],
  },
  {
    id: 'diger_kurum',
    title: 'Diğer Kurum Yardımı',
    fields: [
      { token: 'diger_kurum.kurum', label: 'Kurum Adı', source: 'yrd_digerkrmalyrdm.yardimalkrmadi' },
      { token: 'diger_kurum.yardim_turu', label: 'Yardım Türü', source: 'yrd_digerkrmalyrdm.yardimturu' },
      { token: 'diger_kurum.aciklama', label: 'Açıklama', source: 'yrd_digerkrmalyrdm.aciklama' },
    ],
  },
  {
    id: 'sistem',
    title: 'Çıktı ve Sistem',
    fields: [
      { token: 'cikti.tarih', label: 'Çıktı Tarihi', source: 'sistem' },
      { token: 'cikti.saat', label: 'Çıktı Saati', source: 'sistem' },
      { token: 'cikti.kullanici', label: 'Hazırlayan Kullanıcı', source: 'sistem' },
      { token: 'kurum.adi', label: 'Kurum Adı', source: 'ayarlar.kurumadi' },
      { token: 'kurum.adres', label: 'Kurum Adresi', source: 'ayarlar.adres' },
      { token: 'kurum.telefon', label: 'Kurum Telefonu', source: 'ayarlar.telefon1' },
      { token: 'barkod_no', label: 'Barkod No', source: 'üretilen değer' },
      { token: 'qr_dosya_url', label: 'Dosya QR', source: 'üretilen değer' },
    ],
  },
]

const fieldTabs: Array<{ id: string; title: string; groupIds: string[] }> = [
  { id: 'dosyalar', title: 'Dosyalar', groupIds: ['dosya'] },
  { id: 'bireyler', title: 'Bireyler', groupIds: ['birey'] },
  { id: 'yardimlar', title: 'Yardımlar', groupIds: ['yardim_ortak', 'ekmek', 'gida', 'destekpaketi', 'haziryemek', 'aceze', 'ayninakdi', 'ddgida', 'giyim', 'kirtasiye', 'yakacak', 'emtia', 'diger_kurum'] },
  { id: 'sistem', title: 'Çıktı ve Sistem', groupIds: ['sistem'] },
]

const assistanceFieldGroupMap: Record<string, string> = {
  aceze: 'aceze',
  ekmek: 'ekmek',
  'gıda bankası': 'gida',
  'hazır yemek': 'haziryemek',
  'destek paketi': 'destekpaketi',
  giyim: 'giyim',
  'ayni/nakdi': 'ayninakdi',
  'dönem dışı gıda': 'ddgida',
  kırtasiye: 'kirtasiye',
  yakacak: 'yakacak',
  emtia: 'emtia',
  'diğer kurum yardımı': 'diger_kurum',
}

const bandLabels: Record<ReportBand['type'], string> = {
  ReportTitle: 'Rapor Başlığı',
  PageHeader: 'Üstbilgi',
  MasterData: 'Ana Veri',
  PageFooter: 'Altbilgi',
}

const inputClassName = 'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-lg font-semibold text-slate-800 outline-none transition focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100'
const smallButtonClassName = 'h-10 rounded-md border border-slate-300 bg-white px-3 text-lg font-extrabold text-slate-700 transition hover:border-[#0076b6] hover:text-[#0076b6]'
const clientPrinterConfigStorageKey = 'netsosyal:form-designer:client-printer-config'
const clientPrinterPreferencesStorageKey = 'netsosyal:form-designer:client-printer-preferences'
const clientPrinterNamesStorageKey = 'netsosyal:form-designer:client-printer-names'
const localPrintAgentUrl = 'http://127.0.0.1:17834/print'
// Kullanici istegi (2026-09-29): "agent sürümü eski diyor" hatasi - bkz.
// documents/page.tsx'teki ayni tarihli duzeltme notu. Tek kaynaktan okunur.
const requiredPrintAgentVersion = REQUIRED_PRINT_AGENT_VERSION
const directPrintAgentEnabled = false
const localPrintAgentPrintersUrl = 'http://127.0.0.1:17834/printers'

function readStoredClientPrinterConfig(): ClientPrinterConfig {
  if (typeof window === 'undefined') return {}

  try {
    const storedConfig = window.localStorage.getItem(clientPrinterConfigStorageKey)
    return storedConfig ? (JSON.parse(storedConfig) as ClientPrinterConfig) : {}
  } catch {
    return {}
  }
}

function readStoredClientPrinterPreferences() {
  if (typeof window === 'undefined') return {}

  try {
    const storedPreferences = window.localStorage.getItem(clientPrinterPreferencesStorageKey)
    return storedPreferences ? (JSON.parse(storedPreferences) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function readStoredClientPrinterNames() {
  if (typeof window === 'undefined') return []

  try {
    const storedNames = window.localStorage.getItem(clientPrinterNamesStorageKey)
    const parsedNames = storedNames ? (JSON.parse(storedNames) as string[]) : []
    return Array.isArray(parsedNames) ? parsedNames.filter(Boolean) : []
  } catch {
    return []
  }
}

function normalizePrinterConfigKey(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr-TR')
}

export default function FormDesignerPage() {
  const localIdCounterRef = useRef(0)
  const copiedBlocksRef = useRef<DesignBlock[]>([])
  const pasteTargetRef = useRef<{ designId: string; bandId: string; x: number; y: number } | null>(null)
  const [formDesigns, setFormDesigns] = useState<FormDesign[]>([])
  const [selectedFormDesignId, setSelectedFormDesignId] = useState<string | null>(null)
  const [draggedTool, setDraggedTool] = useState<DesignBlock['type'] | null>(null)
  const [draggedField, setDraggedField] = useState<ReportField | null>(null)
  const [draggedBlock, setDraggedBlock] = useState<{ designId: string; blockId: string; offsetX: number; offsetY: number } | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [multiEdgeOffsets, setMultiEdgeOffsets] = useState({ left: '', right: '', top: '', bottom: '' })
  const [multiBlockGaps, setMultiBlockGaps] = useState({ horizontal: '', vertical: '' })
  const [selectionMarquee, setSelectionMarquee] = useState<{
    bandId: string
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null)
  const [fieldSearch, setFieldSearch] = useState('')
  const [activeFieldGroupId, setActiveFieldGroupId] = useState(reportFieldGroups[0].id)
  const [activeFieldTabId, setActiveFieldTabId] = useState(fieldTabs[0].id)
  const [openFieldGroupIds, setOpenFieldGroupIds] = useState<string[]>(['dosya'])
  const [formDesignStatus, setFormDesignStatus] = useState('')
  const [isSavingFormDesigns, setIsSavingFormDesigns] = useState(false)
  const [isFullscreenDesigner, setIsFullscreenDesigner] = useState(false)
  const [isDesignSettingsOpen, setIsDesignSettingsOpen] = useState(false)
  const [designerZoom, setDesignerZoom] = useState(100)
  const [clientPrinterConfig, setClientPrinterConfig] = useState<ClientPrinterConfig>(readStoredClientPrinterConfig)
  const [clientPrinterPreferences, setClientPrinterPreferences] = useState<Record<string, string>>(readStoredClientPrinterPreferences)
  const [clientPrinterNames, setClientPrinterNames] = useState<string[]>(readStoredClientPrinterNames)
  const [clientPrinterDiscoveryStatus, setClientPrinterDiscoveryStatus] = useState('')

  const createLocalId = (prefix: string) => {
    localIdCounterRef.current += 1
    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    return `${prefix}_${localIdCounterRef.current}_${randomPart}`
  }

  const ensureUniqueBlockIds = (designs: FormDesign[]) =>
    designs.map((design) => {
      const usedIds = new Set<string>()
      let repaired = false
      const blocks = (design.blocks || []).map((block) => {
        if (block.id && !usedIds.has(block.id)) {
          usedIds.add(block.id)
          return block
        }
        repaired = true
        const uniqueId = createLocalId('blk')
        usedIds.add(uniqueId)
        return { ...block, id: uniqueId }
      })
      return repaired ? { ...design, blocks } : design
    })

  const dummyPrintData = {
    yardim: {
      id: 'Y-12345',
      turu: 'Ekmek',
      muracaat_eden: 'Ahmet Yılmaz',
      tc: '12345678901',
      telefon: '0555 555 5555',
      miktar: '30',
      durum: 'Aktif',
      aciklama: 'Aylık rutin yardım',
      bas_tarih: '01.01.2026',
      bit_tarih: '31.12.2026',
      donem: '2026/1',
      etiket: 'Aktif yardım',
      odeme_gunu: '15',
    },
    kisi: {
      id: 'B-100',
      tc: '12345678901',
      ad: 'Ahmet',
      soyad: 'Yılmaz',
      ad_soyad: 'Ahmet Yılmaz',
      baba_adi: 'Mehmet',
      ana_adi: 'Ayşe',
      dogum_yeri: 'Sivas',
      dogum_tarihi: '01.01.1980',
      cinsiyet: 'Erkek',
      yakinlik: 'Kendisi',
      uyruk: 'TC',
      medeni_hal: 'Evli',
      saglik: 'Sağlıklı',
      telefon: '0555 555 5555',
      adres: 'Örnek Mah. Test Sok. No:1',
      adres_no: '123456',
      resim: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22150%22 viewBox=%220 0 120 150%22%3E%3Crect width=%22120%22 height=%22150%22 fill=%22%23e2e8f0%22/%3E%3Ccircle cx=%2260%22 cy=%2250%22 r=%2226%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22M18 142c3-35 20-55 42-55s39 20 42 55%22 fill=%22%2394a3b8%22/%3E%3C/svg%3E',
    },
    hane: { kisi_sayisi: '4', konut_turu: 'Apartman', isinma_turu: 'Doğalgaz', mulkiyet: 'Kiracı', kira: '4500' },
    dosya: {
      id: 'D-98765',
      dosyano: '2026/0001',
      muracaat_tarihi: '02.01.2026',
      durum: 'Aktif',
      mahalle: 'Örnek Mah.',
      cadde: 'Cumhuriyet Cad.',
      sokak: 'Test Sok.',
      bina_no: '1',
      daire_no: '5',
      adres: 'Örnek Mah. Test Sok. No:1/5',
      telefon: '0346 000 00 00',
      adres_no: '123456',
      kart_no: 'K-123',
      toplam_birey: '4',
      aciklama: 'Örnek dosya açıklaması',
    },
    ekmek: { durak: 'Merkez Durak', kart_no: 'EK-100', kart_tarih: '02.01.2026', kart_aciklama: 'Kart teslim edildi' },
    gida: { odeme_gunu: '15', enson_donem: '2026/1', donem_adi: 'Ocak 2026' },
    destekpaketi: { odeme_gunu: '20', enson_donem: '2026/1' },
    haziryemek: { kisi_sayisi: '2', ekmek_miktari: '4' },
    aceze: {
      id: 'A-1001',
      tc: '12345678901',
      ad_soyad: 'Ahmet Yılmaz',
      baba_adi: 'Mehmet',
      ana_adi: 'Ayşe',
      dogum_yeri: 'Sivas',
      dogum_tarihi: '01.01.1980',
      uyruk: 'TC',
      medeni_hal: 'Evli',
      cinsiyet: 'Erkek',
      nufusa_kayitli_il: 'Sivas',
      telefon: '0555 555 5555',
      kisi_sayisi: '2',
      tarih: '29.07.2026',
      saglik_durumu: 'Sağlıklı',
      hastalik: '-',
      gidecegi_yer: 'Ankara',
      neden: 'Tedavi',
    },
    ayninakdi: { asama: 'Kira Desteği', iban: 'TR00 0000 0000 0000 0000 0000 00', aylik_gelir: '12000' },
    cikti: { tarih: new Date().toLocaleDateString('tr-TR'), saat: new Date().toLocaleTimeString('tr-TR'), kullanici: 'Sistem Kullanıcısı' },
    kurum: { adi: 'Sosyal Yardım İşleri', adres: 'Sivas', telefon: '0346 000 00 00' },
    barkod_no: '20260001',
    qr_dosya_url: 'https://ornek.local/dosya/2026-0001',
  }

  const loadFormDesigns = async () => {
    try {
      const response = await fetch('/api/settings/form_design_templates')
      if (response.status === 404) return

      const payload = (await response.json()) as SettingResponse<FormDesign[]>
      if (!response.ok || !payload.success || !Array.isArray(payload.data?.value)) {
        throw new Error(payload.error || 'Form tasarımları alınamadı.')
      }

      const normalizedDesigns = ensureUniqueBlockIds(payload.data.value)
      setFormDesigns(normalizedDesigns)
      if (normalizedDesigns.length > 0) {
        setSelectedFormDesignId(normalizedDesigns[0].id)
      }
    } catch (loadError) {
      setFormDesignStatus((loadError as Error).message)
    }
  }

  useEffect(() => {
    let isCancelled = false

    if (!isCancelled) {
      loadFormDesigns()
    }

    return () => {
      isCancelled = true
    }
  }, [])

  const selectedFormDesign = formDesigns.find((design) => design.id === selectedFormDesignId)
  const selectedBlock = selectedFormDesign?.blocks?.find((block) => block.id === selectedBlockId)
  const selectedBand = selectedFormDesign?.bands?.find((band) => band.id === selectedBandId)
  const activeDesignerBand = selectedBand || selectedFormDesign?.bands?.[0]

  useEffect(() => {
    const firstBandId = selectedFormDesign?.bands?.[0]?.id ?? null
    setSelectedBandId(firstBandId)
    setSelectedBlockId(null)
    setSelectedBlockIds([])
  }, [selectedFormDesignId])

  const selectDesignerBlock = (blockId: string, additive = false) => {
    const targetBandId = selectedFormDesign?.blocks?.find((block) => block.id === blockId)?.bandId
    if (!additive) {
      setSelectedBlockIds([blockId])
      setSelectedBlockId(blockId)
      if (targetBandId) setSelectedBandId(targetBandId)
      return
    }

    const exists = selectedBlockIds.includes(blockId)
    const next = exists ? selectedBlockIds.filter((id) => id !== blockId) : [...selectedBlockIds, blockId]
    setSelectedBlockIds(next)
    setSelectedBlockId(exists ? next.at(-1) ?? null : blockId)
    if (!exists && targetBandId) setSelectedBandId(targetBandId)
  }

  const selectAllDesignerBlocks = () => {
    const blockIds = (selectedFormDesign?.blocks || []).map((block) => block.id)
    if (!blockIds.length) return
    setSelectedBlockIds(blockIds)
    setSelectedBlockId((current) => (current && blockIds.includes(current) ? current : blockIds[0]))
  }

  const alignSelectedBlocks = (alignment: 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y') => {
    if (!selectedFormDesign || selectedBlockIds.length < 2) return
    const selectedIds = new Set(selectedBlockIds)
    const blocks = (selectedFormDesign.blocks || []).filter((block) => selectedIds.has(block.id))
    if (blocks.length < 2) return

    const left = Math.min(...blocks.map((block) => block.x))
    const right = Math.max(...blocks.map((block) => block.x + (block.width || 0)))
    const top = Math.min(...blocks.map((block) => block.y))
    const bottom = Math.max(...blocks.map((block) => block.y + (block.height || 0)))
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2

    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === selectedFormDesign.id
          ? {
              ...design,
              blocks: (design.blocks || []).map((block) => {
                if (!selectedIds.has(block.id)) return block
                if (alignment === 'left') return { ...block, x: Math.round(left) }
                if (alignment === 'right') return { ...block, x: Math.round(right - (block.width || 0)) }
                if (alignment === 'top') return { ...block, y: Math.round(top) }
                if (alignment === 'bottom') return { ...block, y: Math.round(bottom - (block.height || 0)) }
                if (alignment === 'center-x') return { ...block, x: Math.round(centerX - (block.width || 0) / 2) }
                return { ...block, y: Math.round(centerY - (block.height || 0) / 2) }
              }),
            }
          : design,
      ),
    )
  }

  const positionSelectedBlocksFromEdge = (edge: 'left' | 'right' | 'top' | 'bottom') => {
    if (!selectedFormDesign || selectedBlockIds.length < 2) return
    const rawValue = Number(multiEdgeOffsets[edge])
    if (!Number.isFinite(rawValue)) return

    const offset = Math.max(0, Math.round(rawValue))
    const selectedIds = new Set(selectedBlockIds)
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === selectedFormDesign.id
          ? {
              ...design,
              blocks: (design.blocks || []).map((block) => {
                if (!selectedIds.has(block.id)) return block
                if (edge === 'left') return { ...block, x: offset }
                if (edge === 'right') {
                  return { ...block, x: Math.max(0, Math.round(canvasMetrics.width - offset - (block.width || 0))) }
                }
                if (edge === 'top') return { ...block, y: offset }

                const band = design.bands?.find((item) => item.id === block.bandId)
                const bandHeight = band
                  ? design.type === 'a4'
                    ? band.height
                    : Math.max(band.height, canvasMetrics.minHeight)
                  : canvasMetrics.minHeight
                return { ...block, y: Math.max(0, Math.round(bandHeight - offset - (block.height || 0))) }
              }),
            }
          : design,
      ),
    )
  }

  const spaceSelectedBlocks = (direction: 'horizontal' | 'vertical') => {
    if (!selectedFormDesign || selectedBlockIds.length < 2) return
    const rawGap = Number(multiBlockGaps[direction])
    if (!Number.isFinite(rawGap)) return
    const gap = Math.max(0, Math.round(rawGap))
    const selectedIds = new Set(selectedBlockIds)

    setFormDesigns((prev) =>
      prev.map((design) => {
        if (design.id !== selectedFormDesign.id) return design
        const updatedPositions = new Map<string, { x: number; y: number }>()
        const blocksByBand = new Map<string, DesignBlock[]>()

        ;(design.blocks || []).forEach((block) => {
          if (!selectedIds.has(block.id)) return
          const bandKey = block.bandId || ''
          blocksByBand.set(bandKey, [...(blocksByBand.get(bandKey) || []), block])
        })

        blocksByBand.forEach((blocks) => {
          if (direction === 'vertical') {
            const orderedByRow = [...blocks].sort((first, second) => first.y - second.y || first.x - second.x)
            const rows: Array<{ anchorY: number; blocks: DesignBlock[] }> = []
            orderedByRow.forEach((block) => {
              const currentRow = rows.at(-1)
              if (currentRow && Math.abs(block.y - currentRow.anchorY) <= 3) {
                currentRow.blocks.push(block)
              } else {
                rows.push({ anchorY: block.y, blocks: [block] })
              }
            })
            if (rows.length < 2) return

            const firstRowY = rows[0].anchorY
            rows.forEach((row, rowIndex) => {
              const targetRowY = firstRowY + rowIndex * gap
              const deltaY = targetRowY - row.anchorY
              row.blocks.forEach((block) => {
                updatedPositions.set(block.id, { x: block.x, y: Math.round(block.y + deltaY) })
              })
            })
            return
          }

          const ordered = [...blocks].sort((first, second) =>
            direction === 'horizontal'
              ? first.x - second.x || first.y - second.y
              : first.y - second.y || first.x - second.x,
          )
          if (ordered.length < 2) return

          let cursor = direction === 'horizontal' ? ordered[0].x : ordered[0].y
          ordered.forEach((block, index) => {
            if (index === 0) {
              updatedPositions.set(block.id, { x: block.x, y: block.y })
              const size = direction === 'horizontal'
                ? block.width || Math.max(24, (block.value?.length || 1) * (block.fontSize || 14) * 0.55)
                : block.height || Math.max(18, (block.fontSize || 14) * 1.3)
              cursor += size + gap
              return
            }

            updatedPositions.set(
              block.id,
              direction === 'horizontal' ? { x: Math.round(cursor), y: block.y } : { x: block.x, y: Math.round(cursor) },
            )
            const size = direction === 'horizontal'
              ? block.width || Math.max(24, (block.value?.length || 1) * (block.fontSize || 14) * 0.55)
              : block.height || Math.max(18, (block.fontSize || 14) * 1.3)
            cursor += size + gap
          })
        })

        return {
          ...design,
          blocks: (design.blocks || []).map((block) => {
            const position = updatedPositions.get(block.id)
            return position ? { ...block, ...position } : block
          }),
        }
      }),
    )
  }
  const selectedFormDesignIsLegacy = selectedFormDesign?.id.startsWith('legacy_dizayn_') ?? false
  const resolveClientPrinterNameForDesign = (design: FormDesign) => {
    const manuallySelectedPrinter = clientPrinterPreferences[design.id]?.trim()
    if (manuallySelectedPrinter) return manuallySelectedPrinter

    const normalizedDesignName = normalizePrinterConfigKey(design.name)
    const designPrinter = Object.entries(clientPrinterConfig.designPrinters || {}).find(([designName]) => normalizePrinterConfigKey(designName) === normalizedDesignName)?.[1]?.trim()
    if (designPrinter) return designPrinter

    return ''
  }
  const selectedClientPrinterName = selectedFormDesign ? resolveClientPrinterNameForDesign(selectedFormDesign) : ''
  const selectedClientPrinterSource = selectedFormDesign && selectedClientPrinterName
    ? clientPrinterPreferences[selectedFormDesign.id]?.trim()
      ? 'Manuel kayıt'
      : 'JSON eşleşmesi'
    : ''

  const saveClientPrinterNames = (printerNames: string[]) => {
    const uniquePrinterNames = Array.from(new Set(printerNames.map((name) => name.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr'))

    setClientPrinterNames(uniquePrinterNames)
    window.localStorage.setItem(clientPrinterNamesStorageKey, JSON.stringify(uniquePrinterNames))
  }

  const updateClientPrinterPreference = (designId: string, printerName: string) => {
    const nextPreferences = { ...clientPrinterPreferences, [designId]: printerName }

    if (!printerName.trim()) {
      delete nextPreferences[designId]
    }

    setClientPrinterPreferences(nextPreferences)
    window.localStorage.setItem(clientPrinterPreferencesStorageKey, JSON.stringify(nextPreferences))
  }

  const saveClientPrinterPreference = (designId: string, printerName: string) => {
    const normalizedPrinterName = printerName.trim()

    updateClientPrinterPreference(designId, normalizedPrinterName)
    const targetDesign = formDesigns.find((design) => design.id === designId)
    if (targetDesign) {
      const nextConfig: ClientPrinterConfig = {
        ...clientPrinterConfig,
        printers: Array.from(new Set([...(clientPrinterConfig.printers || []), ...clientPrinterNames, normalizedPrinterName].map((name) => String(name).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
        designPrinters: { ...(clientPrinterConfig.designPrinters || {}) },
        assistancePrinters: { ...(clientPrinterConfig.assistancePrinters || {}) },
      }

      if (normalizedPrinterName) {
        nextConfig.designPrinters![targetDesign.name] = normalizedPrinterName
      } else {
        delete nextConfig.designPrinters![targetDesign.name]
      }

      setClientPrinterConfig(nextConfig)
      window.localStorage.setItem(clientPrinterConfigStorageKey, JSON.stringify(nextConfig))
    }

    if (normalizedPrinterName) {
      saveClientPrinterNames([...clientPrinterNames, normalizedPrinterName])
      setFormDesignStatus('Yazıcı tercihi bu bilgisayarda kaydedildi.')
    } else {
      setFormDesignStatus('Yazıcı tercihi bu bilgisayardan temizlendi.')
    }
  }

  const applyClientPrinterConfig = (config: ClientPrinterConfig) => {
    const nextConfig: ClientPrinterConfig = {
      printers: Array.isArray(config.printers) ? config.printers : [],
      preferences: config.preferences || {},
      designPrinters: config.designPrinters || {},
      assistancePrinters: config.assistancePrinters || {},
    }
    const importedPrinters = Array.isArray(config.printers) ? config.printers : []
    const configuredPrinterNames = [
      ...Object.values(config.preferences || {}),
      ...Object.values(config.designPrinters || {}),
      ...Object.values(config.assistancePrinters || {}),
    ]
    const nextPrinterNames = Array.from(new Set([...clientPrinterNames, ...importedPrinters, ...configuredPrinterNames].map((name) => String(name).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr'))
    const nextPreferences = { ...clientPrinterPreferences }
    let appliedPreferenceCount = 0
    const designsByNormalizedName = new Map(formDesigns.map((design) => [normalizePrinterConfigKey(design.name), design]))
    Object.entries(config.preferences || {}).forEach(([designId, printerName]) => {
      const normalizedPrinterName = String(printerName).trim()
      if (normalizedPrinterName) {
        nextPreferences[designId] = normalizedPrinterName
        appliedPreferenceCount += 1
      }
    })

    Object.entries(config.designPrinters || {}).forEach(([designName, printerName]) => {
      const normalizedPrinterName = String(printerName).trim()
      const matchingDesign = designsByNormalizedName.get(normalizePrinterConfigKey(designName))

      if (matchingDesign && normalizedPrinterName) {
        nextPreferences[matchingDesign.id] = normalizedPrinterName
        appliedPreferenceCount += 1
      }
    })

    Object.values(nextPreferences).forEach((printerName) => {
      const normalizedPrinterName = String(printerName).trim()
      if (normalizedPrinterName && !nextPrinterNames.includes(normalizedPrinterName)) {
        nextPrinterNames.push(normalizedPrinterName)
      }
    })

    const sortedPrinterNames = nextPrinterNames.sort((a, b) => a.localeCompare(b, 'tr'))

    setClientPrinterNames(sortedPrinterNames)
    setClientPrinterConfig(nextConfig)
    setClientPrinterPreferences(nextPreferences)
    window.localStorage.setItem(clientPrinterConfigStorageKey, JSON.stringify(nextConfig))
    window.localStorage.setItem(clientPrinterNamesStorageKey, JSON.stringify(sortedPrinterNames))
    window.localStorage.setItem(clientPrinterPreferencesStorageKey, JSON.stringify(nextPreferences))
    setClientPrinterDiscoveryStatus(`${sortedPrinterNames.length} yazıcı JSON dosyasından yüklendi. ${appliedPreferenceCount} eşleşme uygulandı.`)
    setFormDesignStatus('Yazıcı JSON dosyası yüklendi.')
  }

  const importClientPrinterJson = async (file: File | null) => {
    if (!file) return

    try {
      const fileContent = await file.text()
      const parsedConfig = JSON.parse(fileContent) as ClientPrinterConfig | string[]
      const config = Array.isArray(parsedConfig) ? { printers: parsedConfig } : parsedConfig

      applyClientPrinterConfig(config)
    } catch (error) {
      setClientPrinterDiscoveryStatus(`JSON dosyası okunamadı: ${error instanceof Error ? error.message : 'Geçersiz dosya'}`)
    }
  }

  const loadPrintersFromLocalAgent = async () => {
    try {
      setClientPrinterDiscoveryStatus('Agent yazıcı listesi okunuyor...')
      const response = await fetch(localPrintAgentPrintersUrl, { cache: 'no-store' })
      const payload = await response.json()
      const printers = Array.isArray(payload?.data?.printers) ? payload.data.printers : []

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Agent yazıcı listesini döndürmedi.')
      }

      if (printers.length === 0) {
        throw new Error('Agent çalışıyor ama yazıcı listesi boş geldi.')
      }

      saveClientPrinterNames(printers)
      setClientPrinterDiscoveryStatus(`${printers.length} yazıcı agenttan alındı.`)
    } catch (error) {
      setClientPrinterDiscoveryStatus(`Agenttan yazıcı alınamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`)
    }
  }

  const exportClientPrinterJson = () => {
    const printerNames = Array.from(new Set([...(clientPrinterConfig.printers || []), ...clientPrinterNames].map((name) => String(name).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr'))
    const designPrinters = formDesigns.reduce<Record<string, string>>((acc, design) => {
      const printerName = resolveClientPrinterNameForDesign(design)
      if (printerName) {
        acc[design.name] = printerName
      }
      return acc
    }, { ...(clientPrinterConfig.designPrinters || {}) })
    const payload: ClientPrinterConfig = {
      printers: printerNames,
      preferences: { ...clientPrinterPreferences },
      assistancePrinters: {},
      designPrinters,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'netsosyal-yazici-yonlendirme.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setClientPrinterDiscoveryStatus(`${printerNames.length} yazıcı ile yönlendirme JSON dosyası indirildi.`)
  }

  const filteredFieldGroups = useMemo(() => {
    const query = fieldSearch.trim().toLocaleLowerCase('tr-TR')
    const activeTab = fieldTabs.find((tab) => tab.id === activeFieldTabId)
    let allowedGroupIds = activeTab?.groupIds || [reportFieldGroups[0].id]

    if (activeFieldTabId === 'yardimlar') {
      const assistanceKey = normalizePrinterConfigKey(selectedFormDesign?.linkedAssistance || '')
      const assistanceGroupId = assistanceFieldGroupMap[assistanceKey]
      if (assistanceGroupId) {
        allowedGroupIds = ['yardim_ortak', assistanceGroupId]
      }
    }

    const allowed = new Set(allowedGroupIds)
    const scopedGroups = reportFieldGroups.filter((group) => allowed.has(group.id))

    if (query) {
      return scopedGroups
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => `${field.label} ${field.token} ${field.source}`.toLocaleLowerCase('tr-TR').includes(query)),
        }))
        .filter((group) => group.fields.length > 0)
    }

    return scopedGroups
  }, [activeFieldTabId, fieldSearch, selectedFormDesign?.linkedAssistance])

  const canvasMetrics = useMemo(() => {
    if (!selectedFormDesign) return { width: 794, minHeight: 1123 }
    if (selectedFormDesign.type === 'a4') {
      const widthMm = Math.max(10, parseFloat(selectedFormDesign.width || '210'))
      const heightMm = Math.max(10, parseFloat(selectedFormDesign.height || '297'))
      return {
        width: widthMm * PX_PER_MM,
        minHeight: heightMm * PX_PER_MM,
      }
    }
    return {
      width: Math.max(160, parseFloat(selectedFormDesign.width || '80') * PX_PER_MM),
      minHeight: Math.max(100, parseFloat(selectedFormDesign.height || '40') * PX_PER_MM),
    }
  }, [selectedFormDesign])

  const canvasScale = designerZoom / 100

  const getBandPointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.round((event.clientX - rect.left) / canvasScale)),
      y: Math.max(0, Math.round((event.clientY - rect.top) / canvasScale)),
    }
  }

  const startSelectionMarquee = (event: ReactPointerEvent<HTMLDivElement>, bandId: string) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getBandPointerPosition(event)
    setSelectionMarquee({ bandId, startX: point.x, startY: point.y, currentX: point.x, currentY: point.y })
    setSelectedBandId(bandId)
  }

  const moveSelectionMarquee = (event: ReactPointerEvent<HTMLDivElement>, bandId: string) => {
    if (!selectionMarquee || selectionMarquee.bandId !== bandId) return
    event.preventDefault()
    const point = getBandPointerPosition(event)
    setSelectionMarquee((current) => current ? { ...current, currentX: point.x, currentY: point.y } : null)
  }

  const finishSelectionMarquee = (event: ReactPointerEvent<HTMLDivElement>, bandId: string) => {
    if (!selectionMarquee || selectionMarquee.bandId !== bandId || !selectedFormDesign) return
    event.preventDefault()
    event.stopPropagation()
    const point = getBandPointerPosition(event)
    const left = Math.min(selectionMarquee.startX, point.x)
    const right = Math.max(selectionMarquee.startX, point.x)
    const top = Math.min(selectionMarquee.startY, point.y)
    const bottom = Math.max(selectionMarquee.startY, point.y)
    const matchedIds = (selectedFormDesign.blocks || [])
      .filter((block) => {
        if (block.bandId !== bandId) return false
        const blockWidth = block.width || Math.max(24, (block.value?.length || 1) * (block.fontSize || 14) * 0.55)
        const blockHeight = block.height || Math.max(18, (block.fontSize || 14) * 1.3)
        return block.x < right && block.x + blockWidth > left && block.y < bottom && block.y + blockHeight > top
      })
      .map((block) => block.id)

    setSelectedBlockIds(matchedIds)
    setSelectedBlockId(matchedIds.at(-1) ?? null)
    setSelectionMarquee(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => {
    const moveSelectedBlocksWithKeyboard = (event: KeyboardEvent) => {
      if (!selectedFormDesign || !selectedBlockIds.length) return
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'
      ) return

      const movement = event.shiftKey ? 10 : 1
      const delta =
        event.key === 'ArrowLeft' ? { x: -movement, y: 0 }
          : event.key === 'ArrowRight' ? { x: movement, y: 0 }
            : event.key === 'ArrowUp' ? { x: 0, y: -movement }
              : event.key === 'ArrowDown' ? { x: 0, y: movement }
                : null
      if (!delta) return

      event.preventDefault()
      const selectedIds = new Set(selectedBlockIds)
      setFormDesigns((prev) =>
        prev.map((design) =>
          design.id === selectedFormDesign.id
            ? {
                ...design,
                blocks: (design.blocks || []).map((block) =>
                  selectedIds.has(block.id)
                    ? {
                        ...block,
                        x: Math.max(0, block.x + delta.x),
                        y: Math.max(0, block.y + delta.y),
                      }
                    : block,
                ),
              }
            : design,
        ),
      )
    }

    window.addEventListener('keydown', moveSelectedBlocksWithKeyboard)
    return () => window.removeEventListener('keydown', moveSelectedBlocksWithKeyboard)
  }, [selectedBlockIds, selectedFormDesign])

  useEffect(() => {
    const handleDesignerClipboard = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      const eventTarget = event.target
      if (
        eventTarget instanceof HTMLElement &&
        (eventTarget.closest('input, textarea, select') || eventTarget.isContentEditable)
      ) {
        return
      }

      const key = event.key.toLocaleLowerCase('tr-TR')
      if (key === 'c' && selectedBlock) {
        event.preventDefault()
        const selectedIds = new Set(selectedBlockIds.length ? selectedBlockIds : [selectedBlock.id])
        const blocksToCopy = (selectedFormDesign?.blocks || [])
          .filter((block) => selectedIds.has(block.id))
          .map((block) => ({ ...block }))
        copiedBlocksRef.current = blocksToCopy.length ? blocksToCopy : [{ ...selectedBlock }]
        setFormDesignStatus(`${copiedBlocksRef.current.length} alan kopyalandı. Hedef noktaya tıklayıp Ctrl+V ile yapıştırın.`)
        return
      }

      if (key !== 'v' || !copiedBlocksRef.current.length || !selectedFormDesign) return

      const pasteTarget = pasteTargetRef.current
      if (!pasteTarget || pasteTarget.designId !== selectedFormDesign.id) return

      event.preventDefault()
      const copiedBlocks = copiedBlocksRef.current
      const targetBand = selectedFormDesign.bands?.find((band) => band.id === pasteTarget.bandId)
      if (!targetBand) return

      const bandHeight =
        selectedFormDesign.type === 'a4'
          ? targetBand.height
          : Math.max(targetBand.height, canvasMetrics.minHeight)
      const groupOriginX = Math.min(...copiedBlocks.map((block) => block.x))
      const groupOriginY = Math.min(...copiedBlocks.map((block) => block.y))
      const newBlocks: DesignBlock[] = copiedBlocks.map((copiedBlock) => {
        const blockWidth = copiedBlock.width ?? 0
        const blockHeight = copiedBlock.height ?? 0
        const relativeX = copiedBlock.x - groupOriginX
        const relativeY = copiedBlock.y - groupOriginY
        return {
          ...copiedBlock,
          id: createLocalId('blk'),
          bandId: targetBand.id,
          x: Math.max(0, Math.round(Math.min(pasteTarget.x + relativeX, canvasMetrics.width - blockWidth))),
          y: Math.max(0, Math.round(Math.min(pasteTarget.y + relativeY, bandHeight - blockHeight))),
        }
      })

      setFormDesigns((prev) =>
        prev.map((design) =>
          design.id === selectedFormDesign.id
            ? { ...design, blocks: [...(design.blocks || []), ...newBlocks] }
            : design,
        ),
      )
      setSelectedBlockId(newBlocks.at(-1)?.id ?? null)
      setSelectedBlockIds(newBlocks.map((block) => block.id))
      setSelectedBandId(targetBand.id)
      setFormDesignStatus(`${newBlocks.length} alan grup düzeni korunarak yapıştırıldı.`)
    }

    window.addEventListener('keydown', handleDesignerClipboard)
    return () => window.removeEventListener('keydown', handleDesignerClipboard)
  }, [canvasMetrics.minHeight, canvasMetrics.width, selectedBlock, selectedBlockIds, selectedFormDesign])

  const editorCanvasHeight = useMemo(() => {
    if (!activeDesignerBand || !selectedFormDesign) return canvasMetrics.minHeight
    return Math.max(activeDesignerBand.height, canvasMetrics.minHeight)
  }, [activeDesignerBand, canvasMetrics.minHeight, selectedFormDesign])

  const saveFormDesigns = async (designs: FormDesign[] = formDesigns) => {
    setIsSavingFormDesigns(true)
    setFormDesignStatus('')

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'form_design_templates',
          value: designs,
          type: 'json',
        }),
      })
      const payload = (await response.json()) as SettingResponse<FormDesign[]>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Form tasarımları kaydedilemedi.')
      }

      setFormDesignStatus('Form tasarımları kaydedildi.')
    } catch (saveError) {
      setFormDesignStatus((saveError as Error).message)
    } finally {
      setIsSavingFormDesigns(false)
    }
  }

  const buildSelectedDesignPrintHtml = (design: FormDesign) => {
    const renderedHtml = renderToStaticMarkup(<FormDesignRenderer design={design} data={dummyPrintData} preview={false} />)

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${design.name}</title>
          <style>
            @page { size: ${Number(design.width || (design.type === 'a4' ? 210 : 80))}mm ${Number(design.height || (design.type === 'a4' ? 297 : 40))}mm; margin: 0; }
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .relative { position: relative; }
            .absolute { position: absolute; }
            .pointer-events-none { pointer-events: none; }
            .bg-white { background: #fff; }
            .bg-slate-950 { background: #020617; }
            .bg-slate-50 { background: #f8fafc; }
            .border { border: 1px solid #e2e8f0; }
            .border-none { border: 0; }
            .border-b { border-bottom: 1px solid #e2e8f0; }
            .border-dashed { border-style: dashed; }
            .last\\:border-b-0:last-child { border-bottom: 0; }
            .overflow-hidden { overflow: hidden; }
            .leading-tight { line-height: 1.25; }
            .break-words { overflow-wrap: break-word; }
            .whitespace-nowrap { white-space: nowrap; }
            .flex { display: flex; }
            .flex-col { flex-direction: column; }
            .items-center { align-items: center; }
            .gap-1 { gap: 0.25rem; }
            .flex-1 { flex: 1 1 0%; }
            .w-full { width: 100%; }
            .h-full { height: 100%; }
            .h-auto { height: auto; }
            .object-contain { object-fit: contain; }
            .text-\\[10px\\] { font-size: 10px; }
            .text-\\[8px\\] { font-size: 8px; }
            .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .text-center { text-align: center; }
            .min-h-\\[2rem\\] { min-height: 2rem; }
            .min-w-\\[3rem\\] { min-width: 3rem; }
            .min-h-\\[3rem\\] { min-height: 3rem; }
            .space-y-8 > * + * { margin-top: 2rem; }
            .print\\:break-after-page { break-after: page; page-break-after: always; }
            .print\\:break-after-page:last-child { break-after: auto; page-break-after: auto; }
            .form-design-print-page {
              display: block;
              position: relative;
              width: ${Number(design.width || (design.type === 'a4' ? 210 : 80))}mm !important;
              height: ${Number(design.height || (design.type === 'a4' ? 297 : 40))}mm !important;
              min-height: ${Number(design.height || (design.type === 'a4' ? 297 : 40))}mm !important;
              overflow: hidden;
              page-break-after: always;
              break-after: page;
            }
            .form-design-print-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            .bg-\\[repeating-linear-gradient\\(90deg\\2c black\\2c black_2px\\2c transparent_2px\\2c transparent_4px\\)\\] {
              background: repeating-linear-gradient(90deg, black, black 2px, transparent 2px, transparent 4px);
            }
            @media print {
              html, body { width: ${Number(design.width || (design.type === 'a4' ? 210 : 80))}mm; min-height: ${Number(design.height || (design.type === 'a4' ? 297 : 40))}mm; }
              .space-y-8 > * + * { margin-top: 0; }
              .print\\:break-after-page { break-after: page !important; page-break-after: always !important; }
              .print\\:break-after-page:last-child { break-after: auto !important; page-break-after: auto !important; }
              .form-design-print-page { page-break-after: always !important; break-after: page !important; }
              .form-design-print-page:last-child { page-break-after: auto !important; break-after: auto !important; }
            }
          </style>
        </head>
        <body>${renderedHtml}</body>
      </html>
    `
  }

  const handlePrintSelectedDesign = async () => {
    if (!selectedFormDesign) return

    const printerName = selectedClientPrinterName.trim()
    const printHtml = renderToStaticMarkup(<FormDesignRenderer design={selectedFormDesign} data={dummyPrintData} preview={false} />)

    if (printerName && directPrintAgentEnabled) {
      setFormDesignStatus(`Yazdırma agent'a gönderiliyor: ${printerName}`)

      try {
        const response = await fetch(localPrintAgentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printerName,
            title: selectedFormDesign.name,
            assistanceType: selectedFormDesign.linkedAssistance,
            designName: selectedFormDesign.name,
            html: buildSelectedDesignPrintHtml(selectedFormDesign),
          }),
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.error || 'Yerel yazdırma agent baskıyı kabul etmedi.')
        }
        if (payload?.agentVersion !== requiredPrintAgentVersion) {
          throw new Error(`Yazdırma agentı güncel değil. Agenttan Al ile ${requiredPrintAgentVersion} sürümünü yeniden kurun.`)
        }

        setFormDesignStatus(`Baskı ${printerName} yazıcısına gönderildi.`)
        return
      } catch (error) {
        setFormDesignStatus(`Yerel yazdırma agent'a ulaşılamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`)
        return
      }
    }

    setFormDesignStatus(
      printerName
        ? `Yazdırma penceresi açıldı. Bu tasarım için kayıtlı son yazıcı: ${printerName}`
        : 'Yazdırma penceresi açıldı. Bu bilgisayardaki yazıcıyı seçin.',
    )

    printFormDesignHtml(selectedFormDesign.name, printHtml, {
      widthMm: selectedFormDesign.type === 'a4' ? undefined : Number(selectedFormDesign.width || 80),
      heightMm: selectedFormDesign.type === 'a4' ? undefined : Number(selectedFormDesign.height || 40),
      offsetXmm: Number(selectedFormDesign.printOffsetX || 0),
      offsetYmm: Number(selectedFormDesign.printOffsetY || 0),
      insetRightMm: Number(selectedFormDesign.printOffsetRight || 0),
      insetBottomMm: Number(selectedFormDesign.printOffsetBottom || 0),
    })
  }

  const handlePreviewSelectedDesign = () => {
    if (!selectedFormDesign) return

    const previewWidth = selectedFormDesign.type === 'a4' ? '210mm' : `${Number(selectedFormDesign.width || 80)}mm`
    const previewHeight = selectedFormDesign.type === 'a4' ? '297mm' : `${Number(selectedFormDesign.height || 40)}mm`
    const previewHtml = buildSelectedDesignPrintHtml(selectedFormDesign).replace(
      '</style>',
      `
        @media screen {
          html { min-height: 100%; background: #e2e8f0; padding: 32px; }
          body {
            width: ${previewWidth};
            min-height: ${previewHeight};
            margin: 0 auto;
            background: #fff;
            box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24);
          }
        }
      </style>`,
    )
    const previewBlobUrl = URL.createObjectURL(new Blob([previewHtml], { type: 'text/html;charset=utf-8' }))
    const previewWindow = window.open(previewBlobUrl, '_blank', 'width=1100,height=820,resizable=yes,scrollbars=yes')

    if (!previewWindow) {
      URL.revokeObjectURL(previewBlobUrl)
      alert('Ön izleme penceresi açılamadı. Tarayıcı açılır pencere iznini kontrol edin.')
      return
    }

    window.setTimeout(() => URL.revokeObjectURL(previewBlobUrl), 60_000)
  }

  const duplicateSelectedFormDesign = async () => {
    if (!selectedFormDesign) return

    const copyNameBase = selectedFormDesign.name.replace(/ \(Kopya(?: \d+)?\)$/, '')
    const existingCopies = formDesigns.filter((design) => design.name.startsWith(`${copyNameBase} (Kopya`)).length
    const copyName = existingCopies === 0 ? `${copyNameBase} (Kopya)` : `${copyNameBase} (Kopya ${existingCopies + 1})`

    if (selectedFormDesignIsLegacy) {
      setIsSavingFormDesigns(true)
      setFormDesignStatus('Legacy tasarım kopyalanıyor...')

      try {
        const response = await fetch('/api/settings/duplicate-legacy-design', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legacyDesignId: selectedFormDesign.id, name: copyName }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Legacy tasarım kopyalanamadı.')
        }

        const legacyId = String(payload.data?.id)
        const newId = `legacy_dizayn_${legacyId}`
        const duplicatedDesign: FormDesign = {
          ...selectedFormDesign,
          id: newId,
          name: copyName,
          bands: selectedFormDesign.bands?.map((band) => ({ ...band })),
          blocks: selectedFormDesign.blocks?.map((block) => ({ ...block })),
        }

        const updatedDesigns = [duplicatedDesign, ...formDesigns]
        setFormDesigns(updatedDesigns)
        setSelectedFormDesignId(newId)
        setSelectedBlockId(null)
        setSelectedBandId(null)
        setFormDesignStatus('Legacy tasarım başarıyla kopyalandı.')
      } catch (saveError) {
        setFormDesignStatus((saveError as Error).message)
      } finally {
        setIsSavingFormDesigns(false)
      }

      return
    }

    const newId = createLocalId('custom')
    const duplicatedDesign: FormDesign = {
      ...selectedFormDesign,
      id: newId,
      name: copyName,
      bands: selectedFormDesign.bands?.map((band) => ({ ...band })),
      blocks: selectedFormDesign.blocks?.map((block) => ({ ...block })),
    }

    const updatedDesigns = [duplicatedDesign, ...formDesigns]
    setFormDesigns(updatedDesigns)
    setSelectedFormDesignId(newId)
    setSelectedBlockId(null)
    setSelectedBandId(null)

    await saveFormDesigns(updatedDesigns)
  }

  const updateDesign = <K extends keyof FormDesign>(id: string, field: K, value: FormDesign[K]) => {
    setFormDesigns((prev) => prev.map((design) => (design.id === id ? { ...design, [field]: value } : design)))
  }

  const addNewFormDesign = () => {
    const newId = createLocalId('custom')
    setFormDesigns((prev) => [
      {
        id: newId,
        name: 'Yeni Tasarım',
        type: 'label',
        linkedAssistance: 'Tümü',
        width: '80',
        height: '40',
        printOffsetX: '0',
        printOffsetY: '0',
        content: '',
        bands: [{ id: createLocalId('bnd'), type: 'MasterData', name: 'Ana Veri', height: 151 }],
        blocks: [],
      },
      ...prev,
    ])
    setSelectedFormDesignId(newId)
    setSelectedBlockId(null)
    setSelectedBandId(null)
  }

  const addImageToSelectedDesign = (file: File) => {
    if (!selectedFormDesign) return
    if (!file.type.startsWith('image/')) {
      setFormDesignStatus('Lütfen geçerli bir resim dosyası seçin.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormDesignStatus('Resim dosyası en fazla 4 MB olabilir.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const imageSource = typeof reader.result === 'string' ? reader.result : ''
      if (!imageSource) return

      const image = new Image()
      image.onload = () => {
        const targetBandId = selectedBandId || selectedBlock?.bandId || selectedFormDesign.bands?.[0]?.id
        if (!targetBandId) return
        const maxWidth = 160
        const maxHeight = 120
        const scale = Math.min(maxWidth / Math.max(1, image.naturalWidth), maxHeight / Math.max(1, image.naturalHeight), 1)
        const width = Math.max(24, Math.round(image.naturalWidth * scale))
        const height = Math.max(24, Math.round(image.naturalHeight * scale))
        const newBlock: DesignBlock = {
          id: createLocalId('blk'),
          bandId: targetBandId,
          type: 'image',
          x: 24,
          y: 24,
          width,
          height,
          value: imageSource,
          borderWidth: 0,
          backgroundColor: 'transparent',
        }

        setFormDesigns((prev) =>
          prev.map((design) =>
            design.id === selectedFormDesign.id
              ? { ...design, blocks: [...(design.blocks || []), newBlock] }
              : design,
          ),
        )
        setSelectedBlockId(newBlock.id)
        setSelectedBlockIds([newBlock.id])
        setSelectedBandId(targetBandId)
        setFormDesignStatus(`${file.name} tasarıma eklendi.`)
      }
      image.onerror = () => setFormDesignStatus('Seçilen resim okunamadı.')
      image.src = imageSource
    }
    reader.onerror = () => setFormDesignStatus('Seçilen resim okunamadı.')
    reader.readAsDataURL(file)
  }

  const replaceDesignBlockImage = (designId: string, blockId: string, file: File) => {
    if (!file.type.startsWith('image/')) {
      setFormDesignStatus('Lütfen geçerli bir resim dosyası seçin.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormDesignStatus('Resim dosyası en fazla 4 MB olabilir.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const imageSource = typeof reader.result === 'string' ? reader.result : ''
      if (!imageSource) return
      updateBlock(designId, blockId, 'value', imageSource)
      setSelectedBlockIds([blockId])
      setSelectedBlockId(blockId)
      setFormDesignStatus(`${file.name} ile resim güncellendi.`)
    }
    reader.onerror = () => setFormDesignStatus('Seçilen resim okunamadı.')
    reader.readAsDataURL(file)
  }

  const removeFormDesign = (id: string) => {
    setFormDesigns((prev) => prev.filter((design) => design.id !== id))
    if (selectedFormDesignId === id) {
      const nextDesign = formDesigns.find((design) => design.id !== id)
      setSelectedFormDesignId(nextDesign?.id ?? null)
    }
    setSelectedBlockId(null)
    setSelectedBandId(null)
  }

  const createBlockFromField = (field: ReportField, x = 24, y = 48): DesignBlock => ({
    id: createLocalId('blk'),
    type: field.token.includes('barkod') || field.token.includes('barcode')
      ? 'barcode'
      : field.token.includes('qr')
        ? 'qrcode'
        : field.token.includes('resim') || field.token.includes('foto')
          ? 'image'
          : 'variable',
    x,
    y,
    width: field.token.includes('resim') || field.token.includes('foto')
      ? 120
      : field.token.includes('adres') || field.token.includes('aciklama')
        ? 220
        : undefined,
    height: field.token.includes('resim') || field.token.includes('foto')
      ? 150
      : field.token.includes('adres') || field.token.includes('aciklama')
        ? 36
        : undefined,
    value: `{{${field.token}}}`,
    fontSize: 13,
    fontWeight: 'normal',
    textAlign: 'left',
    textColor: '#111827',
    backgroundColor: 'transparent',
    borderColor: '#111827',
    borderWidth: 0,
  })

  const prepareDataFieldCopy = (event: ReactMouseEvent<HTMLButtonElement>, field: ReportField) => {
    const tokenText = `{{${field.token}}}`
    copiedBlocksRef.current = [createBlockFromField(field, 0, 0)]

    const tokenElement = event.currentTarget.querySelector<HTMLElement>('[data-designer-field-token]')
    const selection = window.getSelection()
    if (tokenElement && selection) {
      const range = document.createRange()
      range.selectNodeContents(tokenElement)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(tokenText).catch(() => {
        // Tarayıcı izni yoksa seçili metin, sağ tık menüsündeki Kopyala komutuyla alınabilir.
      })
    }
    setFormDesignStatus(`${field.label} alanı kopyalamaya hazır: ${tokenText}`)
  }

  const addFieldToDesign = (designId: string, field: ReportField) => {
    setFormDesigns((prev) =>
      prev.map((design) => {
        if (design.id !== designId) return design
        const targetBandId = design.bands?.[0]?.id
        const fieldCount = (design.blocks || []).length
        return {
          ...design,
          blocks: [
            ...(design.blocks || []),
            { ...createBlockFromField(field, 24, 32 + fieldCount * 26), bandId: targetBandId },
          ],
        }
      }),
    )
  }

  const handleDropOnBand = (event: DragEvent, design: FormDesign, bandId: string) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.round((event.clientX - rect.left) / canvasScale))
    const y = Math.max(0, Math.round((event.clientY - rect.top) / canvasScale))

    if (draggedField) {
      const newBlock = { ...createBlockFromField(draggedField, x, y), bandId }
      setFormDesigns((prev) => prev.map((item) => (item.id === design.id ? { ...item, blocks: [...(item.blocks || []), newBlock] } : item)))
      setSelectedBlockId(newBlock.id)
      setSelectedBlockIds([newBlock.id])
      setSelectedBandId(bandId)
      setDraggedField(null)
      return
    }

    if (draggedTool) {
      const newBlock: DesignBlock = {
        id: createLocalId('blk'),
        bandId,
        type: draggedTool,
        x,
        y,
        width: draggedTool === 'line' ? 180 : draggedTool === 'barcode' ? 180 : draggedTool === 'qrcode' ? 96 : undefined,
        height: draggedTool === 'line' ? 1 : draggedTool === 'barcode' ? 58 : draggedTool === 'qrcode' ? 96 : undefined,
        value: draggedTool === 'variable' ? '{{kisi.ad_soyad}}' : draggedTool === 'line' ? '180' : draggedTool === 'qrcode' ? '{{dosya.dosyano}}' : draggedTool === 'barcode' ? '{{barkod_no}}' : 'Yeni Metin',
        fontSize: 14,
        fontWeight: 'normal',
        textAlign: 'left',
        textColor: '#111827',
        backgroundColor: 'transparent',
        borderColor: '#111827',
        borderWidth: 0,
      }
      setFormDesigns((prev) => prev.map((item) => (item.id === design.id ? { ...item, blocks: [...(item.blocks || []), newBlock] } : item)))
      setSelectedBlockId(newBlock.id)
      setSelectedBlockIds([newBlock.id])
      setSelectedBandId(bandId)
      setDraggedTool(null)
      return
    }

    if (draggedBlock && draggedBlock.designId === design.id) {
      const finalX = Math.max(0, Math.round(x - draggedBlock.offsetX))
      const finalY = Math.max(0, Math.round(y - draggedBlock.offsetY))
      const sourceBlock = (design.blocks || []).find((block) => block.id === draggedBlock.blockId)
      const moveAsGroup = Boolean(sourceBlock && selectedBlockIds.includes(draggedBlock.blockId) && selectedBlockIds.length > 1)
      const selectedIds = new Set(selectedBlockIds)
      const deltaX = sourceBlock ? finalX - sourceBlock.x : 0
      const deltaY = sourceBlock ? finalY - sourceBlock.y : 0
      setFormDesigns((prev) =>
        prev.map((item) =>
          item.id === design.id
            ? {
                ...item,
                blocks: (item.blocks || []).map((block) => {
                  if (block.id === draggedBlock.blockId) return { ...block, x: finalX, y: finalY, bandId }
                  if (!moveAsGroup || !selectedIds.has(block.id)) return block
                  return {
                    ...block,
                    x: Math.max(0, block.x + deltaX),
                    y: Math.max(0, block.y + deltaY),
                    bandId: block.bandId === sourceBlock?.bandId ? bandId : block.bandId,
                  }
                }),
              }
            : item,
        ),
      )
      setDraggedBlock(null)
    }
  }

  const addBand = (designId: string, type: ReportBand['type']) => {
    const newBandId = createLocalId('bnd')
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? {
              ...design,
              bands: [
                ...(design.bands || []),
                {
                  id: newBandId,
                  type,
                  name: bandLabels[type],
                  height: design.type === 'a4'
                    ? Math.round(Number(design.height || 297) * PX_PER_MM)
                    : Math.round(Number(design.height || 40) * PX_PER_MM),
                },
              ],
            }
          : design,
      ),
    )
    setSelectedBandId(newBandId)
    setSelectedBlockId(null)
    setSelectedBlockIds([])
  }

  const updateBand = <K extends keyof ReportBand>(designId: string, bandId: string, field: K, value: ReportBand[K]) => {
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? { ...design, bands: (design.bands || []).map((band) => (band.id === bandId ? { ...band, [field]: value } : band)) }
          : design,
      ),
    )
  }

  const deleteBand = (designId: string, bandId: string) => {
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? {
              ...design,
              bands: (design.bands || []).filter((band) => band.id !== bandId),
              blocks: (design.blocks || []).filter((block) => block.bandId !== bandId),
            }
          : design,
      ),
    )
    setSelectedBandId(null)
  }

  const updateBlock = <K extends keyof DesignBlock>(designId: string, blockId: string, field: K, value: DesignBlock[K]) => {
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? { ...design, blocks: (design.blocks || []).map((block) => (block.id === blockId ? { ...block, [field]: value } : block)) }
          : design,
      ),
    )
  }

  const updateSelectedBlockTypography = (
    designId: string,
    fallbackBlockId: string,
    field: 'fontFamily' | 'fontSize' | 'fontWeight',
    value: string | number,
  ) => {
    const targetIds = new Set(selectedBlockIds.length > 1 ? selectedBlockIds : [fallbackBlockId])
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? {
              ...design,
              blocks: (design.blocks || []).map((block) =>
                targetIds.has(block.id) ? { ...block, [field]: value } : block,
              ),
            }
          : design,
      ),
    )
  }

  const updateSelectedBlockDimension = (
    designId: string,
    fallbackBlockId: string,
    field: 'width' | 'height',
    value: number | undefined,
  ) => {
    const targetIds = new Set(selectedBlockIds.length > 1 ? selectedBlockIds : [fallbackBlockId])
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? {
              ...design,
              blocks: (design.blocks || []).map((block) =>
                targetIds.has(block.id) ? { ...block, [field]: value } : block,
              ),
            }
          : design,
      ),
    )
  }

  const updateBlockCellAlignment = (
    designId: string,
    blockId: string,
    textAlign: 'left' | 'center' | 'right',
    verticalAlign: 'top' | 'middle' | 'bottom',
  ) => {
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? {
              ...design,
              blocks: (design.blocks || []).map((block) =>
                block.id === blockId ? { ...block, textAlign, verticalAlign } : block,
              ),
            }
          : design,
      ),
    )
  }

  const justifySelectedTextBlocks = (designId: string, fallbackBlockId: string) => {
    const targetIds = new Set(selectedBlockIds.length > 1 ? selectedBlockIds : [fallbackBlockId])
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? {
              ...design,
              blocks: (design.blocks || []).map((block) =>
                targetIds.has(block.id) && (block.type === 'text' || block.type === 'variable')
                  ? { ...block, textAlign: 'justify' }
                  : block,
              ),
            }
          : design,
      ),
    )
  }

  const startBlockResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    designId: string,
    band: ReportBand,
    block: DesignBlock,
    corner: 'nw' | 'ne' | 'sw' | 'se',
  ) => {
    event.preventDefault()
    event.stopPropagation()

    const blockElement = event.currentTarget.parentElement
    if (!blockElement) return

    const rect = blockElement.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const initialX = block.x
    const initialY = block.y
    const initialWidth = Math.max(12, block.width ?? rect.width / canvasScale)
    const initialHeight = Math.max(10, block.height ?? rect.height / canvasScale)
    const bandHeight = selectedFormDesign?.type === 'a4' ? band.height : Math.max(band.height, canvasMetrics.minHeight)
    const resizeWest = corner === 'nw' || corner === 'sw'
    const resizeNorth = corner === 'nw' || corner === 'ne'
    const resizeTargetIds =
      selectedBlockIds.includes(block.id) && selectedBlockIds.length > 1
        ? new Set(selectedBlockIds)
        : new Set([block.id])

    setDraggedBlock(null)
    setSelectedBlockId(block.id)
    if (!selectedBlockIds.includes(block.id)) setSelectedBlockIds([block.id])
    setSelectedBandId(band.id)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rawDeltaX = (moveEvent.clientX - startX) / canvasScale
      const rawDeltaY = (moveEvent.clientY - startY) / canvasScale

      const deltaX = resizeWest
        ? Math.max(-initialX, Math.min(rawDeltaX, initialWidth - 12))
        : Math.max(12 - initialWidth, Math.min(rawDeltaX, canvasMetrics.width - initialX - initialWidth))
      const deltaY = resizeNorth
        ? Math.max(-initialY, Math.min(rawDeltaY, initialHeight - 10))
        : Math.max(10 - initialHeight, Math.min(rawDeltaY, bandHeight - initialY - initialHeight))

      const nextX = resizeWest ? initialX + deltaX : initialX
      const nextY = resizeNorth ? initialY + deltaY : initialY
      const nextWidth = resizeWest ? initialWidth - deltaX : initialWidth + deltaX
      const nextHeight = resizeNorth ? initialHeight - deltaY : initialHeight + deltaY

      setFormDesigns((prev) =>
        prev.map((design) =>
          design.id === designId
            ? {
                ...design,
                blocks: (design.blocks || []).map((item) => {
                  if (!resizeTargetIds.has(item.id)) return item
                  if (item.id === block.id) {
                    return {
                      ...item,
                      x: Math.round(nextX),
                      y: Math.round(nextY),
                      width: Math.round(nextWidth),
                      height: Math.round(nextHeight),
                    }
                  }

                  const currentWidth = item.width ?? nextWidth
                  const currentHeight = item.height ?? nextHeight
                  return {
                    ...item,
                    x: resizeWest ? Math.max(0, Math.round(item.x + currentWidth - nextWidth)) : item.x,
                    y: resizeNorth ? Math.max(0, Math.round(item.y + currentHeight - nextHeight)) : item.y,
                    width: Math.round(nextWidth),
                    height: Math.round(nextHeight),
                  }
                }),
              }
            : design,
        ),
      )
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  const removeBlock = (designId: string, blockId: string) => {
    setFormDesigns((prev) =>
      prev.map((design) => (design.id === designId ? { ...design, blocks: (design.blocks || []).filter((block) => block.id !== blockId) } : design)),
    )
    setSelectedBlockId((current) => current === blockId ? null : current)
    setSelectedBlockIds((current) => current.filter((id) => id !== blockId))
  }

  const removeSelectedBlocks = (designId: string, fallbackBlockId: string) => {
    const targetIds = new Set(selectedBlockIds.length > 1 ? selectedBlockIds : [fallbackBlockId])
    setFormDesigns((prev) =>
      prev.map((design) =>
        design.id === designId
          ? { ...design, blocks: (design.blocks || []).filter((block) => !targetIds.has(block.id)) }
          : design,
      ),
    )
    setSelectedBlockId(null)
    setSelectedBlockIds([])
    setFormDesignStatus(`${targetIds.size} alan tasarımdan silindi.`)
  }

  const getDuplicateBlockIds = (blocks: DesignBlock[] = []) => {
    const seen = new Set<string>()
    const duplicateIds = new Set<string>()

    blocks.forEach((block) => {
      const signature = JSON.stringify({
        bandId: block.bandId || '',
        type: block.type,
        value: block.value,
        x: block.x,
        y: block.y,
        width: block.width ?? null,
        height: block.height ?? null,
      })
      if (seen.has(signature)) duplicateIds.add(block.id)
      else seen.add(signature)
    })

    return duplicateIds
  }

  const removeDuplicateBlocks = (designId: string) => {
    setFormDesigns((prev) =>
      prev.map((design) => {
        if (design.id !== designId) return design
        const duplicateIds = getDuplicateBlockIds(design.blocks || [])
        return duplicateIds.size
          ? { ...design, blocks: (design.blocks || []).filter((block) => !duplicateIds.has(block.id)) }
          : design
      }),
    )
    setSelectedBlockId(null)
    setSelectedBlockIds([])
  }

  const renderDesignerTextWithFixedIndentation = (value: string) =>
    value.replace(/\r\n?/g, '\n').split('\n').map((line, index) => {
      const indentationLength = line.match(/^ +/)?.[0].length || 0
      const content = line.slice(indentationLength)
      return (
        <span
          key={index}
          style={{
            display: 'block',
            textIndent: indentationLength ? `${indentationLength}ch` : undefined,
            whiteSpace: 'pre-wrap',
          }}
        >
          {content || '\u00a0'}
        </span>
      )
    })

  const resolveDesignerPreviewValue = (value: string) =>
    value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key: string) => {
      const resolved = key.trim().split('.').reduce<unknown>((current, part) => {
        if (current && typeof current === 'object' && part in current) {
          return (current as Record<string, unknown>)[part]
        }
        return undefined
      }, dummyPrintData)
      return resolved === undefined || resolved === null ? match : String(resolved)
    })

  const blockPreview = (block: DesignBlock) => {
    if (block.type === 'line') {
      return <div className="bg-slate-950" style={{ width: `${block.width || Number(block.value) || 120}px`, height: `${block.height || 1}px` }} />
    }
    if (block.type === 'image') {
      return (
        <img
          src={resolveDesignerPreviewValue(block.value)}
          alt="Tasarım görseli"
          draggable={false}
          className="pointer-events-none h-full w-full select-none object-contain"
        />
      )
    }
    if (block.type === 'barcode') {
      return (
        <div className="flex h-full min-h-10 flex-col items-center justify-center gap-1 border border-slate-300 bg-transparent px-2 py-1">
          <div className="h-6 w-full bg-[repeating-linear-gradient(90deg,black,black_2px,transparent_2px,transparent_4px)]" />
          <span className="max-w-full truncate text-sm">{block.value}</span>
        </div>
      )
    }
    if (block.type === 'qrcode') {
      return (
        <div className="flex h-full w-full flex-col items-center gap-1 bg-transparent p-1">
          <div className="grid min-h-0 flex-1 aspect-square grid-cols-4 grid-rows-4 gap-px">
            {Array.from({ length: 16 }).map((_, index) => (
              <span key={index} className={index % 3 === 0 || index === 5 || index === 10 ? 'bg-slate-950' : 'bg-slate-200'} />
            ))}
          </div>
          <span className="max-w-full shrink-0 truncate text-center text-lg font-bold leading-none text-slate-900">
            {block.value}
          </span>
        </div>
      )
    }
    const verticalPosition = block.verticalAlign || 'top'
    return (
      <span
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: verticalPosition === 'top' ? 0 : verticalPosition === 'middle' ? '50%' : '100%',
          transform: verticalPosition === 'middle' ? 'translateY(-50%)' : verticalPosition === 'bottom' ? 'translateY(-100%)' : undefined,
          display: 'block',
          width: '100%',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {renderDesignerTextWithFixedIndentation(block.value)}
      </span>
    )
  }

  const getDesignerBlockFontSize = (block: DesignBlock) => {
    const configuredSize = block.fontSize || 14
    if (!block.autoFitText || !block.width || !block.height) return configuredSize

    const textLength = Math.max(1, Array.from(block.value || ' ').length)
    const usableAlong = Math.max(4, (block.textDirection === 'vertical' ? block.height : block.width) - 4)
    const usableAcross = Math.max(4, (block.textDirection === 'vertical' ? block.width : block.height) - 4)
    return Math.max(5, Math.min(96, Math.floor(Math.min(usableAlong / (textLength * 0.62), usableAcross / 1.2) * 0.92)))
  }

  return (
    <div className={isFullscreenDesigner ? 'fixed inset-0 z-[150] overflow-hidden bg-slate-100 p-2' : 'min-h-[720px] bg-slate-100 p-2 xl:h-full xl:min-h-[620px] xl:overflow-hidden'}>
      <div className="mx-auto flex h-full w-full max-w-none flex-col gap-2">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-slate-950">Form ve Etiket Dizaynı</h1>
            <p className="text-lg font-semibold text-slate-500">Dosya, birey ve tüm yardım türü alanlarıyla çıktı tasarımları</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            {formDesignStatus && <span className="max-w-full truncate rounded-md bg-slate-100 px-3 py-2 text-lg font-bold text-slate-700">{formDesignStatus}</span>}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={() => setIsFullscreenDesigner((value) => !value)} className={smallButtonClassName}>
                {isFullscreenDesigner ? 'Küçült' : 'Tam Ekran'}
              </button>
            <button
              type="button"
              onClick={() => selectedFormDesign ? handlePreviewSelectedDesign() : alert('Lütfen bir tasarım seçin.')}
              className={smallButtonClassName}
            >
              Ön İzle
            </button>
            <button
              type="button"
              onClick={() => selectedFormDesign ? void handlePrintSelectedDesign() : alert('Lütfen bir tasarım seçin.')}
              className={smallButtonClassName}
            >
              Yazdır
            </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={addNewFormDesign} className="h-9 rounded-md bg-[#6fb744] px-4 text-lg font-black text-white shadow-sm transition hover:bg-[#5aa333]">
                Yeni Tasarım
              </button>
              <button
                type="button"
                onClick={duplicateSelectedFormDesign}
                disabled={!selectedFormDesign || isSavingFormDesigns}
                className="h-9 rounded-md bg-[#f59e0b] px-4 text-lg font-black text-white shadow-sm transition hover:bg-[#d97706] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Farklı Kaydet
              </button>
              <button
                type="button"
                onClick={() => void saveFormDesigns()}
                disabled={isSavingFormDesigns}
                className="h-9 rounded-md bg-[#0076b6] px-5 text-lg font-black text-white shadow-sm transition hover:bg-[#005f95] disabled:cursor-wait disabled:opacity-60"
              >
                {isSavingFormDesigns ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-visible xl:grid-cols-[340px_minmax(0,1fr)_420px] xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-hidden 2xl:grid-cols-[360px_minmax(0,1fr)_460px]">
          <aside className="shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm xl:col-span-3 xl:max-h-none">
            <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-[#005f95] via-[#0076b6] to-[#00a77a] px-3 py-2.5 text-white">
              <div className="min-w-[170px] flex-1">
                <span className="block text-sm font-black uppercase tracking-[0.16em] text-sky-100">Aktif Tasarım</span>
                <span className="block truncate text-sm font-black">{selectedFormDesign?.name || 'Tasarım seçilmedi'}</span>
              </div>
              <select
                value={selectedFormDesignId || ''}
                onChange={(event) => setSelectedFormDesignId(event.target.value || null)}
                className="h-9 min-w-[240px] flex-[0_1_420px] rounded-md border border-white/40 bg-white px-3 text-lg font-bold text-slate-800 outline-none ring-0"
              >
                    <option value="">Tasarım seçin</option>
                    {formDesigns.map((design) => (
                      <option key={design.id} value={design.id}>{design.name}</option>
                    ))}
              </select>
              {selectedFormDesign && (
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="rounded-md bg-white/15 px-2.5 py-1.5 text-base font-black">{selectedFormDesign.type.toUpperCase()}</span>
                  <span className="rounded-md bg-white/15 px-2.5 py-1.5 text-base font-black">{selectedFormDesign.linkedAssistance}</span>
                  <span className="rounded-md bg-white/15 px-2.5 py-1.5 text-base font-black">{selectedFormDesign.width || 80}×{selectedFormDesign.height || 40} mm</span>
                </div>
              )}
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-base font-bold">{formDesigns.length} tasarım</span>
              <button
                type="button"
                onClick={() => setIsDesignSettingsOpen((current) => !current)}
                className="flex h-9 items-center gap-2 rounded-md border border-white/40 bg-white px-3 text-lg font-black text-[#005f95] shadow-sm transition hover:bg-sky-50"
                aria-expanded={isDesignSettingsOpen}
              >
                <span>{isDesignSettingsOpen ? 'Ayarları Kapat' : 'Tasarım Ayarları'}</span>
                <span className={`transition ${isDesignSettingsOpen ? 'rotate-180' : ''}`}>⌄</span>
              </button>
            </div>

            {isDesignSettingsOpen && (
            <div className="bg-gradient-to-b from-sky-50/70 to-white">
              {selectedFormDesign && (
                <section className="p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-black uppercase text-slate-500">Tasarım Ayarları</h2>
                      <p className="mt-0.5 truncate text-lg font-semibold text-slate-500">{selectedFormDesign.name}</p>
                    </div>
                    <button type="button" onClick={() => removeFormDesign(selectedFormDesign.id)} className="h-8 rounded-md border border-rose-200 bg-white px-3 text-lg font-black text-rose-600 transition hover:bg-rose-50">
                      Tasarımı Sil
                    </button>
                  </div>

                  <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(420px,520px)]">
                    <label className="block min-w-0 space-y-1.5 xl:col-span-2">
                      <span className="block text-nowrap text-lg font-black uppercase text-slate-500">Tasarım Adı</span>
                      <input value={selectedFormDesign.name} onChange={(event) => updateDesign(selectedFormDesign.id, 'name', event.target.value)} className={inputClassName} />
                    </label>

                    <label className="block min-w-0 space-y-1.5">
                      <span className="block text-nowrap text-lg font-black uppercase text-slate-500">Kağıt / Etiket Türü</span>
                      <select value={selectedFormDesign.type} onChange={(event) => updateDesign(selectedFormDesign.id, 'type', event.target.value as FormDesign['type'])} className={inputClassName}>
                        {formDesignTypes.map((type) => (
                          <option key={type.value} value={type.value}>{type.label} - {type.size}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block min-w-0 space-y-1.5">
                      <span className="block text-nowrap text-lg font-black uppercase text-slate-500">İlişkili Yardım</span>
                      <select value={selectedFormDesign.linkedAssistance} onChange={(event) => updateDesign(selectedFormDesign.id, 'linkedAssistance', event.target.value)} className={inputClassName}>
                        {assistanceTemplateOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>

                    <div className="min-w-0 space-y-2 rounded-md border border-sky-100 bg-sky-50/40 p-3 md:col-span-2 xl:col-start-5 xl:row-span-2 xl:row-start-1">
                      <span className="block text-nowrap text-lg font-black uppercase text-slate-500">Bu Bilgisayardaki Yazıcı</span>
                      <div className="grid grid-cols-1 gap-2">
                        <select
                          value={selectedClientPrinterName}
                          onChange={(event) => saveClientPrinterPreference(selectedFormDesign.id, event.target.value)}
                          className={inputClassName}
                        >
                          <option value="">{clientPrinterNames.length > 0 ? 'Yazıcı seçin' : 'Önce Agenttan Al veya JSON Yükle'}</option>
                          {/* Kullanici istegi (2026-09-28): "sanal yazıcıyı
                              formlar ve tasarım sayfasında göremiyorum ...
                              gıda yardımını sürekli sanal yazıcıya
                              yönlendirmek için ne yapacağım" - bu, gercek
                              bir yazici olmadigi icin Agenttan Al/JSON
                              Yukle ile GELMEZ, bu yuzden listede HER ZAMAN
                              ayrica gosterilir. Secilip "Kaydet"e basilinca
                              bu tasarim (dolayisiyla o yardim turu) ARTIK
                              KALICI olarak (bu bilgisayarda) sanal yazicaya
                              yonlenir - print onizleme penceresinde HER
                              SEFERINDE elle secmeye gerek kalmaz. */}
                          <option value={VIRTUAL_PRINTER_NAME}>{VIRTUAL_PRINTER_NAME}</option>
                          {/* "Kaydet" sonrasi VIRTUAL_PRINTER_NAME, gercek
                              yazicilarla ayni "clientPrinterNames" listesine
                              de eklenir (bkz. saveClientPrinterPreference) -
                              yukarida ZATEN sabit olarak gosterildigi icin
                              burada TEKRAR listelenmesin diye filtrelenir. */}
                          {clientPrinterNames.filter((printerName) => printerName !== VIRTUAL_PRINTER_NAME).map((printerName) => (
                            <option key={printerName} value={printerName}>{printerName}</option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <label className="flex h-9 cursor-pointer items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-center text-lg font-black text-emerald-700 transition hover:border-emerald-500">
                          JSON Yükle
                          <input
                            type="file"
                            accept="application/json,.json"
                            className="sr-only"
                            onChange={(event) => {
                              void importClientPrinterJson(event.target.files?.[0] ?? null)
                              event.target.value = ''
                            }}
                          />
                          </label>
                        <button
                          type="button"
                          onClick={exportClientPrinterJson}
                          className="h-9 rounded-md border border-emerald-200 bg-white px-3 text-lg font-black text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-50"
                        >
                          JSON Kaydet
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadPrintersFromLocalAgent()}
                          className="h-9 rounded-md border border-sky-200 bg-sky-50 px-3 text-lg font-black text-[#0076b6] transition hover:border-[#0076b6]"
                        >
                          Agenttan Al
                        </button>
                        <a
                          href="/api/print-agent/package"
                          className="flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-center text-lg font-black text-slate-700 transition hover:border-[#0076b6] hover:text-[#0076b6]"
                        >
                          Agent Paketi
                        </a>
                        <button
                          type="button"
                          onClick={() => saveClientPrinterPreference(selectedFormDesign.id, selectedClientPrinterName)}
                          disabled={!selectedClientPrinterName.trim()}
                          className="h-9 rounded-md border border-slate-300 bg-slate-50 px-3 text-lg font-black text-slate-700 transition hover:border-[#0076b6] hover:text-[#0076b6] disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
                        >
                          Kaydet
                        </button>
                        </div>
                      </div>
                      {selectedClientPrinterSource && <span className="block text-base font-bold leading-4 text-emerald-700">{selectedClientPrinterSource}: {selectedClientPrinterName}</span>}
                      {clientPrinterDiscoveryStatus && <span className="block text-base font-bold leading-4 text-slate-500">{clientPrinterDiscoveryStatus}</span>}
                    </div>

                  </div>
                </section>
              )}
            </div>
            )}
          </aside>

          <aside className="h-full min-h-0 space-y-4 overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white p-3 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black uppercase text-slate-500">Veri Alanları</h2>
                <span className="text-lg font-bold text-slate-400">{reportFieldGroups.reduce((sum, group) => sum + group.fields.length, 0)} alan</span>
              </div>
              <input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Alan, token veya tablo ara" className={inputClassName} />
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                {fieldTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveFieldTabId(tab.id)
                      setFieldSearch('')
                      const assistanceGroupId = assistanceFieldGroupMap[normalizePrinterConfigKey(selectedFormDesign?.linkedAssistance || '')]
                      setOpenFieldGroupIds(
                        tab.id === 'yardimlar'
                          ? assistanceGroupId ? ['yardim_ortak', assistanceGroupId] : []
                          : tab.groupIds,
                      )
                    }}
                    className={`flex min-h-9 items-center justify-between rounded-md border px-3 py-2 text-left text-lg font-black transition ${
                      activeFieldTabId === tab.id && !fieldSearch
                        ? 'border-[#0076b6] bg-[#0076b6] text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50'
                    }`}
                  >
                    <span>{tab.title}</span>
                    <span className="text-base">{activeFieldTabId === tab.id ? '▾' : '›'}</span>
                  </button>
                ))}
              </div>
              <div className="overflow-hidden rounded-lg border border-sky-200 bg-white shadow-sm">
                <div className="flex items-center justify-between bg-gradient-to-r from-[#005f95] to-[#00a77a] px-3 py-2 text-white">
                  <span className="text-lg font-black">
                    {fieldTabs.find((tab) => tab.id === activeFieldTabId)?.title}
                  </span>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-sm font-bold">
                    {activeFieldTabId === 'yardimlar' && selectedFormDesign?.linkedAssistance !== 'Tümü'
                      ? selectedFormDesign?.linkedAssistance
                      : `${filteredFieldGroups.reduce((sum, group) => sum + group.fields.length, 0)} alan`}
                  </span>
                </div>
                <div className="max-h-[calc(100vh-390px)] space-y-2 overflow-y-auto p-2">
                {filteredFieldGroups.map((group) => (
                  <details
                    key={`${selectedFormDesign?.linkedAssistance || 'tum'}-${group.id}`}
                    className="group overflow-hidden rounded-md border border-slate-200 bg-white"
                    open={Boolean(fieldSearch) || openFieldGroupIds.includes(group.id)}
                    onToggle={(event) => {
                      if (fieldSearch) return
                      const isOpen = event.currentTarget.open
                      setOpenFieldGroupIds((current) =>
                        isOpen
                          ? current.includes(group.id) ? current : [...current, group.id]
                          : current.filter((id) => id !== group.id),
                      )
                    }}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between bg-slate-50 px-3 py-2 text-base font-black uppercase text-[#005f95] transition hover:bg-sky-50">
                      <span>{group.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sm text-sky-700">{group.fields.length}</span>
                        <span className="transition group-open:rotate-180">⌄</span>
                      </span>
                    </summary>
                    <div className="grid grid-cols-1 gap-1 border-t border-slate-200 p-2">
                      {group.fields.map((field) => (
                        <button
                          key={field.token}
                          type="button"
                          draggable
                          title={`${field.source} - {{${field.token}}}`}
                          onDragStart={() => {
                            setDraggedField(field)
                            setDraggedTool(null)
                          }}
                          onContextMenu={(event) => prepareDataFieldCopy(event, field)}
                          onClick={() => selectedFormDesign && addFieldToDesign(selectedFormDesign.id, field)}
                          className="rounded-md border border-slate-200 bg-white px-2 py-2 text-left transition hover:border-sky-300 hover:bg-sky-50"
                        >
                          <span className="block text-lg font-black text-slate-700">{field.label}</span>
                          <span data-designer-field-token className="block select-text truncate text-base font-semibold text-slate-400">{`{{${field.token}}}`}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                ))}
                </div>
              </div>
            </div>
          </aside>

          <main className={`${selectedBlock || selectedBand ? '' : 'xl:col-span-2'} flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden`}>
            <section className="shrink-0 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
              {selectedFormDesign && (selectedFormDesign.bands?.length || 0) > 0 && (
                <div className="mb-3 flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2">
                  <span className="shrink-0 text-base font-black uppercase text-slate-400">Sayfalar</span>
                  {selectedFormDesign.bands?.map((band, index) => {
                    const isActive = activeDesignerBand?.id === band.id
                    return (
                      <button
                        key={band.id}
                        type="button"
                        onClick={() => {
                          setSelectedBandId(band.id)
                          setSelectedBlockId(null)
                          setSelectedBlockIds([])
                        }}
                        className={`flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-base font-black transition ${
                          isActive
                            ? 'border-[#0076b6] bg-[#0076b6] text-white shadow-sm'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-300 hover:bg-sky-50'
                        }`}
                      >
                        <span className={`flex h-5 min-w-5 items-center justify-center rounded ${isActive ? 'bg-white/20' : 'bg-white text-[#0076b6]'}`}>
                          {index + 1}
                        </span>
                        <span>Sayfa {index + 1}</span>
                        <span className={`max-w-28 truncate ${isActive ? 'text-sky-100' : 'text-slate-400'}`}>{band.name}</span>
                      </button>
                    )
                  })}
                  <span className="ml-auto shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-black text-emerald-700">
                    {selectedFormDesign.bands?.length || 0} sayfa
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                {designToolTypes.map((tool) => (
                  <button
                    key={tool.type}
                    type="button"
                    draggable
                    title={tool.description}
                    onDragStart={() => {
                      setDraggedTool(tool.type)
                      setDraggedField(null)
                    }}
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-lg font-black text-slate-700 transition hover:border-[#0076b6] hover:bg-sky-50 hover:text-[#0076b6]"
                  >
                    {tool.label}
                  </button>
                ))}
                <label
                  title="Bilgisayardan resim veya logo ekle"
                  className="flex h-9 cursor-pointer items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 text-lg font-black text-emerald-700 transition hover:border-emerald-600 hover:bg-emerald-100"
                >
                  Resim Ekle
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) addImageToSelectedDesign(file)
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  {selectedFormDesign && (
                    <span className="hidden rounded bg-sky-100 px-2 py-1 text-base font-black text-[#005f95] sm:inline">
                      {selectedFormDesign.width || (selectedFormDesign.type === 'a4' ? '210' : '80')} × {selectedFormDesign.height || (selectedFormDesign.type === 'a4' ? '297' : '40')} mm
                    </span>
                  )}
                  <button type="button" onClick={() => setDesignerZoom((value) => Math.max(50, value - 10))} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-lg font-black text-slate-700 hover:border-[#0076b6] hover:text-[#0076b6]">
                    -
                  </button>
                  <input
                    type="range"
                    min={50}
                    max={180}
                    step={5}
                    value={designerZoom}
                    onChange={(event) => setDesignerZoom(Number(event.target.value))}
                    className="w-32 accent-[#0076b6]"
                    aria-label="Yakınlaştırma"
                  />
                  <button type="button" onClick={() => setDesignerZoom((value) => Math.min(180, value + 10))} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-lg font-black text-slate-700 hover:border-[#0076b6] hover:text-[#0076b6]">
                    +
                  </button>
                  <button type="button" onClick={() => setDesignerZoom(100)} className="h-9 rounded border border-slate-300 bg-white px-3 text-lg font-black text-slate-700 hover:border-[#0076b6] hover:text-[#0076b6]">
                    Gerçek Boyut
                  </button>
                  <span className="min-w-10 text-center text-base font-black text-slate-600">{designerZoom}%</span>
                </div>
              </div>
            </section>

            <section className="min-h-[620px] flex-1 overflow-auto overscroll-contain rounded-md border border-slate-300 bg-slate-200 p-4 shadow-inner xl:min-h-0">
              {selectedFormDesign ? (
                <div className="mx-auto" style={{ width: `${canvasMetrics.width * canvasScale}px`, minHeight: `${editorCanvasHeight * canvasScale}px` }}>
                  <div
                    className="relative origin-top-left bg-white shadow-2xl ring-1 ring-slate-300"
                    style={{
                      width: `${canvasMetrics.width}px`,
                      minHeight: `${canvasMetrics.minHeight}px`,
                      transform: `scale(${canvasScale})`,
                    }}
                    onClick={() => {
                      setSelectedBlockId(null)
                      setSelectedBlockIds([])
                    }}
                  >
                    {selectedFormDesign.bands?.filter((band) => band.id === activeDesignerBand?.id).map((band) => (
                      <div
                      key={band.id}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDropOnBand(event, selectedFormDesign, band.id)}
                      onPointerDown={(event) => startSelectionMarquee(event, band.id)}
                      onPointerMove={(event) => moveSelectionMarquee(event, band.id)}
                      onPointerUp={(event) => finishSelectionMarquee(event, band.id)}
                      onPointerCancel={() => setSelectionMarquee(null)}
                      onContextMenu={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        pasteTargetRef.current = {
                          designId: selectedFormDesign.id,
                          bandId: band.id,
                          x: Math.max(0, Math.round((event.clientX - rect.left) / canvasScale)),
                          y: Math.max(0, Math.round((event.clientY - rect.top) / canvasScale)),
                        }
                        setSelectedBandId(band.id)
                        setSelectedBlockId(null)
                        setSelectedBlockIds([])
                      }}
                      className={`relative border-b border-dashed border-slate-300 transition ${selectedBandId === band.id ? 'bg-sky-50 ring-2 ring-sky-500' : 'hover:bg-sky-50/50'}`}
                      style={{ height: `${Math.max(band.height, canvasMetrics.minHeight)}px` }}
                      >
                        {selectionMarquee?.bandId === band.id && (
                          <div
                            className="pointer-events-none absolute z-40 border-2 border-dashed border-indigo-600 bg-indigo-300/25"
                            style={{
                              left: `${Math.min(selectionMarquee.startX, selectionMarquee.currentX)}px`,
                              top: `${Math.min(selectionMarquee.startY, selectionMarquee.currentY)}px`,
                              width: `${Math.abs(selectionMarquee.currentX - selectionMarquee.startX)}px`,
                              height: `${Math.abs(selectionMarquee.currentY - selectionMarquee.startY)}px`,
                            }}
                          />
                        )}
                        <div className="absolute right-0 top-0 z-10 border-b border-l border-slate-200 bg-slate-100 px-2 py-1 text-base font-black uppercase text-slate-500">
                          {band.name}
                        </div>
                        {selectedFormDesign.blocks?.filter((block) => block.bandId === band.id).map((block) => (
                          <div
                          key={block.id}
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation()
                            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            setDraggedBlock({
                              designId: selectedFormDesign.id,
                              blockId: block.id,
                              offsetX: (event.clientX - rect.left) / canvasScale,
                              offsetY: (event.clientY - rect.top) / canvasScale,
                            })
                            if (!selectedBlockIds.includes(block.id)) {
                              setSelectedBlockId(block.id)
                              setSelectedBlockIds([block.id])
                            }
                            setSelectedBandId(band.id)
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            selectDesignerBlock(block.id, event.ctrlKey || event.metaKey)
                          }}
                          className={`absolute cursor-move overflow-hidden px-1 leading-tight ${
                            selectedBlockIds.includes(block.id)
                              ? selectedBlockId === block.id
                                ? 'border border-sky-500 bg-sky-50 ring-2 ring-sky-500'
                                : 'border border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500'
                              : 'border border-transparent hover:border-slate-400'
                          }`}
                          style={{
                            left: `${block.x}px`,
                            top: `${block.y}px`,
                            width: block.width ? `${block.width}px` : 'auto',
                            height: block.height ? `${block.height}px` : 'auto',
                            fontSize: `${getDesignerBlockFontSize(block)}px`,
                            fontFamily: block.fontFamily || 'Arial, Helvetica, sans-serif',
                            fontWeight: block.fontWeight || 'normal',
                            textAlign: block.textAlign || 'left',
                            writingMode: block.textDirection === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                            textOrientation: 'mixed',
                            color: block.textColor || '#111827',
                            backgroundColor: block.backgroundColor || 'transparent',
                            borderColor: selectedBlockIds.includes(block.id) ? undefined : block.borderWidth ? block.borderColor : undefined,
                            borderWidth: selectedBlockIds.includes(block.id) ? undefined : `${block.borderWidth || 0}px`,
                            borderStyle: selectedBlockIds.includes(block.id) ? undefined : block.borderWidth ? 'solid' : undefined,
                          }}
                          >
                            {blockPreview(block)}
                            {selectedBlockId === block.id &&
                              (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                                <span
                                  key={corner}
                                  draggable={false}
                                  aria-label={`${corner} köşesinden boyutlandır`}
                                  onDragStart={(event) => event.preventDefault()}
                                  onPointerDown={(event) => startBlockResize(event, selectedFormDesign.id, band, block, corner)}
                                  className={`absolute z-20 h-2.5 w-2.5 rounded-sm border-2 border-white bg-sky-600 shadow ${
                                    corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
                                  }`}
                                  style={{
                                    left: corner === 'nw' || corner === 'sw' ? 0 : undefined,
                                    right: corner === 'ne' || corner === 'se' ? 0 : undefined,
                                    top: corner === 'nw' || corner === 'ne' ? 0 : undefined,
                                    bottom: corner === 'sw' || corner === 'se' ? 0 : undefined,
                                  }}
                                />
                              ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[420px] items-center justify-center text-sm font-bold text-slate-400">
                  Bir tasarım seçin veya yeni tasarım oluşturun.
                </div>
              )}
            </section>
          </main>

          <aside className={`${selectedBlock || selectedBand ? 'block' : 'hidden'} h-full min-h-0 space-y-4 overflow-y-auto overscroll-contain rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/80 via-white to-white p-3.5 shadow-[0_10px_30px_rgba(15,76,117,0.12)] [scrollbar-color:#94a3b8_transparent] [scrollbar-width:thin] [&_label>span:first-child]:tracking-wide`}>
            {selectedBlock && selectedFormDesign ? (
              <section className="space-y-4">
                <div className="sticky top-0 z-30 -mx-1 flex items-center justify-between rounded-lg bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-3 py-2.5 text-white shadow-md">
                  <div>
                    <span className="block text-sm font-bold uppercase tracking-[0.16em] text-sky-100">Seçili Tasarım Alanı</span>
                    <h2 className="mt-0.5 text-sm font-black uppercase tracking-wide">Blok Özellikleri</h2>
                  </div>
                  <span className="rounded-md border border-white/25 bg-white/15 px-2.5 py-1 text-base font-black uppercase text-white shadow-inner">{selectedBlock.type}</span>
                </div>
                <button
                  type="button"
                  onClick={selectAllDesignerBlocks}
                  disabled={!selectedFormDesign.blocks?.length}
                  className={`flex h-9 w-full items-center justify-between rounded-md border px-3 text-base font-black uppercase transition ${
                    selectedBlockIds.length === (selectedFormDesign.blocks?.length || 0)
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-100'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span>Tüm Alanları Seç</span>
                  <span className="rounded bg-white/80 px-2 py-0.5 text-sm text-emerald-800">
                    {selectedBlockIds.length}/{selectedFormDesign.blocks?.length || 0}
                  </span>
                </button>
                {selectedBlockIds.length >= 2 && (
                  <section className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-black uppercase text-indigo-800">
                        {selectedBlockIds.length} alan seçildi
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedBlockIds(selectedBlockId ? [selectedBlockId] : [])}
                        className="text-sm font-black uppercase text-indigo-600 hover:text-indigo-900"
                      >
                        Diğerlerini Bırak
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button type="button" onClick={() => alignSelectedBlocks('left')} className="h-9 rounded-md border border-indigo-200 bg-white text-base font-black text-indigo-700 hover:bg-indigo-600 hover:text-white">Sola</button>
                      <button type="button" onClick={() => alignSelectedBlocks('center-x')} className="h-9 rounded-md border border-indigo-200 bg-white text-base font-black text-indigo-700 hover:bg-indigo-600 hover:text-white">Yatay Orta</button>
                      <button type="button" onClick={() => alignSelectedBlocks('right')} className="h-9 rounded-md border border-indigo-200 bg-white text-base font-black text-indigo-700 hover:bg-indigo-600 hover:text-white">Sağa</button>
                      <button type="button" onClick={() => alignSelectedBlocks('top')} className="h-9 rounded-md border border-indigo-200 bg-white text-base font-black text-indigo-700 hover:bg-indigo-600 hover:text-white">Üste</button>
                      <button type="button" onClick={() => alignSelectedBlocks('center-y')} className="h-9 rounded-md border border-indigo-200 bg-white text-base font-black text-indigo-700 hover:bg-indigo-600 hover:text-white">Dikey Orta</button>
                      <button type="button" onClick={() => alignSelectedBlocks('bottom')} className="h-9 rounded-md border border-indigo-200 bg-white text-base font-black text-indigo-700 hover:bg-indigo-600 hover:text-white">Alta</button>
                    </div>
                    <span className="block rounded bg-white/80 px-2 py-1 text-sm font-semibold leading-4 text-indigo-700">
                      Yön tuşlarıyla 1 ölçü, Shift + yön tuşlarıyla 10 ölçü taşıyabilirsiniz. Seçili bir alanı fareyle sürüklediğinizde tüm grup birlikte taşınır.
                    </span>
                    <div className="border-t border-indigo-200 pt-2">
                      <span className="mb-1.5 block text-sm font-black uppercase text-indigo-800">Satır Aralığını Eşitle</span>
                      <div className="flex overflow-hidden rounded-md border border-indigo-200 bg-white">
                        <label className="min-w-0 flex-1">
                          <span className="sr-only">Satır başlangıçları arasındaki mesafe</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={multiBlockGaps.vertical}
                            onChange={(event) =>
                              setMultiBlockGaps((current) => ({ ...current, vertical: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') spaceSelectedBlocks('vertical')
                            }}
                            placeholder="Satır aralığı ölçüsü"
                            className="h-9 w-full min-w-0 border-0 bg-transparent px-2 text-base font-bold text-slate-800 outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => spaceSelectedBlocks('vertical')}
                          disabled={multiBlockGaps.vertical === ''}
                          className="h-9 shrink-0 border-l border-indigo-200 bg-indigo-100 px-3 text-sm font-black text-indigo-700 hover:bg-indigo-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Satırları Uygula
                        </button>
                      </div>
                      <span className="mt-1.5 block text-sm font-semibold leading-4 text-indigo-600">
                        Aynı hizadaki alanlar tek satır kabul edilir. İlk satır sabit kalır; diğer satır başlangıçları aynı mesafeyle yerleştirilir.
                      </span>
                    </div>
                    <div className="border-t border-indigo-200 pt-2">
                      <span className="mb-1.5 block text-sm font-black uppercase text-indigo-800">Kesin Kenar Boşluğu</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          ['left', 'Soldan'],
                          ['right', 'Sağdan'],
                          ['top', 'Üstten'],
                          ['bottom', 'Alttan'],
                        ] as const).map(([edge, label]) => (
                          <div key={edge} className="flex overflow-hidden rounded-md border border-indigo-200 bg-white">
                            <label className="min-w-0 flex-1">
                              <span className="sr-only">{label} boşluk</span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={multiEdgeOffsets[edge]}
                                onChange={(event) =>
                                  setMultiEdgeOffsets((current) => ({ ...current, [edge]: event.target.value }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') positionSelectedBlocksFromEdge(edge)
                                }}
                                placeholder={`${label} ölçü`}
                                className="h-9 w-full min-w-0 border-0 bg-transparent px-2 text-base font-bold text-slate-800 outline-none"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => positionSelectedBlocksFromEdge(edge)}
                              disabled={multiEdgeOffsets[edge] === ''}
                              className="h-9 shrink-0 border-l border-indigo-200 bg-indigo-100 px-2 text-sm font-black text-indigo-700 hover:bg-indigo-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Uygula
                            </button>
                          </div>
                        ))}
                      </div>
                      <span className="mt-1.5 block text-sm font-semibold leading-4 text-indigo-600">
                        Örnek: Soldan 30 veya sağdan 20 girip Uygula’ya basın.
                      </span>
                    </div>
                  </section>
                )}
                <details className="group overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-gradient-to-r from-slate-700 to-slate-600 px-3.5 py-3 text-lg font-black uppercase text-white transition hover:from-slate-800 hover:to-slate-700">
                    <span>
                      <span className="block">Tasarım Katmanları ({selectedFormDesign.blocks?.length || 0})</span>
                      <span className="mt-0.5 block text-sm font-semibold normal-case text-slate-200">Alanları seçin, yönetin veya temizleyin</span>
                    </span>
                    {getDuplicateBlockIds(selectedFormDesign.blocks || []).size > 0 && (
                      <span className="rounded bg-rose-500 px-2 py-0.5 text-sm text-white">
                        {getDuplicateBlockIds(selectedFormDesign.blocks || []).size} mükerrer
                      </span>
                    )}
                  </summary>
                  <div className="max-h-60 space-y-1.5 overflow-y-auto border-t border-slate-200 p-2.5">
                    {[...(selectedFormDesign.blocks || [])].reverse().map((block, index) => (
                      <div
                        key={block.id}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                          selectedBlockIds.includes(block.id) ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedBlockIds.includes(block.id)}
                          onChange={() => selectDesignerBlock(block.id, true)}
                          className="h-4 w-4 shrink-0 accent-indigo-600"
                          aria-label={`${block.value || block.type} katmanını seç`}
                        />
                        <button
                          type="button"
                          onClick={() => selectDesignerBlock(block.id)}
                          className="min-w-0 flex-1 text-left"
                          title={block.value}
                        >
                          <span className="block truncate text-base font-black text-slate-800">
                            {(selectedFormDesign.blocks?.length || 0) - index}. {block.value || block.type}
                          </span>
                          <span className="block text-sm font-semibold text-slate-400">
                            Sol {block.x} · Üst {block.y} · {block.width || 'Otomatik'}×{block.height || 'Otomatik'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeBlock(selectedFormDesign.id, block.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-rose-50 text-lg font-black text-rose-600 hover:bg-rose-600 hover:text-white"
                          title="Bu katmanı sil"
                          aria-label={`${block.value || block.type} katmanını sil`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {getDuplicateBlockIds(selectedFormDesign.blocks || []).size > 0 && (
                      <button
                        type="button"
                        onClick={() => removeDuplicateBlocks(selectedFormDesign.id)}
                        className="mt-2 h-8 w-full rounded-md bg-rose-600 text-base font-black text-white hover:bg-rose-700"
                      >
                        Birebir Mükerrerleri Temizle
                      </button>
                    )}
                  </div>
                </details>
                <details open className="group overflow-hidden rounded-xl border border-sky-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-gradient-to-r from-sky-600 to-cyan-500 px-3.5 py-3 text-white">
                    <span>
                      <span className="block text-lg font-black uppercase tracking-wide">İçerik ve Veri</span>
                      <span className="mt-0.5 block text-sm font-semibold text-sky-100">Metin, değişken veya görsel içeriği</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm font-black transition group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="p-3">
                {selectedBlock.type === 'image' ? (
                  <div className="space-y-2">
                    <span className="text-lg font-black uppercase text-slate-500">Eklenen Görsel</span>
                    <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-2">
                      <img src={selectedBlock.value} alt="Eklenen tasarım görseli" draggable={false} className="h-full w-full select-none object-contain" />
                    </div>
                    <label className="flex h-9 cursor-pointer items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-base font-black uppercase text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-100">
                      Resmi Değiştir
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) replaceDesignBlockImage(selectedFormDesign.id, selectedBlock.id, file)
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                    {selectedBlockIds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => selectDesignerBlock(selectedBlock.id)}
                        className="h-8 w-full rounded-md border border-sky-200 bg-sky-50 text-base font-black text-[#0076b6] hover:border-[#0076b6]"
                      >
                        Yalnızca Bu Resmi Seç
                      </button>
                    )}
                  </div>
                ) : (
                  <label className="block space-y-2">
                    <span className="text-lg font-black uppercase text-slate-500">Değer / İçerik</span>
                    <textarea value={selectedBlock.value} onChange={(event) => updateBlock(selectedFormDesign.id, selectedBlock.id, 'value', event.target.value)} className={`${inputClassName} h-28 resize-y py-2.5 leading-5`} />
                  </label>
                )}
                  </div>
                </details>
                <details open className="group overflow-hidden rounded-xl border border-teal-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-gradient-to-r from-teal-600 to-emerald-500 px-3.5 py-3 text-white">
                    <span>
                      <span className="block text-lg font-black uppercase tracking-wide">Konum ve Ölçü</span>
                      <span className="mt-0.5 block text-sm font-semibold text-teal-50">Yerleşim, genişlik ve yükseklik</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm font-black transition group-open:rotate-180">⌄</span>
                  </summary>
                <div className="grid grid-cols-2 gap-2 p-3">
                  {(['x', 'y', 'width', 'height'] as const).map((field) => (
                    <label key={field} className="block space-y-1.5">
                      <span className="text-lg font-black uppercase text-slate-500">
                        {field === 'x' ? 'Sol' : field === 'y' ? 'Üst' : field === 'width' ? 'Genişlik' : 'Yükseklik'}
                        {(field === 'width' || field === 'height') && selectedBlockIds.length > 1 ? ` (${selectedBlockIds.length} alan)` : ''}
                      </span>
                      <input
                        type="number"
                        value={selectedBlock[field] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value === '' ? undefined : Number(event.target.value)
                          if (field === 'width' || field === 'height') {
                            updateSelectedBlockDimension(selectedFormDesign.id, selectedBlock.id, field, value)
                          } else {
                            updateBlock(selectedFormDesign.id, selectedBlock.id, field, value ?? 0)
                          }
                        }}
                        className={inputClassName}
                      />
                    </label>
                  ))}
                </div>
                </details>
                <details className="group overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3.5 py-3 text-white">
                    <span>
                      <span className="block text-lg font-black uppercase tracking-wide">Yazı Biçimi</span>
                      <span className="mt-0.5 block text-sm font-semibold text-violet-100">Yazı tipi, boyutu ve kalınlığı</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm font-black transition group-open:rotate-180">⌄</span>
                  </summary>
                <div className="grid grid-cols-2 gap-2 p-3">
                  <label className="col-span-2 block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">
                      Yazı Tipi {selectedBlockIds.length > 1 ? `(${selectedBlockIds.length} alana uygulanır)` : ''}
                    </span>
                    <select
                      value={selectedBlock.fontFamily || 'Arial, Helvetica, sans-serif'}
                      onChange={(event) =>
                        updateSelectedBlockTypography(selectedFormDesign.id, selectedBlock.id, 'fontFamily', event.target.value)
                      }
                      className={inputClassName}
                    >
                      <option value="Arial, Helvetica, sans-serif">Arial</option>
                      <option value="Calibri, Arial, sans-serif">Calibri</option>
                      <option value="Tahoma, Arial, sans-serif">Tahoma</option>
                      <option value="Verdana, Arial, sans-serif">Verdana</option>
                      <option value="'Times New Roman', Times, serif">Times New Roman</option>
                      <option value="'Courier New', Courier, monospace">Courier New</option>
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">Yazı Boyutu</span>
                    <input type="number" min={6} value={selectedBlock.fontSize || 14} onChange={(event) => updateSelectedBlockTypography(selectedFormDesign.id, selectedBlock.id, 'fontSize', Number(event.target.value))} className={inputClassName} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">Kalınlık</span>
                    <select value={selectedBlock.fontWeight || 'normal'} onChange={(event) => updateSelectedBlockTypography(selectedFormDesign.id, selectedBlock.id, 'fontWeight', event.target.value)} className={inputClassName}>
                      <option value="normal">Normal</option>
                      <option value="600">Yarı Kalın</option>
                      <option value="bold">Kalın</option>
                      <option value="900">Ekstra Kalın</option>
                    </select>
                  </label>
                </div>
                </details>
                <details className="group overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-gradient-to-r from-indigo-600 to-blue-500 px-3.5 py-3 text-white">
                    <span>
                      <span className="block text-lg font-black uppercase tracking-wide">Hizalama ve Yerleşim</span>
                      <span className="mt-0.5 block text-sm font-semibold text-indigo-100">Hücre içi konum, yön ve sığdırma</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm font-black transition group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="p-3">
                {(selectedBlock.type === 'text' || selectedBlock.type === 'variable') && (
                  <section className="space-y-3 rounded-lg border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-3">
                    <div>
                      <span className="block text-lg font-black uppercase tracking-wide text-sky-900">Hücre İçi Yazı Yerleşimi</span>
                      <span className="mt-0.5 block text-base font-semibold text-sky-600">Metnin hücre içindeki kesin konumunu seçin</span>
                    </div>

                    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                      <div className="grid h-28 grid-cols-3 grid-rows-3 gap-1 rounded-md border border-sky-200 bg-white p-1.5">
                        {(['top', 'middle', 'bottom'] as const).flatMap((verticalAlign) =>
                          (['left', 'center', 'right'] as const).map((textAlign) => {
                            const active =
                              (selectedBlock.textAlign || 'left') === textAlign &&
                              (selectedBlock.verticalAlign || 'top') === verticalAlign
                            const verticalLabel = verticalAlign === 'top' ? 'Üst' : verticalAlign === 'middle' ? 'Orta' : 'Alt'
                            const horizontalLabel = textAlign === 'left' ? 'Sol' : textAlign === 'center' ? 'Orta' : 'Sağ'
                            return (
                              <button
                                key={`${verticalAlign}-${textAlign}`}
                                type="button"
                                title={`${verticalLabel} ${horizontalLabel}`}
                                aria-label={`${verticalLabel} ${horizontalLabel}`}
                                onClick={() => updateBlockCellAlignment(selectedFormDesign.id, selectedBlock.id, textAlign, verticalAlign)}
                                className={`flex items-center rounded border p-1 transition ${
                                  textAlign === 'left' ? 'justify-start' : textAlign === 'center' ? 'justify-center' : 'justify-end'
                                } ${
                                  verticalAlign === 'top' ? 'self-start' : verticalAlign === 'middle' ? 'self-center' : 'self-end'
                                } ${
                                  active
                                    ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                                    : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600'
                                }`}
                              >
                                <span className="h-2 w-2 rounded-full bg-current" />
                              </button>
                            )
                          }),
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                          {([
                            ['horizontal', 'Yatay'],
                            ['vertical', 'Dikey'],
                          ] as const).map(([direction, label]) => (
                            <button
                              key={direction}
                              type="button"
                              onClick={() => updateBlock(selectedFormDesign.id, selectedBlock.id, 'textDirection', direction)}
                              className={`h-8 rounded text-lg font-black transition ${
                                (selectedBlock.textDirection || 'horizontal') === direction
                                  ? 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-200'
                                  : 'text-slate-500 hover:text-sky-700'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(selectedBlock.autoFitText)}
                          onClick={() => updateBlock(selectedFormDesign.id, selectedBlock.id, 'autoFitText', !selectedBlock.autoFitText)}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                            selectedBlock.autoFitText
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300'
                          }`}
                        >
                          <span className="text-base font-black">Otomatik Sığdır</span>
                          <span className={`relative h-5 w-9 rounded-full transition ${selectedBlock.autoFitText ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${selectedBlock.autoFitText ? 'left-[18px]' : 'left-0.5'}`} />
                          </span>
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => justifySelectedTextBlocks(selectedFormDesign.id, selectedBlock.id)}
                      className={`flex h-9 w-full items-center justify-center rounded-md border text-lg font-black transition ${
                        selectedBlock.textAlign === 'justify'
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                          : 'border-indigo-200 bg-white text-indigo-700 hover:border-indigo-500 hover:bg-indigo-50'
                      }`}
                    >
                      Metni İki Yana Yasla
                    </button>
                    <span className="block text-sm font-semibold leading-4 text-slate-500">
                      Uzun metinleri hücrenin sol ve sağ kenarına dengeli biçimde hizalar.
                      {selectedBlockIds.length > 1 ? ' Seçili metin alanlarının tümüne uygulanır.' : ''}
                    </span>
                  </section>
                )}
                {selectedBlock.type !== 'text' && selectedBlock.type !== 'variable' && (
                  <label className="block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">Hizalama</span>
                    <select value={selectedBlock.textAlign || 'left'} onChange={(event) => updateBlock(selectedFormDesign.id, selectedBlock.id, 'textAlign', event.target.value as DesignBlock['textAlign'])} className={inputClassName}>
                      <option value="left">Sol</option>
                      <option value="center">Orta</option>
                      <option value="right">Sağ</option>
                      <option value="justify">İki Yana</option>
                    </select>
                  </label>
                )}
                  </div>
                </details>
                <details className="group overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-gradient-to-r from-orange-500 to-amber-400 px-3.5 py-3 text-white">
                    <span>
                      <span className="block text-lg font-black uppercase tracking-wide">Görünüm ve Çerçeve</span>
                      <span className="mt-0.5 block text-sm font-semibold text-orange-50">Yazı, zemin ve kenarlık renkleri</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm font-black transition group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="space-y-3 p-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">Yazı</span>
                    <input type="color" value={selectedBlock.textColor || '#111827'} onChange={(event) => updateBlock(selectedFormDesign.id, selectedBlock.id, 'textColor', event.target.value)} className="h-9 w-full rounded border border-slate-300 bg-white p-1" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">Zemin</span>
                    <input type="color" value={selectedBlock.backgroundColor === 'transparent' ? '#ffffff' : selectedBlock.backgroundColor || '#ffffff'} onChange={(event) => updateBlock(selectedFormDesign.id, selectedBlock.id, 'backgroundColor', event.target.value)} className="h-9 w-full rounded border border-slate-300 bg-white p-1" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-lg font-black uppercase text-slate-500">Çerçeve</span>
                    <input type="color" value={selectedBlock.borderColor || '#111827'} onChange={(event) => updateBlock(selectedFormDesign.id, selectedBlock.id, 'borderColor', event.target.value)} className="h-9 w-full rounded border border-slate-300 bg-white p-1" />
                  </label>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-lg font-black uppercase text-slate-500">Çerçeve Kalınlığı</span>
                  <input type="number" min={0} value={selectedBlock.borderWidth || 0} onChange={(event) => updateBlock(selectedFormDesign.id, selectedBlock.id, 'borderWidth', Number(event.target.value))} className={inputClassName} />
                </label>
                  </div>
                </details>
                <button type="button" onClick={() => removeSelectedBlocks(selectedFormDesign.id, selectedBlock.id)} className="h-10 w-full rounded-lg bg-gradient-to-r from-rose-600 to-red-600 text-lg font-black text-white shadow-sm transition hover:from-rose-700 hover:to-red-700 hover:shadow-md">
                  {selectedBlockIds.length > 1 ? `Seçili ${selectedBlockIds.length} Alanı Sil` : 'Bloğu Sil'}
                </button>
              </section>
            ) : selectedBand && selectedFormDesign ? (
              <section className="space-y-4">
                <div className="sticky top-0 z-30 -mx-1 rounded-lg bg-gradient-to-r from-[#005f95] via-[#0076b6] to-emerald-600 px-3 py-2.5 text-white shadow-md">
                  <span className="block text-sm font-bold uppercase tracking-[0.16em] text-sky-100">Seçili Sayfa Alanı</span>
                  <h2 className="mt-0.5 text-sm font-black uppercase tracking-wide">Bant Özellikleri</h2>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-lg font-black uppercase text-slate-500">Bant Adı</span>
                  <input value={selectedBand.name} onChange={(event) => updateBand(selectedFormDesign.id, selectedBand.id, 'name', event.target.value)} className={inputClassName} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-lg font-black uppercase text-slate-500">Yükseklik px</span>
                  <input type="number" min={24} value={selectedBand.height} onChange={(event) => updateBand(selectedFormDesign.id, selectedBand.id, 'height', Number(event.target.value))} className={inputClassName} />
                </label>
                <section className="space-y-3 rounded-lg border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-3">
                  <div>
                    <h3 className="text-lg font-black uppercase text-[#005f95]">Sayfa ve Baskı Ayarları</h3>
                    <p className="mt-0.5 text-sm font-semibold text-slate-500">Sayfanın ölçüsünü ve yazıcı kenar boşluklarını ayarlayın.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="text-base font-black uppercase text-slate-500">Genişlik mm</span>
                      <input type="number" min={10} value={selectedFormDesign.width || '80'} onChange={(event) => updateDesign(selectedFormDesign.id, 'width', event.target.value)} className={inputClassName} />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-base font-black uppercase text-slate-500">Yükseklik mm</span>
                      <input type="number" min={10} value={selectedFormDesign.height || '40'} onChange={(event) => updateDesign(selectedFormDesign.id, 'height', event.target.value)} className={inputClassName} />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-base font-black uppercase text-slate-500">Sol Boşluk</span>
                      <input type="number" value={selectedFormDesign.printOffsetX || '0'} onChange={(event) => updateDesign(selectedFormDesign.id, 'printOffsetX', event.target.value)} className={inputClassName} />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-base font-black uppercase text-slate-500">Sağ Boşluk</span>
                      <input type="number" value={selectedFormDesign.printOffsetRight || '0'} onChange={(event) => updateDesign(selectedFormDesign.id, 'printOffsetRight', event.target.value)} className={inputClassName} />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-base font-black uppercase text-slate-500">Üst Boşluk</span>
                      <input type="number" value={selectedFormDesign.printOffsetY || '0'} onChange={(event) => updateDesign(selectedFormDesign.id, 'printOffsetY', event.target.value)} className={inputClassName} />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-base font-black uppercase text-slate-500">Alt Boşluk</span>
                      <input type="number" value={selectedFormDesign.printOffsetBottom || '0'} onChange={(event) => updateDesign(selectedFormDesign.id, 'printOffsetBottom', event.target.value)} className={inputClassName} />
                    </label>
                  </div>
                </section>
                <section className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <h3 className="text-lg font-black uppercase text-emerald-800">Yeni Bant Ekle</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(bandLabels) as ReportBand['type'][]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => addBand(selectedFormDesign.id, type)}
                        className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-base font-black text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-100"
                      >
                        {bandLabels[type]}
                      </button>
                    ))}
                  </div>
                </section>
                <button type="button" onClick={() => deleteBand(selectedFormDesign.id, selectedBand.id)} className="h-9 w-full rounded-md bg-rose-600 text-lg font-black text-white transition hover:bg-rose-700">
                  Bandı Sil
                </button>
              </section>
            ) : (
              <section className="space-y-4">
                {selectedFormDesign && (
                  <div className="space-y-2">
                    <h2 className="text-lg font-black uppercase text-slate-500">Bant Ekle</h2>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(bandLabels) as ReportBand['type'][]).map((type) => (
                        <button key={type} type="button" onClick={() => addBand(selectedFormDesign.id, type)} className={smallButtonClassName}>
                          {bandLabels[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-black uppercase text-slate-500">Veri Alanları</h2>
                    <span className="text-lg font-bold text-slate-400">{reportFieldGroups.reduce((sum, group) => sum + group.fields.length, 0)} alan</span>
                  </div>
                  <input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Alan, token veya tablo ara" className={inputClassName} />
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    {fieldTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveFieldTabId(tab.id)
                          setFieldSearch('')
                          const assistanceGroupId = assistanceFieldGroupMap[normalizePrinterConfigKey(selectedFormDesign?.linkedAssistance || '')]
                          setOpenFieldGroupIds(
                            tab.id === 'yardimlar'
                              ? assistanceGroupId ? ['yardim_ortak', assistanceGroupId] : []
                              : tab.groupIds,
                          )
                        }}
                        className={`flex min-h-9 items-center justify-between rounded-md border px-3 py-2 text-left text-lg font-black transition ${
                          activeFieldTabId === tab.id && !fieldSearch
                            ? 'border-[#0076b6] bg-[#0076b6] text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50'
                        }`}
                      >
                        <span>{tab.title}</span>
                        <span className="text-base">{activeFieldTabId === tab.id ? '▾' : '›'}</span>
                      </button>
                    ))}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-sky-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between bg-gradient-to-r from-[#005f95] to-[#00a77a] px-3 py-2 text-white">
                      <span className="text-lg font-black">
                        {fieldTabs.find((tab) => tab.id === activeFieldTabId)?.title}
                      </span>
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-sm font-bold">
                        {activeFieldTabId === 'yardimlar' && selectedFormDesign?.linkedAssistance !== 'Tümü'
                          ? selectedFormDesign?.linkedAssistance
                          : `${filteredFieldGroups.reduce((sum, group) => sum + group.fields.length, 0)} alan`}
                      </span>
                    </div>
                    <div className="max-h-[520px] space-y-2 overflow-y-auto p-2">
                    {filteredFieldGroups.map((group) => (
                      <details
                        key={`${selectedFormDesign?.linkedAssistance || 'tum'}-${group.id}`}
                        className="group overflow-hidden rounded-md border border-slate-200 bg-white"
                        open={Boolean(fieldSearch) || openFieldGroupIds.includes(group.id)}
                        onToggle={(event) => {
                          if (fieldSearch) return
                          const isOpen = event.currentTarget.open
                          setOpenFieldGroupIds((current) =>
                            isOpen
                              ? current.includes(group.id) ? current : [...current, group.id]
                              : current.filter((id) => id !== group.id),
                          )
                        }}
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between bg-slate-50 px-3 py-2 text-base font-black uppercase text-[#005f95] transition hover:bg-sky-50">
                          <span>{group.title}</span>
                          <span className="flex items-center gap-2">
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sm text-sky-700">{group.fields.length}</span>
                            <span className="transition group-open:rotate-180">⌄</span>
                          </span>
                        </summary>
                        <div className="grid grid-cols-1 gap-1 border-t border-slate-200 p-2">
                          {group.fields.map((field) => (
                            <button
                              key={field.token}
                              type="button"
                              draggable
                              title={`${field.source} - {{${field.token}}}`}
                              onDragStart={() => {
                                setDraggedField(field)
                                setDraggedTool(null)
                              }}
                              onContextMenu={(event) => prepareDataFieldCopy(event, field)}
                              onClick={() => selectedFormDesign && addFieldToDesign(selectedFormDesign.id, field)}
                              className="rounded-md border border-slate-200 bg-white px-2 py-2 text-left transition hover:border-sky-300 hover:bg-sky-50"
                            >
                              <span className="block text-lg font-black text-slate-700">{field.label}</span>
                              <span data-designer-field-token className="block select-text truncate text-base font-semibold text-slate-400">{`{{${field.token}}}`}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
