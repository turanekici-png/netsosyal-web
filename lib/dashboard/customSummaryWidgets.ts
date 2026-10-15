// 2026-10-15 kullanici istegi: "kullanıcı eğer isterse ana sayfaya yeni özet
// rapor ekleyebilsin". Her kullanici kendi ana sayfasina, Özel Rapor'un izinli
// kaynaklarindan (CUSTOM_REPORT_SOURCES) secip bir alana gore gruplanmis
// sayim/toplam kutusu ekler. Tanimlar kullaniciya ozel app_settings
// anahtarinda (dashboard_custom_widgets_<kullaniciId>) saklanir.
//
// GUVENLIK: tablo adi yalniz CUSTOM_REPORT_SOURCES'tan, sutun adlari yalniz
// o tablonun information_schema'daki gercek sutunlarindan secilebilir; filtre
// degerleri SQL'e parametre ($n) olarak gider.

import { prisma } from '@/lib/db/prisma'
import { upsertSetting } from '@/lib/db/upsertSetting'
import { CUSTOM_REPORT_SOURCES, type CustomReportSource } from '@/lib/constants/customReportSources'
import { normalizePredefinedText } from '@/lib/constants/predefinedValues'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { ASSISTANCE_COLUMN_LABELS } from '@/lib/assistance/assistanceColumns'
import { normalizedColumn, normalizeSearchTerm } from '@/lib/documents/documentsListQuery'

export type CustomWidgetFilter = { field: string; op: string; value?: string }

export type CustomSummaryWidget = {
  id: string
  title: string
  sourceId: string
  groupBy: string | null
  dateGrouping?: 'month' | 'year'
  aggregate: 'count' | 'sum'
  sumField?: string | null
  filter?: CustomWidgetFilter | null
  display: 'bars' | 'number'
  limit: number
}

export type CustomWidgetItem = { value: string | null; label: string; total: number; drillPath: string }
export type CustomWidgetResult = { items: CustomWidgetItem[]; total: number; otherTotal: number; reportPath: string }
export type ColumnMeta = { name: string; label: string; type: 'number' | 'date' | 'text' }

export const MAX_CUSTOM_WIDGETS = 12
const FILTER_OPS = new Set(['eq', 'neq', 'contains', 'empty', 'not_empty', 'gte', 'lte'])

const settingKey = (userId: string) => `dashboard_custom_widgets_${userId}`

// Dosyalar/Bireyler/online basvuru ham sutun adlari (yardim tablolari icin
// ASSISTANCE_COLUMN_LABELS kullanilir).
const RAW_LABELS: Record<string, string> = {
  dosyano: 'Dosya No', mahalleadi: 'Mahalle', mahalleid: 'Mahalle Kodu', cadde: 'Cadde', sokak: 'Sokak',
  site: 'Site', blok: 'Blok', binano: 'Bina No', daireno: 'Daire No', adresno: 'Adres No', telefon: 'Telefon',
  aileniteligi: 'Aile Niteliği', konutturu: 'Konut Türü', isinmaturu: 'Isınma Türü', mulkiyetdurumu: 'Mülkiyet Durumu',
  kiramiktari: 'Kira Miktarı', yaronceliksirasi: 'Yardım Öncelik Sırası', vizetarihi: 'Vize Tarihi', kartno: 'Kart No',
  topbirey: 'Toplam Birey', inceleme_puani: 'İnceleme Puanı', toplamgelir: 'Toplam Gelir', konutdurumu: 'Konut Durumu',
  yakinligi: 'Yakınlığı', uyrugu: 'Uyruğu', adi: 'Adı', soyadi: 'Soyadı', meslegi: 'Mesleği', ogrenimdurumu: 'Öğrenim Durumu',
  sosyalguvencesi: 'Sosyal Güvencesi', aylikgeliri: 'Aylık Geliri', tipi: 'Kayıt Tipi', nfili: 'Nüfus İli', nfilce: 'Nüfus İlçesi',
  nfmahkoy: 'Nüfus Mahalle/Köy', olumtarihi: 'Ölüm Tarihi', created_at: 'Oluşturma Tarihi', yardim_turu: 'Yardım Türü',
  status: 'Durum', ad: 'Ad', soyad: 'Soyad', muracaattarihi: 'Müracaat Tarihi',
}

