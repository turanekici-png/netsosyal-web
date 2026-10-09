import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type InvestigationReportMode = 'selected' | 'filtered'
type InvestigationReportPayload = {
  mode?: InvestigationReportMode
  ids?: Array<string | number>
  filters?: Record<string, string>
  report?: {
    date?: string
    title?: string
    content?: string
  }
}

const SEARCH_COLUMNS = ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano']

function normalizeIds(ids: InvestigationReportPayload['ids']) {
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

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : ''
}

export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'requests.update', page: '/requests/nakit' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as InvestigationReportPayload
  const mode: InvestigationReportMode = payload.mode === 'filtered' ? 'filtered' : 'selected'
  const ids = normalizeIds(payload.ids)
  const date = cleanDate(payload.report?.date)
  const title = cleanText(payload.report?.title, 200)
  const content = cleanText(payload.report?.content, 10000)

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Tahkikat raporu eklenecek kayit secilmedi.' }, { status: 400 })
  }

  if (!date || !title || !content) {
    return NextResponse.json({ success: false, error: 'Tarih, konu ve aciklama alanlari zorunludur.' }, { status: 400 })
  }

  const params: Array<string | string[]> = [date, title, content]
  let sourceCondition = 't.durumu = 0 AND t.dosyaid IS NOT NULL'

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
    // 'gk'" - bkz. bulk-update/route.ts'teki AYNI duzeltme notu.
    needsGulkartJoin = /\bgk\./.test(filterCondition + searchCondition)
  }

  const pool = getSqlMonitorPool()

  try {
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        INSERT INTO public.tahkikatraporlari (dosyaid, tarih, konu, rapor, ilkislemtarihi, islemtarihi)
        SELECT t.dosyaid, $1::date, $2::varchar(200), $3::text, NOW(), NOW()
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
        inserted: result.rowCount || 0,
        mode,
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Tahkikat raporu eklenemedi.' },
      { status: 500 },
    )
  }
}
