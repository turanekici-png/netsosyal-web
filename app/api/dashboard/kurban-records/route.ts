import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { ensureKurbanCountsTable } from '@/lib/services/kurbanCounts.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Payload = {
  mode?: 'selected' | 'filtered'
  id?: string | number
  ids?: Array<string | number>
  filters?: Record<string, string>
  changes?: {
    tarih?: string
    kurban_turu?: string
    kurban_cinsi?: string
    adet?: string
  }
}

const KURBAN_TURLERI = new Set(['Vekaleten Kurban Kesimi', 'Vacip Kurban Kesimi'])
const KURBAN_CINSLERI = new Set(['Büyük Baş Kurban', 'Küçük Baş Kurban'])

const LISTED_CTE = `
  WITH listed AS (
    SELECT
      k.id,
      to_char(k.tarih, 'YYYY-MM-DD') AS tarih,
      COALESCE(to_char(k.tarih, 'YYYY'), 'Belirtilmedi') AS yil,
      COALESCE(to_char(k.tarih, 'YYYY-MM'), 'Belirtilmedi') AS ay,
      k.kurban_turu,
      k.kurban_cinsi,
      k.adet
    FROM public.yrd_kurban k
  )
`

function normalizeIds(payload: Payload) {
  const rawIds = Array.isArray(payload.ids) && payload.ids.length > 0
    ? payload.ids
    : payload.id !== undefined && payload.id !== null
    ? [payload.id]
    : []

  return Array.from(new Set(rawIds.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id))))
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanCount(value: unknown) {
  if (typeof value !== 'string') return null
  const count = Number(value.trim())
  return Number.isInteger(count) && count > 0 ? count : Number.NaN
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function buildListedCondition(filters: Record<string, string> = {}) {
  const year = filters.year?.trim() || ''
  const period = filters.period?.trim() || ''
  const filterCondition = buildFilterCondition(filters, 'listed')
  const yearCondition = year && year !== 'all' ? ` AND listed.yil = ${sqlString(year)}` : ''
  const periodCondition = period && period !== 'all' ? ` AND listed.ay = ${sqlString(period)}` : ''
  // Türkçe-duyarsız serbest metin araması (büyük/küçük harf + aksan yok sayılır)
  const searchCondition = buildTextSearchClause(
    ['listed.tarih', 'listed.kurban_turu', 'listed.kurban_cinsi', 'listed.adet', 'listed.yil', 'listed.ay'],
    String(filters.search || '').trim(),
  )

  return `${yearCondition} ${periodCondition} ${filterCondition} ${searchCondition}`
}

export async function PATCH(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/dashboard/kurban-records' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as Payload
  const mode = payload.mode === 'filtered' ? 'filtered' : 'selected'
  const ids = normalizeIds(payload)

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Guncellenecek kayit secilmedi.' }, { status: 400 })
  }

  const tarih = cleanDate(payload.changes?.tarih)
  const kurbanTuru = cleanText(payload.changes?.kurban_turu, 100)
  const kurbanCinsi = cleanText(payload.changes?.kurban_cinsi, 100)
  const adet = cleanCount(payload.changes?.adet)

  if (kurbanTuru !== null && !KURBAN_TURLERI.has(kurbanTuru)) {
    return NextResponse.json({ success: false, error: 'Kurban turu gecersiz.' }, { status: 400 })
  }
  if (kurbanCinsi !== null && !KURBAN_CINSLERI.has(kurbanCinsi)) {
    return NextResponse.json({ success: false, error: 'Kurban cinsi gecersiz.' }, { status: 400 })
  }
  if (Number.isNaN(adet)) {
    return NextResponse.json({ success: false, error: 'Adet bilgisi pozitif tam sayi olmalidir.' }, { status: 400 })
  }

  const assignments: string[] = ['islemtarihi = NOW()']
  const params: Array<string | number | string[]> = []

  const pushAssignment = (column: string, value: string | number, cast = '') => {
    params.push(value)
    assignments.unshift(`${column} = $${params.length}${cast}`)
  }

  if (tarih !== null) pushAssignment('tarih', tarih, '::date')
  if (kurbanTuru !== null) pushAssignment('kurban_turu', kurbanTuru)
  if (kurbanCinsi !== null) pushAssignment('kurban_cinsi', kurbanCinsi)
  if (adet !== null && !Number.isNaN(adet)) pushAssignment('adet', adet)

  if (assignments.length === 1) {
    return NextResponse.json({ success: false, error: 'Guncellenecek en az bir alan doldurulmalidir.' }, { status: 400 })
  }

  const pool = getSqlMonitorPool()

  try {
    await ensureKurbanCountsTable()

    const query = mode === 'selected'
      ? `
        UPDATE public.yrd_kurban
        SET ${assignments.join(', ')}
        WHERE id = ANY($${params.push(ids)}::bigint[]);
      `
      : `
        UPDATE public.yrd_kurban target
        SET ${assignments.join(', ')}
        WHERE target.id IN (
          ${LISTED_CTE}
          SELECT listed.id
          FROM listed
          WHERE 1 = 1 ${buildListedCondition(payload.filters)}
        );
      `

    const result = await pool.query(query, params)

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
      { success: false, error: error instanceof Error ? error.message : 'Kurban kayitlari guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/dashboard/kurban-records' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as Payload
  const mode = payload.mode === 'filtered' ? 'filtered' : 'selected'
  const ids = normalizeIds(payload)
  const pool = getSqlMonitorPool()

  try {
    await ensureKurbanCountsTable()

    if (mode === 'filtered') {
      const result = await pool.query(`
        DELETE FROM public.yrd_kurban target
        WHERE target.id IN (
          ${LISTED_CTE}
          SELECT listed.id
          FROM listed
          WHERE 1 = 1 ${buildListedCondition(payload.filters)}
        );
      `)

      return NextResponse.json({ success: true, data: { mode, deleted: result.rowCount || 0 } })
    }

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek kayit secilmedi.' }, { status: 400 })
    }

    const result = await pool.query('DELETE FROM public.yrd_kurban WHERE id = ANY($1::bigint[]);', [ids])
    return NextResponse.json({ success: true, data: { requested: ids.length, deleted: result.rowCount || 0 } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kurban kayitlari silinemedi.' },
      { status: 500 },
    )
  }
}