export function columnLabel(column: string) {
  return ASSISTANCE_COLUMN_LABELS[column] || RAW_LABELS[column] || column.replaceAll('_', ' ').replace(/^./, (c) => c.toLocaleUpperCase('tr-TR'))
}

export function getSource(sourceId: string): CustomReportSource | null {
  return CUSTOM_REPORT_SOURCES.find((source) => source.id === sourceId) ?? null
}

export async function getSourceColumns(source: CustomReportSource): Promise<ColumnMeta[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    source.tableName,
  )
  return rows
    .filter((row) => /^[a-zA-Z0-9_]+$/.test(row.column_name))
    .map((row) => {
      const t = row.data_type.toLowerCase()
      const type: ColumnMeta['type'] = /int|numeric|double|real|decimal/.test(t)
        ? 'number'
        : /date|timestamp/.test(t) ? 'date' : 'text'
      return { name: row.column_name, label: columnLabel(row.column_name), type }
    })
}

// --- Kod -> ad (Hazır Değerler). Yalniz ACIKCA bilinen sutunlar cevrilir;
// tahmin yapilmaz (kural: kodlu alan karsiliklari Hazır Değerler'den).
const DGN_TABLES = new Set(['yrd_ddgidadosyali', 'yrd_giyim', 'yrd_ayninakti'])
type ListRef = { key?: string; titleIncludes?: string[] }
function listRefFor(table: string, column: string): ListRef | null {
  if (column === 'durumu') {
    if (table === 'dosyalar') return { key: 'fileStatus' }
    if (DGN_TABLES.has(table)) return { titleIncludes: ['dgn'] }
    if (table.startsWith('yrd_')) return { key: 'assistanceStatus' }
    return null
  }
  const byColumn: Record<string, ListRef> = {
    aileniteligi: { key: 'familyType' },
    mulkiyetdurumu: { titleIncludes: ['mulkiyet'] },
    yaronceliksirasi: { titleIncludes: ['oncelik'] },
    konutturu: { titleIncludes: ['konuttur', 'konuttip'] },
    isinmaturu: { titleIncludes: ['isinma'] },
    yakinligi: { key: 'relationship' },
    medenihali: { key: 'maritalStatus' },
    cinsiyeti: { key: 'gender' },
    saglikdurumu: { key: 'healthStatus' },
    ogrenimdurumu: { titleIncludes: ['ogrenim', 'egitim'] },
    sosyalguvencesi: { titleIncludes: ['guvence'] },
  }
  return byColumn[column] ?? null
}

async function valueLabelMap(table: string, column: string): Promise<Record<string, string>> {
  const ref = listRefFor(table, column)
  if (!ref) return {}
  const { values, titles } = await predefinedValuesService.getAll()
  let key = ref.key
  if (!key && ref.titleIncludes) {
    key = Object.entries(titles ?? {}).find(([, title]) => ref.titleIncludes!.some((part) => normalizePredefinedText(String(title)).includes(part)))?.[0]
  }
  const list = key ? ((values as Record<string, Array<{ id?: unknown; name?: unknown }>>)[key] ?? []) : []
  const map: Record<string, string> = {}
  for (const item of list) {
    const id = String(item?.id ?? '').trim()
    const name = String(item?.name ?? '').trim()
    if (id && name) map[id] = name
  }
  return map
}

