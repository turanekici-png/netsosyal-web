import { OzelRaporClient } from './OzelRaporClient'
import {
  CUSTOM_REPORT_SOURCES,
  getCustomReportSource,
  type JoinableSource,
} from '@/lib/constants/customReportSources'
import { sqlMonitorService } from '@/lib/services/sqlMonitor.service'
import { foldTurkish, prepareSqlSearchTerm, sqlFoldExpr } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type SearchParams = { page?: string; search?: string; source?: string; cols?: string; same?: string; joins?: string } & Record<string, string | undefined>
type Condition = { field: string; op: string; value: string; value2: string }
type FilterValueRow = { field: string; value: string; label: string; count: number }
type ColumnValueOption = { value: string; label: string; count: number }
export type ColumnMeta = { value: string; label: string; group: string }

const PAGE_SIZE = 100
const VALID_OPERATORS = new Set(['contains', 'eq', 'neq', 'empty', 'not_empty', 'starts', 'ends', 'gt', 'lt', 'gte', 'lte', 'between'])
const VALUELESS_OPERATORS = new Set(['empty', 'not_empty'])
const FULL_FILTER_OPTION_FIELDS = new Set(['donem', 'etiket', 'asama'])
const HIDDEN_REPORT_COLUMNS = new Set([
  'aciklama-old',
  'ilkislemtarihi',
  'ilkkayittarihi',
  'ilkkullaniciid',
  'isinmaturu',
  'kiramiktari',
  'konum_adres_hash',
  'konum_boylam',
  'konum_durumu',
  'konum_enlem',
  'konum_guven',
  'konum_hata',
  'konum_kaynagi',
  'konum_tarihi',
  'konutturu',
  'kullaniciid',
  'mahalleid',
  'mulkiyetdurumu',
])

function isSafeIdentifier(value: string) {
  return /^[a-zA-Z0-9_]+$/.test(value)
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function parseList(value: string | undefined, allowedColumns: Set<string>) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => allowedColumns.has(item))
}

function isVisibleReportColumn(column: string) {
  return !HIDDEN_REPORT_COLUMNS.has(column.toLocaleLowerCase('tr-TR'))
}

function parseConditions(params: SearchParams, allowedColumns: Set<string>) {
  const conditions: Condition[] = []

  for (let index = 0; index < 20; index += 1) {
    const field = params[`c${index}_field`] || ''
    if (!allowedColumns.has(field)) continue

    const op = VALID_OPERATORS.has(params[`c${index}_op`] || '')
      ? params[`c${index}_op`] as string
      : 'contains'
    const value = params[`c${index}_value`] || ''
    const value2 = params[`c${index}_value2`] || ''

    if (!VALUELESS_OPERATORS.has(op) && !value.trim()) continue
    conditions.push({ field, op, value, value2 })
  }

  return conditions
}

function buildConditionSql(conditions: Condition[], alias: string) {
  return conditions.map((condition) => {
    const columnSql = `${alias}.${quoteIdentifier(condition.field)}`
    const value = prepareSqlSearchTerm(condition.value.trim())
    const value2 = prepareSqlSearchTerm(condition.value2.trim())
    // Metin operatörleri Türkçe-duyarsız (büyük/küçük harf + aksan yok sayılır).
    const foldedCol = sqlFoldExpr(columnSql)
    const foldedValue = foldTurkish(condition.value.trim())

    switch (condition.op) {
      case 'empty':
        return ` AND (${columnSql} IS NULL OR NULLIF(TRIM(${columnSql}::text), '') IS NULL)`
      case 'not_empty':
        return ` AND (${columnSql} IS NOT NULL AND NULLIF(TRIM(${columnSql}::text), '') IS NOT NULL)`
      case 'eq':
        return ` AND ${foldedCol} = ${sqlString(foldedValue)}`
      case 'neq':
        return ` AND ${foldedCol} != ${sqlString(foldedValue)}`
      case 'starts':
        return ` AND ${foldedCol} LIKE ${sqlString(`${foldedValue}%`)}`
      case 'ends':
        return ` AND ${foldedCol} LIKE ${sqlString(`%${foldedValue}`)}`
      case 'gt':
        return ` AND ${columnSql} > ${sqlString(value)}`
      case 'lt':
        return ` AND ${columnSql} < ${sqlString(value)}`
      case 'gte':
        return ` AND ${columnSql} >= ${sqlString(value)}`
      case 'lte':
        return ` AND ${columnSql} <= ${sqlString(value)}`
      case 'between':
        if (!value2) return ''
        return ` AND ${columnSql} BETWEEN ${sqlString(value)} AND ${sqlString(value2)}`
      case 'contains':
      default:
        return ` AND ${foldedCol} LIKE ${sqlString(`%${foldedValue}%`)}`
    }
  }).join('')
}

