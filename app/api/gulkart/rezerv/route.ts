import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'
import { buildGulkartRezervWhereClause, quoteIdentifier } from '@/lib/gulkart/rezervFilters'

const TABLE_NAME = 'nakitkartrezerv'

type ImportRow = Record<string, unknown>

type DeletePayload = { ids?: Array<string | number> }

function normalizeIds(ids: DeletePayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

async function getTableColumns() {
  const pool = getSqlMonitorPool()
  const result = await pool.query<{
    column_name: string
    is_nullable: string
    column_default: string | null
    data_type: string
  }>(
    `
      SELECT column_name, is_nullable, column_default, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `,
    [TABLE_NAME],
  )

  if (result.rows.length === 0) {
    throw new Error(`${TABLE_NAME} tablosu bulunamadı.`)
  }

  return result.rows
}

export async function GET(request: NextRequest) {
  try {
    const columns = await getTableColumns()

    // Kullanici istegi: "1 ya da birden çok veya tüm kayıtları seçip
    // silebilelim" - "Tümünü Seç" (filtrelenen TÜM kayitlar, sadece o an
    // ekrandaki sayfa degil) icin, sayfada GORUNMEYEN diger sayfalardaki
    // kayitlarin id'lerine de ihtiyac var. Bu mod, sayfanin kendi SSR veri
    // sorgusuyla (bkz. app/(modules)/gulkart/rezerv/page.tsx) AYNI ortak
    // filtre fonksiyonunu (buildGulkartRezervWhereClause) kullanir, boylece
    // "Tümünü Seç" ekranda o an gorunen filtreyle HER ZAMAN tutarlidir.
    const { searchParams } = new URL(request.url)
    if (searchParams.get('idsOnly') === '1') {
      const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/gulkart/rezerv' })
      if (accessDenied) return accessDenied

      const params = Object.fromEntries(searchParams.entries())
      const searchTerm = searchParams.get('search')?.trim() || ''
      const columnNames = columns.map((column) => column.column_name)
      const whereClause = buildGulkartRezervWhereClause(params, columnNames, searchTerm)

      const pool = getSqlMonitorPool()
      const result = await pool.query<{ id: string }>(
        `
          SELECT t.id::text AS id
          FROM public.${quoteIdentifier(TABLE_NAME)} t
          WHERE 1=1 ${whereClause}
        `,
      )

      return NextResponse.json({ success: true, data: { ids: result.rows.map((row) => row.id) } })
    }

    return NextResponse.json({
      success: true,
      data: columns.map((column) => ({
        name: column.column_name,
        nullable: column.is_nullable === 'YES',
        dataType: column.data_type,
        generated: Boolean(column.column_default),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kolonlar alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/gulkart/rezerv' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as { rows?: ImportRow[] }
    const rows = Array.isArray(payload.rows) ? payload.rows : []

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Aktarılacak satır bulunamadı.' }, { status: 400 })
    }

    const columns = await getTableColumns()
    const columnByName = new Map(columns.map((column) => [column.column_name.toLocaleLowerCase('tr-TR'), column]))
    const insertableColumnNames = columns
      .filter((column) => !column.column_default?.toLowerCase().includes('nextval'))
      .map((column) => column.column_name)
    const insertableSet = new Set(insertableColumnNames.map((columnName) => columnName.toLocaleLowerCase('tr-TR')))

    const normalizedRows = rows.map((row) => {
      const normalized: ImportRow = {}
      Object.entries(row).forEach(([key, value]) => {
        const cleanKey = key.trim()
        const column = columnByName.get(cleanKey.toLocaleLowerCase('tr-TR'))
        if (!column || !insertableSet.has(column.column_name.toLocaleLowerCase('tr-TR'))) return

        normalized[column.column_name] = typeof value === 'string' && value.trim() === ''
          ? null
          : value
      })
      return normalized
    }).filter((row) => Object.keys(row).length > 0)

    if (normalizedRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dosyadaki başlıklar tablo kolonları ile eşleşmedi.' },
        { status: 400 },
      )
    }

    const pool = getSqlMonitorPool()
    let inserted = 0

    await withAuditedPoolWrite(pool, async (client) => {
      for (const row of normalizedRows) {
        const rowColumns = Object.keys(row)
        const values = rowColumns.map((columnName) => row[columnName])
        const columnSql = rowColumns.map(quoteIdentifier).join(', ')
        const paramSql = values.map((_value, index) => `$${index + 1}`).join(', ')

        await client.query(
          `INSERT INTO public.${quoteIdentifier(TABLE_NAME)} (${columnSql}) VALUES (${paramSql});`,
          values,
        )
        inserted += 1
      }
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        inserted,
        skipped: rows.length - normalizedRows.length,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Excel aktarımı yapılamadı.' },
      { status: 500 },
    )
  }
}

// Kullanici istegi: "burada da bir ya da birden fazla hatta tüm kayıtları
// seçip bunları silebilelim" - tek/coklu/"Tümünü Seç" ile secilen Gülkart
// Rezerv kayitlarini kalici olarak siler. Diger kalici silme uc
// noktalariyla (bkz. app/api/gulkart/liste/route.ts DELETE) AYNI guvenlik
// deseni: normal islem yetkisi + sifre ile "destructive authorization"
// (kisa omurlu, tek kullanimlik token) ikisi birden gerekir.
export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.gulkart', page: '/gulkart/rezerv' })
    if (accessDenied) return accessDenied

    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const payload = await request.json().catch(() => ({})) as DeletePayload
    const ids = normalizeIds(payload.ids)

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek Gülkart rezerv kaydı seçilmedi.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()
    const deleted = await withAuditedPoolWrite(pool, async (client) => {
      const result = await client.query(
        `DELETE FROM public.${quoteIdentifier(TABLE_NAME)} WHERE id = ANY($1::bigint[])`,
        [ids],
      )
      return result.rowCount || 0
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: { requested: ids.length, deleted } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gülkart rezerv kayıtları silinemedi.' },
      { status: 500 },
    )
  }
}