// --- Tanimlarin dogrulanmasi/temizlenmesi
export async function sanitizeWidget(input: Partial<CustomSummaryWidget>): Promise<{ widget?: CustomSummaryWidget; error?: string }> {
  const source = getSource(String(input.sourceId ?? ''))
  if (!source) return { error: 'Geçerli bir veri kaynağı seçin.' }
  const columns = await getSourceColumns(source)
  const byName = new Map(columns.map((column) => [column.name, column]))
  const title = String(input.title ?? '').trim().slice(0, 80)
  if (!title) return { error: 'Rapor başlığı boş bırakılamaz.' }
  const display = input.display === 'number' ? 'number' : 'bars'
  const groupBy = display === 'bars' && input.groupBy && byName.has(input.groupBy) ? input.groupBy : null
  if (display === 'bars' && !groupBy) return { error: 'Çubuk liste için bir gruplama alanı seçin.' }
  const aggregate = input.aggregate === 'sum' ? 'sum' : 'count'
  const sumField = aggregate === 'sum' && input.sumField && byName.get(input.sumField)?.type === 'number' ? input.sumField : null
  if (aggregate === 'sum' && !sumField) return { error: 'Toplam için sayısal bir alan seçin.' }
  let filter: CustomWidgetFilter | null = null
  if (input.filter?.field && byName.has(input.filter.field) && FILTER_OPS.has(String(input.filter.op))) {
    const value = String(input.filter.value ?? '').trim().slice(0, 200)
    const valueless = input.filter.op === 'empty' || input.filter.op === 'not_empty'
    if (valueless || value) filter = { field: input.filter.field, op: String(input.filter.op), value: valueless ? '' : value }
  }
  const groupColumn = groupBy ? byName.get(groupBy) : undefined
  const widget: CustomSummaryWidget = {
    id: /^custom-[a-z0-9-]{4,40}$/.test(String(input.id ?? '')) ? String(input.id) : `custom-${Date.now().toString(36)}`,
    title,
    sourceId: source.id,
    groupBy,
    dateGrouping: groupColumn?.type === 'date' ? (input.dateGrouping === 'year' ? 'year' : 'month') : undefined,
    aggregate,
    sumField,
    filter,
    display,
    limit: [5, 10, 15, 20].includes(Number(input.limit)) ? Number(input.limit) : 10,
  }
  return { widget }
}

