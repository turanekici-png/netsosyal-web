import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { buildOnlineApplicationsWhere, ensureOnlineApplicationsAuditTrigger } from '@/lib/onlineApplications/listQuery'

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
    return NextResponse.json({ success: false, error: 'Güncellenecek kayıt seçilmedi.' }, { status: 400 })
  }

  const changes = {
    donem: cleanText(payload.changes?.donem, 50),
    etiket: cleanText(payload.changes?.etiket, 100),
    asama: cleanText(payload.changes?.asama, 50),
    miktar: cleanText(payload.changes?.miktar, 30),
  }

  if (!changes.donem && !changes.etiket && !changes.asama && !changes.miktar) {
    return NextResponse.json({ success: false, error: 'Dönem, etiket, aşama veya miktar alanlarından en az biri doldurulmalıdır.' }, { status: 400 })
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

  // 2026-10-14: filtreli modda listenin KENDİ arama/filtre koşulu kullanılır
  // (bkz. lib/onlineApplications/listQuery.ts) - eskiden burada ayrı ve
  // Türkçe-duyarsız olmayan bir arama vardı, ekranda görünenle güncellenen
  // kayıtlar farklı olabiliyordu.
  const buildWhere = (startIndex: number): { sql: string; values: Array<string | string[]> } => {
    if (mode === 'selected') {
      return { sql: `t.id::text = ANY($${startIndex + 1})`, values: [ids] }
    }
    return { sql: buildOnlineApplicationsWhere(payload.filters || {}), values: [] }
  }

  try {
    const pool = getSqlMonitorPool()
    await ensureOnlineApplicationsAuditTrigger(pool)

    // İşlem kaydı: değişiklikler kullanıcı adıyla sistem_hareket_log'a düşer
    // (eski + yeni değer). Tüm yazmalar tek transaction'da - yarıda kalırsa
    // hiçbiri uygulanmaz.
    const updated = await withAuditedPoolWrite(pool, async (client) => {
      let updatedCount = 0

      if (assignments.length > 0) {
        const where = buildWhere(params.length)
        const result = await client.query(
          `
            UPDATE public.online_basvurular t
            SET ${assignments.join(', ')}
            WHERE ${where.sql}
          `,
          [...params, ...where.values],
        )
        updatedCount = result.rowCount || 0
      }

      if (changes.miktar) {
        const where = buildWhere(0)
        const rowsResult = await client.query<{ id: number; answers: unknown }>(
          `
            SELECT t.id, t.answers
            FROM public.online_basvurular t
            WHERE ${where.sql}
          `,
          where.values,
        )

        for (const row of rowsResult.rows) {
          const answersJson = JSON.stringify({
            ...parseAnswers(row.answers),
            amount: changes.miktar,
            miktar: changes.miktar,
            assistanceAmount: changes.miktar,
          })
          await client.query(
            'UPDATE public.online_basvurular SET answers = $1::jsonb WHERE id = $2::int',
            [answersJson, row.id],
          )
        }

        updatedCount = Math.max(updatedCount, rowsResult.rowCount || 0)
      }

      return updatedCount
    }, getAuditMetaFromRequest(request))

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
      { success: false, error: error instanceof Error ? error.message : 'Kayıtlar güncellenemedi.' },
      { status: 500 },
    )
  }
}
