import { Pool } from 'pg'
import { ModuleConfig, ModuleService } from './module.service'
import { createUtcTypeOverrides } from '@/lib/db/pgTypeParsers'

const globalForSqlMonitor = globalThis as unknown as {
  sqlMonitorPool?: Pool
}

export function getSqlMonitorPool(): Pool {
  if (!globalForSqlMonitor.sqlMonitorPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL tanimli degil.')

    globalForSqlMonitor.sqlMonitorPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // "timestamp without time zone" -> Prisma ile AYNI sekilde UTC olarak
      // okunsun (bkz. lib/db/pgTypeParsers.ts) - bu Pool'a OZEL, global
      // pg-types kaydina dayanmaz (o, uretim derlemesinde chunk'lar arasi
      // paylasilmiyordu).
      types: createUtcTypeOverrides(),
    } as any)
  }
  return globalForSqlMonitor.sqlMonitorPool
}

export interface SqlMonitorTable {
  tableName: string
  rowCount: number
  columnCount: number
}

export interface SqlMonitorColumn {
  columnName: string
  dataType: string
  isNullable: boolean
}

export interface SqlCommandResult {
  command: string
  rowCount: number | null
  rows: Record<string, unknown>[]
}

class SqlMonitorService extends ModuleService {
  constructor(config: ModuleConfig) {
    super(config)
  }

  private serializeData<T>(data: T): T {
    return JSON.parse(
      JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )
  }

  private quoteIdentifier(identifier: string) {
    return `"${identifier.replace(/"/g, '""')}"`
  }

  private async ensurePublicTable(tableName: string) {
      const pool = getSqlMonitorPool()
      const result = await pool.query<{ table_name: string }>(
        `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = $1
      LIMIT 1;
    `,
        [tableName]
      )

    if (result.rows.length === 0) {
      throw new Error('Tablo bulunamadı veya public şemasında değil.')
    }
  }

