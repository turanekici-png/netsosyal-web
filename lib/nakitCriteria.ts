// Nakit Yardımı Müracaatları "Kriterleri Uygula" özelliği icin PAYLAŞILAN
// (client + server) tanim/degerlendirme mantigi. Bu dosyada prisma/'server-only'
// gibi sunucuya ozel importlar KASITLI OLARAK YOK - hem
// app/(modules)/assistance/nakit/_components/NakitCriteriaButton.tsx (client)
// hem de app/api/assistance/nakit/apply-criteria/route.ts (server) tarafindan
// import edilir; tek dogru kaynak (single source of truth) burasi.

import { normalizePredefinedText } from '@/lib/constants/predefinedValues'

export type CriterionValueType = 'number' | 'boolean'

export type CriterionTypeId =
  | 'income_limit'
  | 'request_amount_limit'
  | 'vehicle_year_limit'
  | 'household_size_limit'
  | 'under_18'
  | 'owns_vehicle'

export type CriterionDefinition = {
  id: CriterionTypeId
  label: string
  description: string
  valueType: CriterionValueType
  unit?: string
  placeholder?: string
  min?: number
  max?: number
}

export const NAKIT_CRITERIA_CATALOG: CriterionDefinition[] = [
  {
    id: 'income_limit',
    label: 'Aylık Gelir Üst Sınırı',
    description: 'Bu tutarı aşan aylık gelire sahip müracaatlar uygun görülmeyecektir.',
    valueType: 'number',
    unit: 'TL',
    placeholder: 'Örn: 15000',
    min: 0,
  },
  {
    id: 'request_amount_limit',
    label: 'Talep Edilen Miktar Üst Sınırı',
    description: 'Bu tutarı aşan miktar talep eden müracaatlar uygun görülmeyecektir.',
    valueType: 'number',
    unit: 'TL',
    placeholder: 'Örn: 20000',
    min: 0,
  },
  {
    id: 'vehicle_year_limit',
    label: 'Araç Modeli Üst Sınırı',
    description: 'Araç bilgisi alanında bu yıldan yeni bir model geçen müracaatlar uygun görülmeyecektir.',
    valueType: 'number',
    unit: 'Yıl',
    placeholder: 'Örn: 2015',
    min: 1900,
    max: 2200,
  },
  {
    id: 'household_size_limit',
    label: 'Aile Birey Sayısı Üst Sınırı',
    description: 'Toplam aile birey sayısı bu değeri aşan müracaatlar uygun görülmeyecektir.',
    valueType: 'number',
    unit: 'kişi',
    placeholder: 'Örn: 8',
    min: 0,
  },
  {
    id: 'under_18',
    label: '18 Yaşından Küçük Başvuru Sahibi',
    description: 'Doğum tarihine göre 18 yaşından küçük olan başvuru sahipleri uygun görülmeyecektir.',
    valueType: 'boolean',
  },
  {
    id: 'owns_vehicle',
    label: 'Araç Sahibi Olanlar',
    description: 'Araç bilgisi alanında (model yılına bakılmaksızın) araç sahibi olduğu anlaşılan müracaatlar uygun görülmeyecektir.',
    valueType: 'boolean',
  },
]

export const NAKIT_CRITERIA_MAP: Record<CriterionTypeId, CriterionDefinition> = NAKIT_CRITERIA_CATALOG.reduce(
  (map, definition) => {
    map[definition.id] = definition
    return map
  },
  {} as Record<CriterionTypeId, CriterionDefinition>,
)

export type SelectedCriterion = {
  type: CriterionTypeId
  value?: number
}

export type NakitCandidateRow = {
  aylikgelir: number | null
  miktar: number | null
  aracbilgisi: string | null
  dogumtarihi: Date | string | null
  topbirey: string | null
}

// aracbilgisi serbest metin bir alan - gercek verilerde hem 4 haneli
// ("EVET 1993") hem de 2 haneli kisaltilmis ("EVET 97", "EVET 96") yil
// formati kullaniliyor; arac yoksa "YOK" gibi rakamsiz deger giriliyor.
// Once 4 haneli yil aranir, bulunamazsa 2 haneli kisaltma pivot yontemiyle
// (ör. 97 -> 1997, 15 -> 2015) tam yila cevrilir. Birden fazla yil geciyorsa
// (ör. "2022 VE 2000") ust sinir kontrolu icin EN YENI yil esas alinir.
// Metinde hic sayi yoksa null doner (bu kriter o kayit icin degerlendirilemez).
export function extractVehicleYear(aracbilgisi: string | null): number | null {
  if (!aracbilgisi) return null
  const currentYear = new Date().getFullYear()

  const fourDigitMatches = aracbilgisi.match(/(19|20)\d{2}/g)
  if (fourDigitMatches) {
    const validYears = fourDigitMatches
      .map((match) => Number(match))
      .filter((year) => year >= 1900 && year <= currentYear + 1)
    if (validYears.length > 0) return Math.max(...validYears)
  }

  const twoDigitMatches = aracbilgisi.match(/\b\d{2}\b/g)
  if (twoDigitMatches) {
    const pivot = currentYear % 100
    const validYears = twoDigitMatches
      .map((match) => Number(match))
      .map((twoDigit) => (twoDigit <= pivot ? 2000 + twoDigit : 1900 + twoDigit))
      .filter((year) => year >= 1900 && year <= currentYear + 1)
    if (validYears.length > 0) return Math.max(...validYears)
  }

  return null
}

