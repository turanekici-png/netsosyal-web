import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildMappedFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type BulkUpdatePayload = {
  mode?: 'selected' | 'filtered'
  id?: string | number
  ids?: Array<string | number>
  filters?: Record<string, string>
  changes?: {
    donem?: string
    etiket?: string
    asama?: string
    miktar?: string
  }
}

const fullNameSql = `
  COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(t.ad, ''), NULLIF(t.soyad, ''))), ''),
    NULLIF(t.answers->>'fullName', ''),
    NULLIF(t.answers->>'f_name', '')
  )
`

const phoneSql = `COALESCE(NULLIF(t.answers->>'phone', ''), NULLIF(t.answers->>'f_phone', ''), NULLIF(t.answers->>'telefon', ''))`
const incomeSql = `COALESCE(NULLIF(t.answers->>'income', ''), NULLIF(t.answers->>'f_income', ''))`
const vehicleStatusSql = `COALESCE(NULLIF(t.answers->>'vehicleStatus', ''), NULLIF(t.answers->>'f_1783585922150', ''))`
const vehicleModelYearSql = `COALESCE(NULLIF(t.answers->>'vehicleModelYear', ''), NULLIF(t.answers->>'f_1783665438908', ''))`
const ibanSql = `COALESCE(NULLIF(t.answers->>'iban', ''), NULLIF(t.answers->>'f_1783668607481', ''))`
const amountSql = `COALESCE(NULLIF(t.answers->>'amount', ''), NULLIF(t.answers->>'miktar', ''), NULLIF(t.answers->>'assistanceAmount', ''), NULLIF(t.answers->>'yardimMiktari', ''), NULLIF(t.answers->>'yardim_miktari', ''), NULLIF(t.answers->>'f_amount', ''))`
const periodSql = `COALESCE(NULLIF(t.donem, ''), NULLIF(t.answers->>'period', ''), NULLIF(t.answers->>'donem', ''))`