function buildSearchSql(searchTerm: string, columns: string[], alias: string) {
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const foldedTerm = foldTurkish(searchTerm.trim())
  if (!foldedTerm || columns.length === 0) return ''

  return ` AND (${columns.map((column) => `${sqlFoldExpr(`${alias}.${quoteIdentifier(column)}`)} LIKE ${sqlString(`%${foldedTerm}%`)}`).join(' OR ')})`
}

function buildDuplicateSql(duplicateColumns: string[], baseCondition: string) {
  if (duplicateColumns.length === 0) return ''

  const sameConditions = duplicateColumns.map((column) => (
    `d.${quoteIdentifier(column)} IS NOT DISTINCT FROM t.${quoteIdentifier(column)}`
  )).join(' AND ')
  const nonEmptyConditions = duplicateColumns.map((column) => (
    ` AND t.${quoteIdentifier(column)} IS NOT NULL AND NULLIF(TRIM(t.${quoteIdentifier(column)}::text), '') IS NOT NULL`
  )).join('')
  const groupColumns = duplicateColumns.map((column) => `d.${quoteIdentifier(column)}`).join(', ')

  return `
    ${nonEmptyConditions}
    AND EXISTS (
      SELECT 1
      FROM report_source d
      WHERE 1=1 ${baseCondition.replaceAll('t.', 'd.')}
        AND ${sameConditions}
      GROUP BY ${groupColumns}
      HAVING COUNT(*) > 1
    )
  `
}

function mapFilterValueOptions(rows: FilterValueRow[]) {
  return rows.reduce((acc, row) => {
    if (!acc[row.field]) acc[row.field] = []

    acc[row.field].push({
      value: String(row.value),
      label: String(row.label),
      count: Number(row.count || 0),
    })

    return acc
  }, {} as Record<string, ColumnValueOption[]>)
}

// Bir join'in SQL alias'ı - kullanıcının seçtiği join id'siyle aynı, ama
// SQL kimliği olarak güvenli (isSafeIdentifier kontrolünden geçmiş) olmalı.
function joinAlias(join: JoinableSource) {
  return `__j_${join.id}`
}

async function resolveActiveJoins(source: ReturnType<typeof getCustomReportSource>, params: SearchParams) {
  const joinable = source.joinable || []
  const joinableById = new Map(joinable.map((join) => [join.id, join]))

  // "joins" parametresi URL'de hiç yoksa (ilk yükleme / eski kaydedilmiş
  // linkler), geriye dönük uyumluluk için sadece "dosya" join'i (varsa)
  // otomatik aktif kabul edilir - önceden adresno/inceleme_puani hep
  // otomatik geliyordu, bu davranış korunur. "birey" join'i her zaman
  // kullanıcının AÇIKÇA seçmesini gerektirir (yeni, opsiyonel bir özellik).
  const requestedIds = params.joins !== undefined
    ? params.joins.split(',').map((item) => item.trim()).filter(Boolean)
    : (joinableById.has('dosya') ? ['dosya'] : [])

  const activeJoins = requestedIds
    .map((id) => joinableById.get(id))
    .filter((join): join is JoinableSource => Boolean(join))

  const joinColumnsById: Record<string, string[]> = {}
  for (const join of activeJoins) {
    if (!isSafeIdentifier(join.tableName)) continue
    try {
      const tableColumns = await sqlMonitorService.getTableColumns(join.tableName)
      joinColumnsById[join.id] = tableColumns.map((column) => column.columnName).filter(isVisibleReportColumn)
    } catch {
      // Bu join'in kolonları alınamazsa sessizce atlanır, rapor geri kalanı etkilenmez.
      joinColumnsById[join.id] = []
    }
  }

  return { activeJoins, joinColumnsById }
}

