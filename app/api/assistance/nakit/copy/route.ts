import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type CopyMode = 'selected' | 'filtered'
type CopyPayload = {
  mode?: CopyMode
  ids?: Array<string | number>
  filters?: Record<string, string>
  sourceStatus?: number
  changes?: {
    donem?: string
    etiket?: string
    asama?: string
    durumu?: number
  }
}

const SEARCH_COLUMNS = ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano']
const REQUIRED_COLUMNS = ['donem', 'etiket', 'asama', 'durumu']

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function normalizeIds(ids: CopyPayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function cleanSourceStatus(value: unknown) {
  const status = Number(value)
  return status === 0 || status === 6 ? status : null
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'assistance.create', page: '/assistance/nakit' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as CopyPayload
  const mode: CopyMode = payload.mode === 'selected' ? 'selected' : 'filtered'
  const ids = normalizeIds(payload.ids)
  const sourceStatus = cleanSourceStatus(payload.sourceStatus)
  const donem = cleanText(payload.changes?.donem, 50)
  const etiket = cleanText(payload.changes?.etiket, 100)
  const asama = cleanText(payload.changes?.asama, 50)
  const durumu = Number(payload.changes?.durumu)

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Kopyalanacak kayit secilmedi.' }, { status: 400 })
  }

  if (sourceStatus === null) {
    return NextResponse.json({ success: false, error: 'Kaynak durum bilgisi gecersiz.' }, { status: 400 })
  }

  if (!donem || !etiket || !asama || !Number.isInteger(durumu)) {
    return NextResponse.json({ success: false, error: 'Donem, Etiket, Asama ve Durum alanlari zorunludur.' }, { status: 400 })
  }

  const pool = getSqlMonitorPool()

  try {
    const columnResult = await pool.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'yrd_ayninakti'
        ORDER BY ordinal_position
      `,
    )
    const columns = columnResult.rows.map((row) => row.column_name)
    const columnSet = new Set(columns)

    const missingColumn = REQUIRED_COLUMNS.find((column) => !columnSet.has(column))
    if (missingColumn) {
      return NextResponse.json(
        { success: false, error: `Kopyalama icin gerekli ${missingColumn} kolonu bulunamadi.` },
        { status: 400 },
      )
    }

    const insertColumns = columns.filter((column) => column !== 'id')
    const selectExpressions = insertColumns.map((column) => {
      if (column === 'donem') return '$1::varchar(50)'
      if (column === 'etiket') return '$2::varchar(100)'
      if (column === 'asama') return '$3::varchar(50)'
      if (column === 'durumu') return '$4::integer'
      return `t.${quoteIdentifier(column)}`
    })

    const params: Array<string | number | string[]> = [donem, etiket, asama, durumu, sourceStatus]
    let sourceCondition = 't.durumu = $5'

    let needsGulkartJoin = false
    if (mode === 'selected') {
      params.push(ids)
      sourceCondition += ` AND t.id = ANY($${params.length}::bigint[])`
    } else {
      const filters = payload.filters || {}
      const safeSearchTerm = prepareSqlSearchTerm(String(filters.search || '').trim())
      const filterCondition = buildFilterCondition(filters, 't')
      const searchCondition = safeSearchTerm
        ? ` AND (${SEARCH_COLUMNS.map((column) => `${column} ILIKE '%${safeSearchTerm}%'`).join(' OR ')})`
        : ''

      sourceCondition += `${filterCondition}${searchCondition}`
      // Hata duzeltmesi (2026-09-12): "missing FROM-clause entry for table
      // 'gk'" - bkz. bulk-update/route.ts'teki AYNI duzeltme notu. "Gülkart"
      // filtresi aktifken buildFilterCondition "gk.kartno" uretir ama bu
      // sorguda JOIN yoktu.
      needsGulkartJoin = /\bgk\./.test(filterCondition + searchCondition)
    }

    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        INSERT INTO public.yrd_ayninakti (${insertColumns.map(quoteIdentifier).join(', ')})
        SELECT ${selectExpressions.join(', ')}
        FROM public.yrd_ayninakti t
        LEFT JOIN public.dosyalar d ON t.dosyaid = d.id
        ${needsGulkartJoin ? `
        LEFT JOIN LATERAL (
          SELECT nk.kartno FROM public.nakitkart nk WHERE nk.tckimlikno = t.tckimlikno ORDER BY nk.id DESC LIMIT 1
        ) gk ON TRUE` : ''}
        WHERE ${sourceCondition}
        RETURNING id
      `,
      params,
    ), getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        copied: result.rowCount || 0,
        mode,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayitlar kopyalanamadi.' },
      { status: 500 },
    )
  }
}