// --- Özel Rapor'a (drill-down) gecis baglantisi
function reportPath(widget: CustomSummaryWidget, groupCondition?: { op: string; value?: string; value2?: string }) {
  const params = new URLSearchParams({ source: widget.sourceId })
  let index = 0
  if (widget.filter) {
    params.set(`c${index}_field`, widget.filter.field)
    params.set(`c${index}_op`, widget.filter.op)
    if (widget.filter.value) params.set(`c${index}_value`, widget.filter.value)
    index += 1
  }
  if (widget.groupBy && groupCondition) {
    params.set(`c${index}_field`, widget.groupBy)
    params.set(`c${index}_op`, groupCondition.op)
    if (groupCondition.value) params.set(`c${index}_value`, groupCondition.value)
    if (groupCondition.value2) params.set(`c${index}_value2`, groupCondition.value2)
  }
  return `/reports/ozel?${params.toString()}`
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// --- Hesaplama
export async function computeWidget(widget: CustomSummaryWidget): Promise<CustomWidgetResult> {
  const source = getSource(widget.sourceId)
  if (!source) return { items: [], total: 0, otherTotal: 0, reportPath: '/reports/ozel' }
  const columns = await getSourceColumns(source)
  const byName = new Map(columns.map((column) => [column.name, column]))
  const q = (name: string) => `t."${name}"`
  const params: string[] = []
  const addParam = (value: string) => { params.push(value); return `$${params.length}` }

  const clauses: string[] = []
  const f = widget.filter
  if (f && byName.has(f.field)) {
    const col = q(f.field)
    const value = f.value ?? ''
    if (f.op === 'empty') clauses.push(`(${col} IS NULL OR NULLIF(BTRIM(${col}::text), '') IS NULL)`)
    else if (f.op === 'not_empty') clauses.push(`(${col} IS NOT NULL AND NULLIF(BTRIM(${col}::text), '') IS NOT NULL)`)
    else if (f.op === 'eq') clauses.push(`${normalizedColumn(col)} = ${addParam(normalizeSearchTerm(value))}`)
    else if (f.op === 'neq') clauses.push(`${normalizedColumn(col)} <> ${addParam(normalizeSearchTerm(value))}`)
    else if (f.op === 'contains') clauses.push(`${normalizedColumn(col)} LIKE ${addParam(`%${normalizeSearchTerm(value)}%`)}`)
    else if (f.op === 'gte' || f.op === 'lte') {
      const type = byName.get(f.field)?.type
      const cast = type === 'number' ? '::numeric' : type === 'date' ? '::date' : ''
      const left = type === 'date' ? `${col}::date` : type === 'number' ? col : `${col}::text`
      clauses.push(`${left} ${f.op === 'gte' ? '>=' : '<='} ${addParam(value)}${cast}`)
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const measure = widget.aggregate === 'sum' && widget.sumField && byName.get(widget.sumField)?.type === 'number'
    ? `COALESCE(SUM(${q(widget.sumField)}), 0)::float8`
    : 'COUNT(*)::float8'

  const base = { reportPath: reportPath(widget) }

  if (widget.display === 'number' || !widget.groupBy || !byName.has(widget.groupBy)) {
    const rows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(`SELECT ${measure} AS total FROM ${source.tableName} t ${where}`, ...params)
    return { items: [], total: Number(rows[0]?.total ?? 0), otherTotal: 0, ...base }
  }

  const groupColumn = byName.get(widget.groupBy)!
  const groupExpr = groupColumn.type === 'date'
    ? `to_char(${q(widget.groupBy)}, '${widget.dateGrouping === 'year' ? 'YYYY' : 'YYYY-MM'}')`
    : `NULLIF(BTRIM(${q(widget.groupBy)}::text), '')`
  const rows = await prisma.$queryRawUnsafe<Array<{ value: string | null; total: number }>>(
    `SELECT ${groupExpr} AS value, ${measure} AS total FROM ${source.tableName} t ${where}
     GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 500`,
    ...params,
  )
  const labels = await valueLabelMap(source.tableName, widget.groupBy)
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0)
  const shown = rows.slice(0, widget.limit)
  const otherTotal = rows.slice(widget.limit).reduce((sum, row) => sum + Number(row.total || 0), 0)

  const items: CustomWidgetItem[] = shown.map((row) => {
    const raw = row.value
    let condition: { op: string; value?: string; value2?: string }
    if (raw === null) condition = { op: 'empty' }
    else if (groupColumn.type === 'date') {
      const [y, m] = raw.split('-').map(Number)
      condition = widget.dateGrouping === 'year'
        ? { op: 'between', value: `${y}-01-01`, value2: `${y}-12-31 23:59:59` }
        : { op: 'between', value: `${raw}-01`, value2: `${raw}-${String(lastDayOfMonth(y, m)).padStart(2, '0')} 23:59:59` }
    } else condition = { op: 'eq', value: raw }
    const label = raw === null ? 'Belirtilmemiş' : labels[raw] ?? raw
    return { value: raw, label, total: Number(row.total || 0), drillPath: reportPath(widget, condition) }
  })
  return { items, total, otherTotal, ...base }
}

// --- Saklama (kullaniciya ozel)
export async function loadUserWidgets(userId: string): Promise<CustomSummaryWidget[]> {
  const setting = await prisma.setting.findUnique({ where: { key: settingKey(userId) } })
  const list = (setting?.value as { widgets?: CustomSummaryWidget[] } | null)?.widgets
  return Array.isArray(list) ? list : []
}

export async function saveUserWidgets(userId: string, widgets: CustomSummaryWidget[]) {
  await upsertSetting(settingKey(userId), { widgets: widgets.slice(0, MAX_CUSTOM_WIDGETS) })
}
