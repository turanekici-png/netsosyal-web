// "Bireyler" listesinin (app/api/beneficiary/route.ts) ve onun "sütun
// filtresi degerleri" ucunun (app/api/beneficiary/filter-options/route.ts)
// PAYLASTIGI sorgu-olusturma mantigi - bkz. lib/documents/documentsListQuery.ts
// (ayni desen, Dosyalar listesi icin).
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'

const genderLabelSql = `
  CASE
    WHEN UPPER(BTRIM(COALESCE(b.cinsiyeti, ''))) = 'E' THEN 'Erkek'
    WHEN UPPER(BTRIM(COALESCE(b.cinsiyeti, ''))) = 'K' THEN 'Kadın'
    ELSE NULLIF(BTRIM(COALESCE(b.cinsiyeti, '')), '')
  END
`

export const beneficiaryGenderLabelSql = genderLabelSql

export const beneficiaryFilterColumns: Record<string, string> = {
  id: 'b.id',
  dosyaId: 'b.dosyaid',
  dosyaNo: 'd.dosyano',
  dosyaDurumu: 'd.durumu',
  incelemePuani: 'd.inceleme_puani',
  tc: 'b.tckimlikno',
  adSoyad: "COALESCE(NULLIF(BTRIM(b.adisoyadi), ''), NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(b.adi), ''), NULLIF(BTRIM(b.soyadi), ''))), ''))",
  adi: 'b.adi',
  soyadi: 'b.soyadi',
  telefon: 'b.ceptel',
  ilce: 'b.nfilce',
  mahalle: 'b.nfmahkoy',
  yakinligi: 'b.yakinligi',
  cinsiyet: genderLabelSql,
  babaAdi: 'b.babaadi',
  anaAdi: 'b.anaadi',
  dogumTarihi: 'b.dogumtarihi',
  olumTarihi: 'b.olumtarihi',
  medeniHali: 'b.medenihali',
  adresNo: 'b.adresno',
  adres: 'b.adres',
  kayitTarihi: 'b.ilkislemtarihi',
  guncellemeTarihi: 'b.islemtarihi',
}

// Kullanici istegi: basliga Shift+tiklayarak BIRDEN FAZLA sutuna gore
// siralanabilsin - "sort" parametresi artik "anahtar:yon,anahtar2:yon2"
// bicimindeki COKLU siralama tanimini tasir (bkz. lib/sortSpec.ts). Tek
// sutunlu eski davranis (sortKey/sortDirection) bunun ozel/tek-elemanli hali.
const beneficiaryOrderByColumns: Record<string, string> = {
  ...beneficiaryFilterColumns,
  dosyaNo: "CASE WHEN BTRIM(d.dosyano) ~ '^[0-9]+$' THEN BTRIM(d.dosyano)::numeric END",
}

export function buildBeneficiaryOrderBy(sortParam: string | null) {
  const specs = parseSortParam(sortParam)
  if (specs.length === 0) return 'b.id ASC'

  const tiebreaker = `b.id ${specs[0].direction.toUpperCase()}`
  return buildMultiColumnOrderBy(specs, beneficiaryOrderByColumns, tiebreaker)
}

export type WhereBuilder = {
  clauses: string[]
  values: string[]
}

const TURKISH_TRANSLATE_FROM = 'İIıĞÜŞÖÇğüşıöç'
const TURKISH_TRANSLATE_TO = 'iiiGUSOCgusioc'

export function addParam(builder: WhereBuilder, value: string) {
  builder.values.push(value)
  return `$${builder.values.length}`
}

export function normalizeSearchTerm(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİI]/g, 'i')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
}

export function normalizedColumn(column: string) {
  return `lower(translate(COALESCE((${column})::text, ''), '${TURKISH_TRANSLATE_FROM}', '${TURKISH_TRANSLATE_TO}'))`
}

function containsCondition(builder: WhereBuilder, column: string, value: string) {
  return `${normalizedColumn(column)} ILIKE ${addParam(builder, `%${normalizeSearchTerm(value)}%`)}`
}