  async executeQuery(query: string) {
    try {
      const pool = getSqlMonitorPool()
      const result = await pool.query(query)
      return this.serializeData({
        command: result.command,
        rowCount: result.rowCount,
        rows: result.rows,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`SQL hatası: ${message}`)
    }
  }

  async getTables(): Promise<SqlMonitorTable[]> {
    try {
      const pool = getSqlMonitorPool()
      const tables = await pool.query<{ table_name: string; column_count: string }>(
        `
        SELECT
          t.table_name,
          COUNT(c.column_name)::bigint AS column_count
        FROM information_schema.tables t
        LEFT JOIN information_schema.columns c
          ON c.table_schema = t.table_schema
          AND c.table_name = t.table_name
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_name
        ORDER BY t.table_name;
      `
      )

      const tableStats = await Promise.all(
        tables.rows.map(async (table) => {
          const quotedTable = this.quoteIdentifier(table.table_name)
          const countResult = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::bigint AS count FROM public.${quotedTable};`
          )

          return {
            tableName: table.table_name,
            rowCount: Number(countResult.rows[0]?.count ?? 0),
            columnCount: Number(table.column_count),
          }
        })
      )

      return this.serializeData(tableStats)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Tabloları getirme hatası: ${message}`)
    }
  }

  async getTableColumns(tableName: string): Promise<SqlMonitorColumn[]> {
    await this.ensurePublicTable(tableName)
    const pool = getSqlMonitorPool()

    const columns = await pool.query<
      { column_name: string; data_type: string; is_nullable: string }
    >(
      `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `,
      [tableName]
    )

    return columns.rows.map((column) => ({
      columnName: column.column_name,
      dataType: column.data_type,
      isNullable: column.is_nullable === 'YES',
    }))
  }

  // Kullanici istegi (Eylul 2026): "SQL Monitor - basliklardan siralama +
  // sutun bazli filtre". "sort" (sutun adi), "dir" (asc/desc) ve "filters"
  // (sutun -> ILIKE degeri) ARTIK gercek sutun listesine gore DOGRULANIR
  // (SQL injection yok - sutun adlari whitelist, degerler parametreli).
  async getTableRows(
    tableName: string,
    options: { limit?: number; search?: string; sort?: string; dir?: string; filters?: Record<string, string> } | number = {},
    legacySearch = '',
  ) {
    await this.ensurePublicTable(tableName)
    const pool = getSqlMonitorPool()

    // Geriye donuk uyum: eski imza getTableRows(name, limit, search)
    const opts = typeof options === 'number' ? { limit: options, search: legacySearch } : options

    const safeLimit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500)
    const quotedTable = this.quoteIdentifier(tableName)
    const columns = await this.getTableColumns(tableName)
    const columnSet = new Set(columns.map((column) => column.columnName))

    const params: unknown[] = []
    const whereParts: string[] = []

    const searchText = (opts.search ?? '').trim()
    if (searchText) {
      params.push(`%${searchText}%`)
      const placeholder = `$${params.length}`
      whereParts.push(
        '(' + columns.map((column) => `t.${this.quoteIdentifier(column.columnName)}::text ILIKE ${placeholder}`).join(' OR ') + ')',
      )
    }

    if (opts.filters && typeof opts.filters === 'object') {
      for (const [column, rawValue] of Object.entries(opts.filters)) {
        const value = String(rawValue ?? '').trim()
        if (!value || !columnSet.has(column)) continue
        params.push(`%${value}%`)
        whereParts.push(`t.${this.quoteIdentifier(column)}::text ILIKE $${params.length}`)
      }
    }

    let orderBySql = ''
    if (opts.sort && columnSet.has(opts.sort)) {
      const direction = String(opts.dir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'
      orderBySql = `ORDER BY t.${this.quoteIdentifier(opts.sort)} ${direction} NULLS LAST`
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

    const rows = await pool.query(
      `SELECT t.ctid::text AS "__rowid", t.* FROM public.${quotedTable} AS t ${whereSql} ${orderBySql} LIMIT ${safeLimit};`,
      params,
    )

    return this.serializeData(rows.rows)
  }

  // Kullanici istegi: SQL Monitor'de tek satir duzenlemenin yaninda TOPLU
  // (coklu secili satir) alan guncelleme de yapilabilsin - bu yuzden eski
  // "tek rowId" imzasi, GERIYE DONUK ayni davranisi koruyan (tek elemanli
  // dizi = eski tek-satir duzenleme) bir "rowIds dizisi" imzasina genisletildi.
  // Guvenlik: butun degerler PARAMETRELI (SQL injection riski yok) - SQL
  // Komut Alani'nin aksine burada kullanicinin yazdigi deger DOGRUDAN sorguya
  // gömülmez.
  async updateTableRows(tableName: string, rowIds: string[], values: Record<string, unknown>) {
    await this.ensurePublicTable(tableName)
    const pool = getSqlMonitorPool()

    const uniqueRowIds = Array.from(new Set(rowIds.filter(Boolean)))
    if (uniqueRowIds.length === 0) {
      throw new Error('Güncellenecek kayıt seçilmedi.')
    }

    const columns = await this.getTableColumns(tableName)
    const columnByName = new Map(columns.map((column) => [column.columnName, column]))
    const updates = Object.entries(values)
      .map(([columnName, value]) => {
        const column = columnByName.get(columnName)

        if (!column) {
          return null
        }

        return {
          columnName,
          value: value === '' && column.isNullable ? null : value,
        }
      })
      .filter((update): update is { columnName: string; value: unknown } => update !== null)

    if (updates.length === 0) {
      throw new Error('Güncellenecek alan bulunamadı.')
    }

    const quotedTable = this.quoteIdentifier(tableName)
    const setClause = updates
      .map((update, index) => `${this.quoteIdentifier(update.columnName)} = $${index + 1}`)
      .join(', ')
    const params: unknown[] = updates.map((update) => update.value)
    params.push(uniqueRowIds)

    const result = await pool.query(
      `UPDATE public.${quotedTable}
       SET ${setClause}
       WHERE ctid = ANY($${params.length}::tid[])
       RETURNING ctid::text AS "__rowid", *;`,
      params
    )

    if (result.rows.length === 0) {
      throw new Error('Kayıt bulunamadı veya başka bir işlem tarafından taşındı.')
    }

    return this.serializeData(result.rows)
  }

  // Kullanici istegi: secili birden fazla satiri TEK ISLEMDE silebilme
  // ("toplu islem") - tek tek "Duzenle" acmadan, tablo listesinde
  // isaretlenen kayitlarin hepsi burada parametreli/guvenli sekilde silinir.
  async deleteTableRows(tableName: string, rowIds: string[]) {
    await this.ensurePublicTable(tableName)
    const pool = getSqlMonitorPool()

    const uniqueRowIds = Array.from(new Set(rowIds.filter(Boolean)))
    if (uniqueRowIds.length === 0) {
      throw new Error('Silinecek kayıt seçilmedi.')
    }

    const quotedTable = this.quoteIdentifier(tableName)
    const result = await pool.query(
      `DELETE FROM public.${quotedTable}
       WHERE ctid = ANY($1::tid[])
       RETURNING ctid::text AS "__rowid";`,
      [uniqueRowIds]
    )

    return { deletedCount: result.rowCount ?? 0 }
  }

  async getDatabaseInfo() {
    try {
      const pool = getSqlMonitorPool()
      const info = await pool.query<{ db_name: string; version: string; current_user: string }>(
        `
        SELECT current_database() AS db_name, version(), current_user;
      `
      )

      return this.serializeData(info.rows[0])
    } catch {
      return null
    }
  }
}

export const sqlMonitorService = new SqlMonitorService({
  name: 'SQL Monitör',
  path: '/sql-monitor',
  icon: 'database',
  description: 'PostgreSQL veritabanı monitörü',
})