export default async function OzelRaporPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const source = getCustomReportSource(params.source)
  const currentPage = Math.max(1, Number(params.page) || 1)
  const offset = (currentPage - 1) * PAGE_SIZE
  const searchTerm = params.search?.trim() || ''

  let columns: string[] = []
  let columnOptions: ColumnMeta[] = []
  let records: Record<string, unknown>[] = []
  let totalCount = 0
  let selectedColumns: string[] = []
  let duplicateColumns: string[] = []
  let conditions: Condition[] = []
  let errorMessage: string | null = null
  let filterValueOptions: Record<string, ColumnValueOption[]> = {}
  let activeJoinIds: string[] = []

  try {
    if (!isSafeIdentifier(source.tableName)) {
      throw new Error('Rapor kaynağı geçersiz.')
    }

    const tableColumns = await sqlMonitorService.getTableColumns(source.tableName)
    const baseColumns = tableColumns
      .map((column) => column.columnName)
      .filter(isVisibleReportColumn)

    const { activeJoins, joinColumnsById } = await resolveActiveJoins(source, params)
    activeJoinIds = activeJoins.map((join) => join.id)

    columns = [...baseColumns]
    columnOptions = baseColumns.map((column) => ({ value: column, label: column, group: source.label }))

    for (const join of activeJoins) {
      const joinCols = joinColumnsById[join.id] || []
      for (const column of joinCols) {
        const qualified = `${join.id}__${column}`
        columns.push(qualified)
        columnOptions.push({ value: qualified, label: column, group: join.label })
      }
    }

    const allowedColumns = new Set(columns)

    selectedColumns = parseList(params.cols, allowedColumns)
    if (selectedColumns.length === 0) {
      selectedColumns = (source.defaultColumns || []).filter((column) => allowedColumns.has(column))
    }
    // "dosya" join'i aktifse ve inceleme_puani sütunu isteniyorsa, geleneksel
    // olarak dosya no'dan hemen sonra gösterilir (eski davranışla aynı).
    const inceleme = activeJoinIds.includes('dosya') && allowedColumns.has('dosya__inceleme_puani') ? 'dosya__inceleme_puani' : null
    if (inceleme && !selectedColumns.includes(inceleme)) {
      const insertAfterIndex = selectedColumns.findIndex((column) => column === 'dosyano' || column === 'dosya__dosyano')
      selectedColumns = [
        ...selectedColumns.slice(0, insertAfterIndex >= 0 ? insertAfterIndex + 1 : 1),
        inceleme,
        ...selectedColumns.slice(insertAfterIndex >= 0 ? insertAfterIndex + 1 : 1),
      ]
    }
    if (selectedColumns.length === 0) selectedColumns = columns.slice(0, 12)

    duplicateColumns = parseList(params.same, allowedColumns)
    conditions = parseConditions(params, allowedColumns)

    const tableSql = quoteIdentifier(source.tableName)
    const joinSelectSql = activeJoins.map((join) => {
      const joinCols = joinColumnsById[join.id] || []
      const alias = joinAlias(join)
      return joinCols.map((column) => `, ${alias}.${quoteIdentifier(column)} AS ${quoteIdentifier(`${join.id}__${column}`)}`).join('')
    }).join('')

    const joinFromSql = activeJoins.map((join) => {
      if (!isSafeIdentifier(join.tableName)) return ''
      const alias = joinAlias(join)
      const joinTableSql = quoteIdentifier(join.tableName)

      if (join.primaryOnly) {
        // Örn. "bireyler" - bir dosyaya ait BİRDEN FAZLA birey olabilir,
        // sadece "birincil" olanı (başvuru sahibi) getirilir.
        return `
          LEFT JOIN LATERAL (
            SELECT * FROM public.${joinTableSql} __lat
            WHERE __lat.${quoteIdentifier(join.joinedColumn)} = t.${quoteIdentifier(join.sourceColumn)}
            ORDER BY CASE WHEN __lat."yakinligi" = 0 OR __lat."tipi" = 0 THEN 0 ELSE 1 END, __lat."id" ASC
            LIMIT 1
          ) ${alias} ON TRUE
        `
      }

      return `LEFT JOIN public.${joinTableSql} ${alias} ON ${alias}.${quoteIdentifier(join.joinedColumn)} = t.${quoteIdentifier(join.sourceColumn)}`
    }).join('\n')

    const sourceSql = `
      WITH report_source AS (
        SELECT
          t.ctid::text AS "__rowid",
          t.*
          ${joinSelectSql}
        FROM public.${tableSql} t
        ${joinFromSql}
      )
    `
    const baseCondition = `${buildConditionSql(conditions, 't')} ${buildSearchSql(searchTerm, columns, 't')}`
    const duplicateCondition = buildDuplicateSql(duplicateColumns, baseCondition)
    const whereClause = `1=1 ${baseCondition} ${duplicateCondition}`
    const selectSql = selectedColumns.map((column) => `t.${quoteIdentifier(column)}`).join(', ')
    const orderSql = allowedColumns.has('id') ? 't."id" DESC' : 't."__rowid" DESC'

    const countResult = await sqlMonitorService.executeQuery(`
      ${sourceSql}
      SELECT COUNT(*)::int AS total
      FROM report_source t
      WHERE ${whereClause}
    `)
    totalCount = Number(countResult.rows[0]?.total || 0)

    const dataResult = await sqlMonitorService.executeQuery(`
      ${sourceSql}
      SELECT t."__rowid", ${selectSql}
      FROM report_source t
      WHERE ${whereClause}
      ORDER BY ${orderSql}
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `)
    records = dataResult.rows

    const filterOptionSelectParts = selectedColumns.filter((column) => FULL_FILTER_OPTION_FIELDS.has(column)).map((column) => `
      SELECT ${sqlString(column)}::text AS field,
             NULLIF(t.${quoteIdentifier(column)}::text, '') AS value,
             NULLIF(t.${quoteIdentifier(column)}::text, '') AS label
      FROM report_source t
      WHERE ${whereClause}
    `)

    if (filterOptionSelectParts.length > 0) {
      const filterOptionsResult = await sqlMonitorService.executeQuery(`
        ${sourceSql}
        SELECT field, value, label, COUNT(*)::int AS count
        FROM (
          ${filterOptionSelectParts.join('\nUNION ALL\n')}
        ) options
        WHERE value IS NOT NULL
          AND value <> ''
        GROUP BY field, value, label
        ORDER BY field, label;
      `)
      filterValueOptions = mapFilterValueOptions(filterOptionsResult.rows as FilterValueRow[])
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  return (
    <OzelRaporClient
      sources={CUSTOM_REPORT_SOURCES}
      selectedSourceId={source.id}
      columns={columns}
      columnOptions={columnOptions}
      activeJoinIds={activeJoinIds}
      data={errorMessage ? [] : records}
      filterValueOptions={filterValueOptions}
      totalCount={totalCount}
      currentPage={currentPage}
      pageSize={PAGE_SIZE}
      searchTerm={searchTerm}
      selectedColumns={selectedColumns}
      duplicateColumns={duplicateColumns}
      initialConditions={conditions}
      errorMessage={errorMessage}
    />
  )
}