// aracbilgisi metninden "arac sahibi mi" bilgisini cikarir:
// - "YOK"/"HAYIR" geciyor ve "EVET"/"VAR" gecmiyorsa -> HAYIR (arac yok)
// - bir model yili cikarilabiliyorsa (extractVehicleYear) -> EVET
// - "EVET"/"VAR" geciyorsa (yil cikarilamasa bile, ör. "2 ARAÇ KAYDI") -> EVET
// - digerleri (bos, "-----", anlasilamayan) -> null (degerlendirilemez, atlanir)
export function hasVehicle(aracbilgisi: string | null): boolean | null {
  if (!aracbilgisi || !aracbilgisi.trim()) return null

  const upper = aracbilgisi.toLocaleUpperCase('tr-TR')
  const saysNo = /YOK|HAYIR/.test(upper)
  const saysYes = /EVET|VAR/.test(upper)

  if (extractVehicleYear(aracbilgisi) !== null) return true
  if (saysYes) return true
  if (saysNo) return false
  return null
}

// Belge ekleme sirasinda serbest metin olarak girilen "Gelir" alanini
// ("15.000 TL", "15.000,50", "15000" gibi Turkce bicimlerde) sayiya cevirir.
// Turkce yazim kurali: nokta binlik ayraci, virgul ondalik ayracidir - ancak
// tek basina nokta VE son parcasi 1-2 haneliyse ("1500.5" gibi) ondalik kabul
// edilir. Ayristirilamayan/anlamsiz metinlerde null doner. (Bkz. Otomatik Red
// kontrolu - hem tekil muracaat penceresinde hem de toplu kontrolde/bkz.
// lib/services/cashAutoReject.service.ts AYNI mantik kullanilir.)
export function parseFreeFormAmount(text: string | null | undefined): number | null {
  const cleaned = (text || '').replace(/[^\d.,-]/g, '')
  if (!cleaned) return null

  let normalized = cleaned
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  } else if (normalized.includes('.')) {
    const parts = normalized.split('.')
    if (!(parts.length === 2 && parts[1].length <= 2)) {
      normalized = normalized.replace(/\./g, '')
    }
  }

  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

