// "Dosyalar" listesinin (app/api/documents/route.ts) ve onun "sütun
// filtresi degerleri" ucunun (app/api/documents/filter-options/route.ts)
// PAYLASTIGI sorgu-olusturma mantigi. Ikisi de AYNI arama/filtre semantigini
// kullanmali - aksi halde "Mahalle" acilir menusundeki degerler, gercek
// listeleme sonucuyla tutarsizlasir.
import { buildMultiColumnOrderBy, parseSortParam } from '@/lib/sortSpec'

export const documentsFilterColumns: Record<string, string> = {
  dosyaId: 'd.id',
  dosyaNo: 'd.dosyano',
  incelemePuani: 'd.inceleme_puani',
  dosyaSahibi: 'owner.adisoyadi',
  durum: 'd.durumu',
  kartNo: 'd.kartno',
  muracaatTarihi: 'd.muracaattarihi',
  telefon: 'd.telefon',
  mahalle: 'd.mahalleadi',
  cadde: 'd.cadde',
  sokak: 'd.sokak',
  binaNo: 'd.binano',
  daireNo: 'd.daireno',
  adresNo: 'd.adresno',
  adres: 'd.adres',
  toplamBirey: 'household.toplam',
  aciklama: 'd.aciklama',
  olusturmaTarihi: 'd.ilkislemtarihi',
  guncellemeTarihi: 'd.islemtarihi',
}

export const documentsSortColumns = documentsFilterColumns

// Kullanici istegi: basliga Shift+tiklayarak BIRDEN FAZLA sutuna gore
// siralanabilsin - "sort" parametresi artik "anahtar:yon,anahtar2:yon2"
// bicimindeki COKLU siralama tanimini tasir (bkz. lib/sortSpec.ts).
const documentsOrderByColumns: Record<string, string> = {
  ...documentsFilterColumns,
  dosyaNo: "CASE WHEN BTRIM(d.dosyano) ~ '^[0-9]+$' THEN BTRIM(d.dosyano)::numeric END",
}

