import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { prepareSqlSearchTerm } from '@/lib/utils'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type BulkUpdatePayload = {
  mode?: 'selected' | 'filtered'
  id?: string | number
  ids?: Array<string | number>
  filters?: Record<string, string>
  changes?: {
    donem?: string
    etiket?: string
    miktar?: string
  }
}

const PAID_OPERATION_CONDITION = `
  lower(trim(COALESCE(h.islemadi, ''))) IN (
    'ode', 'öde', 'Ã¶de',
    'odeme yapildi', 'ödeme yapıldı', 'Ã¶deme yapÄ±ldÄ±'
  )
`

const SOURCES = {
  Gida: {
    tableName: 'yrd_gidabankasihrk',
    alias: 'h',
    yearExpression: `
      COALESCE(
        CASE
          WHEN TRIM(COALESCE(h.donemadi, '')) ~ '^[0-9]{2}-[0-9]{4}$'
            THEN SUBSTRING(TRIM(h.donemadi) FROM '[0-9]{4}$')
          ELSE NULL
        END,
        to_char(h.islemtarihi, 'YYYY'),
        'Belirtilmedi'
      )
    `,
    joins: 'LEFT JOIN yrd_gidabankasi t ON t.id = h.yardimid LEFT JOIN dosyalar d ON d.id = h.dosyaid',
    baseWhere: PAID_OPERATION_CONDITION,
    fields: new Set(['donem', 'miktar']),
  },
  'Destek Paketi': {
    tableName: 'yrd_destekpaketihrk',
    alias: 'h',
    yearExpression: "COALESCE(to_char(h.islemtarihi, 'YYYY'), 'Belirtilmedi')",
    joins: 'LEFT JOIN yrd_destekpaketi t ON t.id = h.yardimid LEFT JOIN dosyalar d ON d.id = h.dosyaid',
    baseWhere: PAID_OPERATION_CONDITION,
    fields: new Set(['donem', 'miktar']),
  },
  'Donem Disi Gida': {
    tableName: 'yrd_ddgidadosyali',
    alias: 't',
    yearExpression: "COALESCE(to_char(t.durumutarih, 'YYYY'), 'Belirtilmedi')",
    joins: 'LEFT JOIN dosyalar d ON d.id = t.dosyaid',
    baseWhere: 't.durumu = 6',
    fields: new Set(['miktar']),
  },
  Giyim: {
    tableName: 'yrd_giyim',
    alias: 't',
    yearExpression: "COALESCE(to_char(t.durumutarih, 'YYYY'), 'Belirtilmedi')",
    joins: 'LEFT JOIN dosyalar d ON d.id = t.dosyaid',
    baseWhere: 't.durumu = 6',
    fields: new Set(['donem', 'etiket', 'miktar']),
  },
}

function normalizeIds(payload: BulkUpdatePayload) {
  const rawIds = Array.isArray(payload.ids) && payload.ids.length > 0
    ? payload.ids
    : payload.id !== undefined && payload.id !== null
    ? [payload.id]
    : []

  return Array.from(
    new Set(
      rawIds
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanAmount(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(',', '.')
  if (!text) return null
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : Number.NaN
}

export async function PATCH(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/dashboard/aid-payment-records' })
  if (accessDenied) return accessDenied

  const sourceType = request.nextUrl.searchParams.get('type') || ''
  const year = request.nextUrl.searchParams.get('year') || ''
  const source = SOURCES[sourceType as keyof typeof SOURCES]
  const payload = await request.json().catch(() => ({})) as BulkUpdatePayload
  const mode = payload.mode === 'filtered' ? 'filtered' : 'selected'
  const ids = normalizeIds(payload)

  if (!source || !year) {
    return NextResponse.json({ success: false, error: 'Rapor turu veya yil bilgisi eksik.' }, { status: 400 })
  }

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Guncellenecek kayit secilmedi.' }, { status: 400 })
  }

  const donem = cleanText(payload.changes?.donem, 50)
  const etiket = cleanText(payload.changes?.etiket, 100)
  const miktar = cleanAmount(payload.changes?.miktar)

  if (Number.isNaN(miktar)) {
    return NextResponse.json({ success: false, error: 'Miktar bilgisi sayisal olmalidir.' }, { status: 400 })
  }

  const assignments: string[] = []
  const params: Array<string | number | string[]> = []

  const pushAssignment = (column: string, value: string | number) => {
    params.push(value)
    assignments.push(`${column} = $${params.length}`)
  }

  if (donem !== null && source.fields.has('donem')) {
    pushAssignment(source.alias === 'h' ? 'donemadi' : 'donem', donem)
  }
  if (etiket !== null && source.fields.has('etiket')) pushAssignment('etiket', etiket)
  if (miktar !== null && source.fields.has('miktar')) pushAssignment('miktar', miktar)

  if (assignments.length === 0) {
    return NextResponse.json({ success: false, error: 'Bu rapor kaynagi icin guncellenecek uygun alan doldurulmadi.' }, { status: 400 })
  }

  const whereParts = [source.baseWhere]

  if (mode === 'selected') {
    params.push(ids)
    whereParts.push(`${source.alias}.id = ANY($${params.length}::bigint[])`)
  } else {
    params.push(year)
    whereParts.push(`${source.yearExpression} = $${params.length}`)

    const searchTerm = prepareSqlSearchTerm(String(payload.filters?.search || '').trim())
    if (searchTerm) {
      params.push(`%${searchTerm}%`)
      const param = `$${params.length}`
      whereParts.push(`(
        d.dosyano ILIKE ${param}
        OR t.muracaateden ILIKE ${param}
        OR ${source.alias}.aciklama ILIKE ${param}
        OR ${source.alias}.miktar::text ILIKE ${param}
      )`)
    }
  }

  if (source.alias === 'h' && donem !== null && source.fields.has('donem')) {
    const match = /^([0-9]{2})-([0-9]{4})$/.exec(donem)
    if (match) {
      const periodInt = Number(`${match[2]}${match[1]}`)
      if (Number.isInteger(periodInt)) {
        params.push(periodInt)
        assignments.push(`donemint = $${params.length}`)
        assignments.push(`donem = $${params.length}`)
      }
    }
  }

  if (source.alias === 't') {
    assignments.push('islemtarihi = NOW()')
  }

  const pool = getSqlMonitorPool()

  try {
    const query = mode === 'selected'
      ? `
        UPDATE public.${source.tableName} ${source.alias}
        SET ${assignments.join(', ')}
        WHERE ${whereParts.join(' AND ')}
      `
      : `
        UPDATE public.${source.tableName} target
        SET ${assignments.join(', ')}
        WHERE target.id IN (
          SELECT ${source.alias}.id
          FROM public.${source.tableName} ${source.alias}
          ${source.joins}
          WHERE ${whereParts.join(' AND ')}
        )
      `

    const result = await withAuditedPoolWrite(
      pool,
      (client) => client.query(query, params),
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      data: {
        requested: mode === 'selected' ? ids.length : null,
        updated: result.rowCount || 0,
        mode,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayitlar guncellenemedi.' },
      { status: 500 },
    )
  }
}