export function buildBeneficiaryFilterCondition(builder: WhereBuilder, column: string, value: string, operator: string, value2?: string) {
  const cleanValue = value.trim()
  const cleanValue2 = value2?.trim()

  if (operator === 'empty') return `((${column}) IS NULL OR NULLIF(BTRIM((${column})::text), '') IS NULL)`
  if (operator === 'not_empty') return `((${column}) IS NOT NULL AND NULLIF(BTRIM((${column})::text), '') IS NOT NULL)`
  if (!cleanValue) return null

  switch (operator) {
    case 'not_contains':
      return `${normalizedColumn(column)} NOT ILIKE ${addParam(builder, `%${normalizeSearchTerm(cleanValue)}%`)}`
    case 'eq':
      return `${normalizedColumn(column)} = ${addParam(builder, normalizeSearchTerm(cleanValue))}`
    case 'neq':
      return `${normalizedColumn(column)} != ${addParam(builder, normalizeSearchTerm(cleanValue))}`
    case 'starts':
      return `${normalizedColumn(column)} ILIKE ${addParam(builder, `${normalizeSearchTerm(cleanValue)}%`)}`
    case 'ends':
      return `${normalizedColumn(column)} ILIKE ${addParam(builder, `%${normalizeSearchTerm(cleanValue)}`)}`
    case 'gt':
      return `COALESCE((${column})::text, '') > ${addParam(builder, cleanValue)}`
    case 'lt':
      return `COALESCE((${column})::text, '') < ${addParam(builder, cleanValue)}`
    case 'gte':
      return `COALESCE((${column})::text, '') >= ${addParam(builder, cleanValue)}`
    case 'lte':
      return `COALESCE((${column})::text, '') <= ${addParam(builder, cleanValue)}`
    case 'between':
      if (!cleanValue2) return containsCondition(builder, column, cleanValue)
      return `COALESCE((${column})::text, '') BETWEEN ${addParam(builder, cleanValue)} AND ${addParam(builder, cleanValue2)}`
    case 'contains':
    default:
      return containsCondition(builder, column, cleanValue)
  }
}

// `excludeColumnKey` verilirse o sutunun KENDI f_* filtresi WHERE'e dahil
// edilmez - bkz. documentsListQuery.ts'deki ayni parametrenin aciklamasi.
export function buildBeneficiaryConditions(searchParams: URLSearchParams, search: string, excludeColumnKey?: string): WhereBuilder {
  const builder: WhereBuilder = { clauses: [], values: [] }

  if (search) {
    const normalizedSearchParam = addParam(builder, `%${normalizeSearchTerm(search)}%`)
    const numericSearch = search.replace(/\D/g, '')
    const phoneSearchParam = numericSearch ? addParam(builder, `%${numericSearch}%`) : normalizedSearchParam
    builder.clauses.push(`(
      ${normalizedColumn('b.tckimlikno')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn(beneficiaryFilterColumns.adSoyad)} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('b.adi')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('b.soyadi')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('b.ceptel')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('b.nfilce')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('b.nfmahkoy')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('b.adres')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.dosyano')} ILIKE ${normalizedSearchParam}
      OR regexp_replace(COALESCE(b.ceptel, ''), '[^0-9]', '', 'g') ILIKE ${phoneSearchParam}
    )`)
  }

  const filterKeys = new Set<string>()
  searchParams.forEach((_value, key) => {
    if (!key.startsWith('f_')) return
    filterKeys.add(key.replace('f_', '').replace('_op', '').replace('_v2', ''))
  })

  for (const columnKey of filterKeys) {
    if (columnKey === excludeColumnKey) continue
    const column = beneficiaryFilterColumns[columnKey]
    if (!column) continue

    const value = searchParams.get(`f_${columnKey}`) || ''
    const operator = searchParams.get(`f_${columnKey}_op`) || 'contains'
    const value2 = searchParams.get(`f_${columnKey}_v2`) || undefined
    const condition = buildBeneficiaryFilterCondition(builder, column, value, operator, value2)
    if (condition) builder.clauses.push(condition)
  }

  return builder
}

export function finalizeWhereClause(builder: WhereBuilder) {
  return {
    sql: builder.clauses.length > 0 ? `WHERE ${builder.clauses.join(' AND ')}` : '',
    values: builder.values,
  }
}

export function buildBeneficiaryWhereClause(searchParams: URLSearchParams, search: string, excludeColumnKey?: string) {
  return finalizeWhereClause(buildBeneficiaryConditions(searchParams, search, excludeColumnKey))
}

export const BENEFICIARY_FROM_CLAUSE = 'FROM bireyler b LEFT JOIN dosyalar d ON d.id = b.dosyaid'

// "Sütundaki değerler" acilir menusu icin filtrelenebilir kabul edilen
// serbest-metin sutunlar - bkz. documentsListQuery.ts'deki ayni notun
// aciklamasi (adres/babaAdi/anaAdi gibi cok-benzersiz-degerli sutunlar
// bilerek disarida birakildi).
export const BENEFICIARY_CHAINABLE_COLUMNS: Record<string, string> = {
  mahalle: 'b.nfmahkoy',
  ilce: 'b.nfilce',
}