export function calculateAge(dogumtarihi: Date | string | null): number | null {
  if (!dogumtarihi) return null
  const birthDate = dogumtarihi instanceof Date ? dogumtarihi : new Date(dogumtarihi)
  if (Number.isNaN(birthDate.getTime())) return null

  const now = new Date()
  let age = now.getFullYear() - birthDate.getFullYear()
  const hasHadBirthdayThisYear = now.getMonth() > birthDate.getMonth()
    || (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
}

// topbirey gercek veride sade rakam metni olarak tutuluyor (ör. "4"); yine de
// olasi bosluk/harf iceren varyasyonlara karsi bastaki sayiyi ayikliyoruz.
export function parseHouseholdSize(topbirey: string | null): number | null {
  if (!topbirey) return null
  const match = topbirey.match(/\d+/)
  if (!match) return null
  const value = Number(match[0])
  return Number.isFinite(value) ? value : null
}

// Bir kriteri tek bir muracaat kaydina uygular. Kayitta ilgili alan bos/
// degerlendirilemez ise (ör. arac bilgisi girilmemis) HİÇBİR ZAMAN ihlal
// SAYILMAZ - null doner ve o kriter o kayit icin sessizce atlanir.
export function evaluateCriterion(row: NakitCandidateRow, criterion: SelectedCriterion): string | null {
  switch (criterion.type) {
    case 'income_limit': {
      if (criterion.value === undefined || row.aylikgelir === null) return null
      if (Number(row.aylikgelir) > criterion.value) {
        return `Aylık gelir sınırı aşıldı (${row.aylikgelir} TL)`
      }
      return null
    }
    case 'request_amount_limit': {
      if (criterion.value === undefined || row.miktar === null) return null
      if (Number(row.miktar) > criterion.value) {
        return `Talep edilen miktar sınırı aşıldı (${row.miktar} TL)`
      }
      return null
    }
    case 'vehicle_year_limit': {
      if (criterion.value === undefined) return null
      const vehicleYear = extractVehicleYear(row.aracbilgisi)
      if (vehicleYear !== null && vehicleYear > criterion.value) {
        return `Araç modeli sınırı aşıldı (${vehicleYear})`
      }
      return null
    }
    case 'household_size_limit': {
      if (criterion.value === undefined) return null
      const householdSize = parseHouseholdSize(row.topbirey)
      if (householdSize !== null && householdSize > criterion.value) {
        return `Aile birey sayısı sınırı aşıldı (${householdSize} kişi)`
      }
      return null
    }
    case 'under_18': {
      const age = calculateAge(row.dogumtarihi)
      if (age !== null && age < 18) {
        return `Başvuru sahibi 18 yaşından küçük (${age})`
      }
      return null
    }
    case 'owns_vehicle': {
      if (hasVehicle(row.aracbilgisi) === true) {
        return 'Araç sahibi'
      }
      return null
    }
    default:
      return null
  }
}

// Kullanicidan gelen kriter listesini temizler: bilinmeyen turler ve DEGERI
// BOS BIRAKILMIŞ sayisal kriterler SESSIZCE elenir (hata verilmez) - boylece
// "bos alan icin kriteri uygulama" davranisi saglanir. Boolean kriterler
// deger gerektirmedigi icin her zaman gecerli sayilir.
export function sanitizeCriteria(rawCriteria: unknown): SelectedCriterion[] {
  if (!Array.isArray(rawCriteria)) return []

  const result: SelectedCriterion[] = []
  for (const entry of rawCriteria) {
    if (!entry || typeof entry !== 'object') continue
    const type = (entry as { type?: unknown }).type
    if (typeof type !== 'string' || !(type in NAKIT_CRITERIA_MAP)) continue

    const definition = NAKIT_CRITERIA_MAP[type as CriterionTypeId]
    if (definition.valueType === 'boolean') {
      result.push({ type: type as CriterionTypeId })
      continue
    }

    const rawValue = (entry as { value?: unknown }).value
    if (rawValue === undefined || rawValue === null || rawValue === '') continue // bos deger -> atla
    const value = Number(rawValue)
    if (!Number.isFinite(value)) continue
    if (definition.min !== undefined && value < definition.min) continue
    if (definition.max !== undefined && value > definition.max) continue

    result.push({ type: type as CriterionTypeId, value })
  }
  return result
}

// Kullanici istegi: Ayarlar > Hazır Değerler > Yardım Kriterleri altinda,
// AYNI kriter turu (Aylık Gelir/Araç Modeli/Tapu Kaydı) icin FARKLI
// DÖNEMLERE gore farkli sinir degerleri tanimlanabilsin (ör. "2026 Kırtasiye
// Yardımı" icin Aylık Gelir 26500, "2026 Emekli Yardımı" icin 40000 gibi).
// Genel PredefinedValue {id, name} yapisi DEGISTIRILMEDEN (id: kriter turu,
// name: deger), dönem bilgisi id alaninin ONUNE "<Dönem>::<Kriter Türü>"
// seklinde EKLENIR - boylece Hazır Değerler'in TUM diger kategorileri ve
// depolama semasi ETKILENMEZ, sadece bu kategorinin ayristirma/gosterim
// mantigi degisir. Dönem BELIRTILMEMIS (ayirici "::" YOK) eski/varsayilan
// satirlar "Tüm Dönemler" (genel, herhangi bir dönem eslesmesi bulunamazsa
// devreye giren) kriter olarak yorumlanir - GERIYE DONUK UYUMLULUK icin.
export const YARDIM_KRITERI_DONEM_AYIRICI = '::'

// Hata duzeltmesi: "tur" (Kriter Türü, ör. "Aylık Gelir") kismi BURADA
// trim() EDILMIYOR - kullanici Ayarlar > Yardım Kriterleri'nde bu alana
// yazarken, her tus vurusunda trim() cagrilmasi kelimeler arasindaki BOSLUGU
// aninda siliyordu ("Aylık " yazip devam edince bosluk hemen kayboluyor,
// "AylıkGelir" gibi birlesik gorunuyordu). Eslesme/karsilastirma tarafinda
// (bkz. findYardimKriteriValue) zaten normalizePredefinedText TUM bosluklari
// ve buyuk/kucuk harf farklarini yok sayarak karsilastirdigi icin, burada
// trim yapilmamasinin fonksiyonel bir sakincasi yok.
export function parseYardimKriteriId(id: string): { donem: string; tur: string } {
  const separatorIndex = id.indexOf(YARDIM_KRITERI_DONEM_AYIRICI)
  if (separatorIndex === -1) {
    return { donem: '', tur: id }
  }
  return {
    donem: id.slice(0, separatorIndex).trim(),
    tur: id.slice(separatorIndex + YARDIM_KRITERI_DONEM_AYIRICI.length),
  }
}

export function buildYardimKriteriId(donem: string, tur: string): string {
  const trimmedDonem = donem.trim()
  return trimmedDonem ? `${trimmedDonem}${YARDIM_KRITERI_DONEM_AYIRICI}${tur}` : tur
}

// Kullanici istegi: Yardım Kriterleri panelinde, dönem bazinda serbest
// kriter satirlarinin YANI SIRA "Kişi Başı Ödenecek Miktar" adinda SABIT/
// OZEL bir alan da tanimlanabilsin - bu deger Nakit Yardımı müracaat
// formunda "Yardım Kişi Sayısı" ile CARPILARAK Miktar alanina otomatik
// yazilir (bkz. documents/page.tsx - cashAidCriteriaThresholds ve ilgili
// useEffect). Diger kriter turleri gibi AYNI "<Dönem>::<Kriter Türü>"
// kodlamasiyla, AYNI "yardimKriterleri" Hazır Değerler kategorisinde
// saklanir - yeni bir tablo/kolon GEREKMEZ, sadece bu SABIT tur adiyla bir
// satir eklenir/güncellenir (bkz. settings/page.tsx - YardimKriterleriTab).
export const YARDIM_KRITERI_KISI_BASI_MIKTAR_TUR = 'Kişi Başı Ödenecek Miktar'

// Kullanici istegi (2026-09-30): "kritere uymayan başvuruların açıklama
// kısmına yazılacak bilgiyi biz belirleyelim ... kriter oluştururken onun
// açıklamasınıda yanına ekleyebilelim" - her kriter SATIRI (ör. "Aylık
// Gelir" -> "15000") artik KENDI ozel aciklama metnini de tasiyabilir, AYNI
// satirda ("Kriter Adı | Limit | Açıklama" seklinde yan yana). Genel
// PredefinedValue {id, name} semasi DEGISTIRILMEDEN - id yine
// "<Dönem>::<Kriter Türü>" kodlamasini kullanir - `name` alani, aciklama
// GIRILMISSE JSON'a ({limit, aciklama}), GIRILMEMISSE ESKISI GIBI DUZ limit
// metnine (ör. "15000") sahip olur. Boylece:
//  - Aciklama yazilmadigi surece depolanan veri ESKISIYLE BIREBIR AYNI
//    kalir (geriye donuk uyumluluk - eski kayitlarin TAMAMI duz metindir).
//  - parseKriterRowValue TUM eski/yeni kayitlari sorunsuz okur (JSON degilse
//    tum metni limit sayar, aciklama bos doner).
export function parseKriterRowValue(raw: string | null | undefined): { limit: string; aciklama: string } {
  const text = raw ?? ''
  if (text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { limit?: unknown; aciklama?: unknown }
      if (parsed && typeof parsed === 'object') {
        return { limit: String(parsed.limit ?? ''), aciklama: String(parsed.aciklama ?? '') }
      }
    } catch {
      // JSON gibi baslayip parse edilemeyen (kullanicinin duz metin olarak
      // "{" ile basladigi) metinler duz limit metni sayilir - asagi duser.
    }
  }
  return { limit: text, aciklama: '' }
}