export function buildDocumentsOrderBy(sortParam: string | null) {
  const specs = parseSortParam(sortParam)
  if (specs.length === 0) {
    return buildMultiColumnOrderBy([{ key: 'dosyaNo', direction: 'asc' }], documentsOrderByColumns, 'd.id ASC')
  }

  const tiebreaker = `d.id ${specs[0].direction.toUpperCase()}`
  return buildMultiColumnOrderBy(specs, documentsOrderByColumns, tiebreaker)
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

export function buildDocumentsFilterCondition(builder: WhereBuilder, column: string, value: string, operator: string, value2?: string) {
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

// `excludeColumnKey` verilirse, o sutunun KENDI f_* filtresi WHERE'e dahil
// edilmez - "sütundaki değerler" acilir menusu, kendi filtresine gore
// daralmamis (ama DIGER tum filtrelere gore daralmis) bir liste gostersin
// diye (klasik "faceted search" davranisi - digerlerini secince bu sutunun
// secenekleri daralir, ama bu sutunu secince kendi secenekleri kaybolmaz).
//
// Sonucu dogrudan "WHERE ..." string'i olarak DEGIL, henuz birlestirilmemis
// {clauses, values} builder'i olarak dondurur - cagiran taraf (ör.
// documents/route.ts) baska kosullar (ör. yardim turu filtresi) eklemek
// isterse once ekleyip SONRA finalizeWhereClause ile birlestirebilsin diye.
export function buildDocumentsConditions(searchParams: URLSearchParams, search: string, excludeColumnKey?: string): WhereBuilder {
  const builder: WhereBuilder = { clauses: [], values: [] }

  if (search) {
    const normalizedSearchParam = addParam(builder, `%${normalizeSearchTerm(search)}%`)
    const numericSearch = search.replace(/\D/g, '')
    const phoneSearchParam = numericSearch ? addParam(builder, `%${numericSearch}%`) : normalizedSearchParam
    // Hane halkindan SADECE "dosya sahibi" (owner LATERAL join'i) degil,
    // dosyadaki HERHANGI BIR bireyin adi/soyadi/TC'si de aranir - aksi
    // halde bir dosyayi, o dosyada kayitli ama "sahibi" sayilmayan bir
    // hane uyesinin adiyla/TC'siyle bulmak mumkun olmuyordu.
    builder.clauses.push(`(
      ${normalizedColumn('d.dosyano')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.kartno')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.telefon')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.mahalleadi')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.cadde')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.sokak')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.adres')} ILIKE ${normalizedSearchParam}
      OR ${normalizedColumn('d.aciklama')} ILIKE ${normalizedSearchParam}
      OR regexp_replace(COALESCE(d.telefon, ''), '[^0-9]', '', 'g') ILIKE ${phoneSearchParam}
      OR EXISTS (
        SELECT 1 FROM bireyler hb
        WHERE hb.dosyaid = d.id
          AND (
            ${normalizedColumn('hb.adisoyadi')} ILIKE ${normalizedSearchParam}
            OR ${normalizedColumn("CONCAT_WS(' ', hb.adi, hb.soyadi)")} ILIKE ${normalizedSearchParam}
            OR ${normalizedColumn('hb.tckimlikno')} ILIKE ${normalizedSearchParam}
          )
      )
    )`)
  }

  const filterKeys = new Set<string>()
  searchParams.forEach((_value, key) => {
    if (!key.startsWith('f_')) return
    filterKeys.add(key.replace('f_', '').replace('_op', '').replace('_v2', ''))
  })

  for (const columnKey of filterKeys) {
    if (columnKey === excludeColumnKey) continue
    const column = documentsFilterColumns[columnKey]
    if (!column) continue

    const value = searchParams.get(`f_${columnKey}`) || ''
    const operator = searchParams.get(`f_${columnKey}_op`) || 'contains'
    const value2 = searchParams.get(`f_${columnKey}_v2`) || undefined
    const condition = buildDocumentsFilterCondition(builder, column, value, operator, value2)
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

// Onceki API'yi koruyan kisayol: kosul eklemeye gerek olmayan tum
// cagiranlar (ör. filter-options ucu) icin dogrudan {sql, values} dondurur.
export function buildDocumentsWhereClause(searchParams: URLSearchParams, search: string, excludeColumnKey?: string) {
  return finalizeWhereClause(buildDocumentsConditions(searchParams, search, excludeColumnKey))
}

export function buildDocumentsFromClause(whereSql: string) {
  return `
    FROM dosyalar d
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          NULLIF(BTRIM(b.adisoyadi), ''),
          NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(b.adi), ''), NULLIF(BTRIM(b.soyadi), ''))), '')
        ) AS adisoyadi,
        -- Kullanici istegi: Dosyalar listesinde dosya sahibinin CEP telefonu
        -- da (dosyalar.telefon - genel/sabit hat olabilen alandan AYRI
        -- olarak) gorunsun - bkz. app/api/documents/route.ts "ceptel" sutunu.
        NULLIF(BTRIM(b.ceptel), '') AS ceptel
      FROM bireyler b
      WHERE b.dosyaid = d.id
        AND COALESCE(
          NULLIF(BTRIM(b.adisoyadi), ''),
          NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(b.adi), ''), NULLIF(BTRIM(b.soyadi), ''))), '')
        ) IS NOT NULL
      ORDER BY
        CASE
          WHEN b.tipi = 1 THEN 0
          WHEN b.yakinligi = 0 THEN 1
          ELSE 2
        END,
        b.id ASC
      LIMIT 1
    ) owner ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS toplam
      FROM bireyler household_member
      WHERE household_member.dosyaid = d.id
    ) household ON TRUE
    ${whereSql}
  `
}

// "Sütundaki değerler" acilir menusu icin filtrelenebilir kabul edilen
// sutunlar - serbest metin (adres, aciklama gibi) sutunlar bilerek disarida
// birakildi, cunku binlerce benzersiz deger uretip acilir menuyu
// kullanilmaz hale getirirler. Durum (durumu) burada YOK - o sabit/onceden
// tanimli bir liste oldugu icin frontend'de (AdvancedTable) zaten dogrudan
// tam listeden besleniyor, sunucudan ayrica sorgulanmasina gerek yok.
export const DOCUMENTS_CHAINABLE_COLUMNS: Record<string, string> = {
  mahalle: 'd.mahalleadi',
  cadde: 'd.cadde',
  sokak: 'd.sokak',
  binaNo: 'd.binano',
}