const FILTER_COLUMN_MAP: Record<string, string> = {
  id: 't.id',
  basvuru_tarihi: 't.created_at',
  tc: 't.tckimlikno',
  ad_soyad: fullNameSql,
  dogum_tarihi: 't.dogumtarihi',
  telefon: phoneSql,
  aylik_gelir: incomeSql,
  arac_durumu: vehicleStatusSql,
  arac_modeli: vehicleModelYearSql,
  iban: ibanSql,
  miktar: amountSql,
  yardim_turu: 't.yardim_turu',
  mahalle: 't.mahalleadi',
  adres: 't.adres',
  durum: 't.status',
  donem: periodSql,
  etiket: 't.etiket',
  asama: 't.asama',
  aciklama: 't.aciklama',
  basvuru_yili: 't.basvuru_yili',
  donem_grubu: 't.donem_grubu',
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

function parseAnswers(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export async function PATCH(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'online.forms.manage', page: '/online' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as BulkUpdatePayload
  const mode = payload.mode === 'filtered' ? 'filtered' : 'selected'
  const ids = normalizeIds(payload)

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Guncellenecek kayit secilmedi.' }, { status: 400 })
  }

  const changes = {
    donem: cleanText(payload.changes?.donem, 50),
    etiket: cleanText(payload.changes?.etiket, 100),
    asama: cleanText(payload.changes?.asama, 50),
    miktar: cleanText(payload.changes?.miktar, 30),
  }

  if (!changes.donem && !changes.etiket && !changes.asama && !changes.miktar) {
    return NextResponse.json({ success: false, error: 'Donem, etiket, asama veya miktar alanlarindan en az biri doldurulmalidir.' }, { status: 400 })
  }

  const assignments: string[] = []
  const params: Array<string | string[]> = []

  const pushAssignment = (column: string, value: string | null) => {
    if (!value) return
    params.push(value)
    assignments.push(`${column} = $${params.length}`)
  }

  pushAssignment('donem', changes.donem)
  pushAssignment('etiket', changes.etiket)
  pushAssignment('asama', changes.asama)

  let whereCondition = ''
  if (mode === 'selected') {
    params.push(ids)
    whereCondition = `t.id::text = ANY($${params.length})`
  } else {
    const filters = payload.filters || {}
    const safeSearchTerm = prepareSqlSearchTerm(String(filters.search || '').trim())
    const filterCondition = buildMappedFilterCondition(filters, FILTER_COLUMN_MAP)
    const searchCondition = safeSearchTerm
      ? ` AND (
          t.tckimlikno ILIKE '%${safeSearchTerm}%'
          OR ${fullNameSql} ILIKE '%${safeSearchTerm}%'
          OR ${phoneSql} ILIKE '%${safeSearchTerm}%'
          OR ${incomeSql} ILIKE '%${safeSearchTerm}%'
          OR ${vehicleStatusSql} ILIKE '%${safeSearchTerm}%'
          OR ${vehicleModelYearSql} ILIKE '%${safeSearchTerm}%'
          OR ${ibanSql} ILIKE '%${safeSearchTerm}%'
          OR ${amountSql} ILIKE '%${safeSearchTerm}%'
          OR t.yardim_turu ILIKE '%${safeSearchTerm}%'
          OR t.mahalleadi ILIKE '%${safeSearchTerm}%'
          OR t.adres ILIKE '%${safeSearchTerm}%'
          OR t.status ILIKE '%${safeSearchTerm}%'
          OR t.aciklama ILIKE '%${safeSearchTerm}%'
          OR t.answers::text ILIKE '%${safeSearchTerm}%'
        )`
      : ''
    whereCondition = `1=1 ${filterCondition} ${searchCondition}`
  }

  try {
    const pool = getSqlMonitorPool()
    let updated = 0

    if (assignments.length > 0) {
      const result = await pool.query(
        `
          UPDATE public.online_basvurular t
          SET ${assignments.join(', ')}
          WHERE ${whereCondition}
        `,
        params,
      )
      updated = result.rowCount || 0
    }

    if (changes.miktar) {
      const amountParams: Array<string | string[]> = []
      let amountWhereCondition = ''

      if (mode === 'selected') {
        amountParams.push(ids)
        amountWhereCondition = `t.id::text = ANY($${amountParams.length})`
      } else {
        const filters = payload.filters || {}
        const safeSearchTerm = prepareSqlSearchTerm(String(filters.search || '').trim())
        const filterCondition = buildMappedFilterCondition(filters, FILTER_COLUMN_MAP)
        const searchCondition = safeSearchTerm
          ? ` AND (
              t.tckimlikno ILIKE '%${safeSearchTerm}%'
              OR ${fullNameSql} ILIKE '%${safeSearchTerm}%'
              OR ${phoneSql} ILIKE '%${safeSearchTerm}%'
              OR ${incomeSql} ILIKE '%${safeSearchTerm}%'
              OR ${vehicleStatusSql} ILIKE '%${safeSearchTerm}%'
              OR ${vehicleModelYearSql} ILIKE '%${safeSearchTerm}%'
              OR ${ibanSql} ILIKE '%${safeSearchTerm}%'
              OR ${amountSql} ILIKE '%${safeSearchTerm}%'
              OR t.yardim_turu ILIKE '%${safeSearchTerm}%'
              OR t.mahalleadi ILIKE '%${safeSearchTerm}%'
              OR t.adres ILIKE '%${safeSearchTerm}%'
              OR t.status ILIKE '%${safeSearchTerm}%'
              OR t.aciklama ILIKE '%${safeSearchTerm}%'
              OR t.answers::text ILIKE '%${safeSearchTerm}%'
            )`
          : ''
        amountWhereCondition = `1=1 ${filterCondition} ${searchCondition}`
      }

      const rowsResult = await pool.query<{ id: number; answers: unknown }>(
        `
          SELECT t.id, t.answers
          FROM public.online_basvurular t
          WHERE ${amountWhereCondition}
        `,
        amountParams,
      )

      await Promise.all(rowsResult.rows.map((row) => {
        const answersJson = JSON.stringify({
          ...parseAnswers(row.answers),
          amount: changes.miktar,
          miktar: changes.miktar,
          assistanceAmount: changes.miktar,
        })

        return pool.query(
          'UPDATE public.online_basvurular SET answers = $1::jsonb WHERE id = $2::int',
          [answersJson, row.id],
        )
      }))

      updated = Math.max(updated, rowsResult.rowCount || 0)
    }

    return NextResponse.json({
      success: true,
      data: {
        requested: mode === 'selected' ? ids.length : null,
        updated,
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