export function buildKriterRowValue(limit: string, aciklama: string): string {
  if (!aciklama.trim()) return limit
  return JSON.stringify({ limit, aciklama })
}

// Bir kriter turu icin, verilen dönem'e (ör. müracaatin kendi dönemi) ozel
// tanimlanmis bir deger varsa ONU, yoksa "Tüm Dönemler" (dönemsiz) genel
// degeri, o da yoksa null doner.
export function findYardimKriteriValue(
  list: Array<{ id: string; name: string }>,
  donem: string | null | undefined,
  turAdaylari: string[],
): string | null {
  const normalizedTurAdaylari = turAdaylari.map(normalizePredefinedText)
  const parsed = list.map((item) => ({ ...parseYardimKriteriId(item.id), value: item.name }))
  const matchesTur = (tur: string) => normalizedTurAdaylari.includes(normalizePredefinedText(tur))

  const normalizedDonem = donem ? normalizePredefinedText(donem) : ''
  if (normalizedDonem) {
    const exact = parsed.find((p) => p.donem && normalizePredefinedText(p.donem) === normalizedDonem && matchesTur(p.tur))
    if (exact) return exact.value
  }

  const fallback = parsed.find((p) => !p.donem && matchesTur(p.tur))
  return fallback ? fallback.value : null
}
