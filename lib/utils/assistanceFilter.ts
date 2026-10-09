// "Dosyalar" ve "Bireyler" listelerindeki "Gelişmiş Filtre" paneli için ortak
// yardımcı: "şu yardım türünü, şu tarihler arasında, şu tutarın üzerinde/
// altında almış dosyaları bul" sorgusu. Her yardım türü kendi tablosunda
// tutulduğu (yrd_ekmek, yrd_giyim, yrd_ayninakti, ...) için bu, seçilen türe
// göre tek bir EXISTS alt sorgusu üretir - dosyalar/bireyler listesinin ana
// sorgusuna WHERE kolu olarak eklenir.
//
// Kapsam bilerek "asama/başvuru" tablolarıyla (aynı temel tablo, ayrı
// hareket/hrk kayıtları değil) sınırlı tutuldu - bir dosyanın o yardım türünü
// aldığını/başvurduğunu göstermek için yeterli; "hangi ödeme hareketi" gibi
// daha ayrıntılı bir sorgu değil.
export const ASSISTANCE_FILTER_TYPES = [
  { value: 'ekmek', label: 'Ekmek', table: 'yrd_ekmek', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'gida_bankasi', label: 'Gıda Bankası', table: 'yrd_gidabankasi', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'destek_paketi', label: 'Destek Paketi', table: 'yrd_destekpaketi', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'giyim', label: 'Giyim', table: 'yrd_giyim', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'ayni_nakdi', label: 'Ayni/Nakdi', table: 'yrd_ayninakti', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'donem_disi_gida', label: 'Dönem Dışı Gıda', table: 'yrd_ddgidadosyali', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'hazir_yemek', label: 'Hazır Yemek', table: 'yrd_haziryemek', dateColumn: 'muracaattarihi', amountColumn: 'miktar' },
  { value: 'aceze', label: 'Aceze', table: 'yrd_aceze', dateColumn: 'tarih', amountColumn: 'tutar' },
  // NOT: yrd_kurban tablosunda dosyaid sutunu YOK (dosya bazli bir kayit
  // degil, genel bir dagitim/envanter kaydi) - bu yuzden bu listeye dahil
  // edilmedi; dosya/birey bazinda filtrelenemez.
] as const

export type AssistanceFilterTypeValue = (typeof ASSISTANCE_FILTER_TYPES)[number]['value']

// "Herhangi bir yardım türünden almış" / "Hiçbir yardım türünden almamış"
// - tek bir tabloya bagli olmayan, TUM turleri birlikte degerlendiren iki
// ozel secim. "Dosyalar tablosunda tum yardim alanlar/almayanlar" gibi genel
// sorular icin (bkz. kullanici istegi) eklendi.
export const ASSISTANCE_FILTER_ANY = 'any'
export const ASSISTANCE_FILTER_NONE = 'none'

type WhereBuilder = {
  clauses: string[]
  values: string[]
}

export type AssistanceFilterParams = {
  type?: string | null
  amountMin?: string | null
  amountMax?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

// Ham query-string degerlerini (URLSearchParams) tek bir yerden okur - hem
// dosyalar hem bireyler API'sinde ayni parametre adlari kullanilsin diye.
export function readAssistanceFilterParams(searchParams: URLSearchParams): AssistanceFilterParams {
  return {
    type: searchParams.get('af_type'),
    amountMin: searchParams.get('af_amountMin'),
    amountMax: searchParams.get('af_amountMax'),
    dateFrom: searchParams.get('af_dateFrom'),
    dateTo: searchParams.get('af_dateTo'),
  }
}

// TUM turleri (dosyaid, tarih) ikilisine indirgeyen ortak UNION ALL govdesi -
// "herhangi bir yardim" / "hic yardim yok" sorgularinin temeli.
function buildAnyAssistanceUnion() {
  return ASSISTANCE_FILTER_TYPES
    .map((item) => `SELECT dosyaid, ${item.dateColumn} AS tarih FROM ${item.table}`)
    .join('\n      UNION ALL\n      ')
}

// `dosyaIdColumn` cagiran sorgunun kendi FROM'undaki dosya id ifadesidir
// (ör. 'd.id' ya da 'b.dosyaid') - sabit, kod icinde yazilan bir degerdir,
// kullanici girdisi degildir.
export function buildAssistanceExistsCondition(
  builder: WhereBuilder,
  dosyaIdColumn: string,
  params: AssistanceFilterParams,
): string | null {
  const addParam = (value: string) => {
    builder.values.push(value)
    return `$${builder.values.length}`
  }

  if (params.type === ASSISTANCE_FILTER_ANY || params.type === ASSISTANCE_FILTER_NONE) {
    const conditions: string[] = [`any_assist.dosyaid = ${dosyaIdColumn}`]

    const dateFrom = params.dateFrom?.trim()
    const dateTo = params.dateTo?.trim()
    if (dateFrom) conditions.push(`any_assist.tarih >= ${addParam(dateFrom)}::date`)
    if (dateTo) conditions.push(`any_assist.tarih <= ${addParam(dateTo)}::date`)

    const existsClause = `EXISTS (
      SELECT 1 FROM (
        ${buildAnyAssistanceUnion()}
      ) any_assist
      WHERE ${conditions.join(' AND ')}
    )`

    return params.type === ASSISTANCE_FILTER_NONE ? `NOT ${existsClause}` : existsClause
  }

  const config = ASSISTANCE_FILTER_TYPES.find((item) => item.value === params.type)
  if (!config) return null

  const conditions: string[] = [`t.dosyaid = ${dosyaIdColumn}`]

  const amountMin = params.amountMin?.trim()
  const amountMax = params.amountMax?.trim()
  if (config.amountColumn && amountMin) {
    conditions.push(`t.${config.amountColumn} >= ${addParam(amountMin)}::numeric`)
  }
  if (config.amountColumn && amountMax) {
    conditions.push(`t.${config.amountColumn} <= ${addParam(amountMax)}::numeric`)
  }

  const dateFrom = params.dateFrom?.trim()
  const dateTo = params.dateTo?.trim()
  if (dateFrom) {
    conditions.push(`t.${config.dateColumn} >= ${addParam(dateFrom)}::date`)
  }
  if (dateTo) {
    conditions.push(`t.${config.dateColumn} <= ${addParam(dateTo)}::date`)
  }

  return `EXISTS (SELECT 1 FROM ${config.table} t WHERE ${conditions.join(' AND ')})`
}
