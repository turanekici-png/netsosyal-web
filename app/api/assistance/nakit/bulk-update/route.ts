import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { resolveCashPredefinedLabels } from '@/lib/services/cashPredefinedLabels.service'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, prepareSqlSearchTerm } from '@/lib/utils'
import { getAuditMetaFromRequest, withAuditedPoolWrite, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type BulkUpdatePayload = {
  mode?: 'selected' | 'filtered'
  id?: string | number
  ids?: Array<string | number>
  filters?: Record<string, string>
  sourceStatus?: number
  changes?: {
    durumu?: string | number
    donem?: string
    etiket?: string
    asama?: string
    miktar?: string
    tahkikatpers?: string
  }
}

const SEARCH_COLUMNS = ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano']

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

function cleanStatus(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const status = Number(value)
  return Number.isInteger(status) ? status : Number.NaN
}

function cleanAmount(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(',', '.')
  if (!text) return null
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : Number.NaN
}

function cleanSourceStatus(value: unknown) {
  const status = Number(value)
  return status === 0 || status === 6 ? status : null
}

export async function PATCH(request: Request) {
  const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance/nakit' })
  if (accessDenied) return accessDenied

  const payload = await request.json().catch(() => ({})) as BulkUpdatePayload
  const mode = payload.mode === 'filtered' ? 'filtered' : 'selected'
  const ids = normalizeIds(payload)

  if (mode === 'selected' && ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Guncellenecek kayit secilmedi.' }, { status: 400 })
  }

  const sourceStatus = cleanSourceStatus(payload.sourceStatus)
  if (mode === 'filtered' && sourceStatus === null) {
    return NextResponse.json({ success: false, error: 'Kaynak durum bilgisi gecersiz.' }, { status: 400 })
  }

  const rawDonem = cleanText(payload.changes?.donem, 50)
  const rawEtiket = cleanText(payload.changes?.etiket, 100)
  const rawAsama = cleanText(payload.changes?.asama, 50)
  const tahkikatpers = cleanText(payload.changes?.tahkikatpers, 100)
  const durumu = cleanStatus(payload.changes?.durumu)
  const miktar = cleanAmount(payload.changes?.miktar)

  if (Number.isNaN(durumu)) {
    return NextResponse.json({ success: false, error: 'Durum bilgisi sayisal olmalidir.' }, { status: 400 })
  }

  if (Number.isNaN(miktar)) {
    return NextResponse.json({ success: false, error: 'Miktar bilgisi sayisal olmalidir.' }, { status: 400 })
  }

  if (rawDonem === null && rawEtiket === null && rawAsama === null && tahkikatpers === null && durumu === null && miktar === null) {
    return NextResponse.json({ success: false, error: 'Guncellenecek en az bir alan doldurulmalidir.' }, { status: 400 })
  }

  try {
    const cashLabels = await resolveCashPredefinedLabels(rawDonem, rawEtiket, rawAsama)
    const data: {
      donem?: string
      etiket?: string
      type?: string
      amount?: number
      tahkikatpers?: string
      status?: number
      updatedAt?: Date
    } = {
      updatedAt: new Date(),
    }

    if (cashLabels.period) data.donem = cashLabels.period
    if (cashLabels.label) data.etiket = cashLabels.label
    if (cashLabels.stage) data.type = cashLabels.stage
    if (miktar !== null) data.amount = miktar
    if (tahkikatpers) data.tahkikatpers = tahkikatpers
    if (durumu !== null) data.status = durumu

    if (mode === 'selected') {
      const result = await withAuditedWrite((tx) => tx.assistance.updateMany({
        where: {
          id: {
            in: ids.map((id) => BigInt(id)),
          },
        },
        data,
      }), getAuditMetaFromRequest(request))

      return NextResponse.json({
        success: true,
        data: {
          requested: ids.length,
          updated: result.count,
          mode,
        },
      })
    }

    const assignments: string[] = []
    const params: Array<string | number | Date> = []

    const pushAssignment = (column: string, value: string | number | Date) => {
      params.push(value)
      assignments.push(`${column} = $${params.length}`)
    }

    if (data.donem !== undefined) pushAssignment('donem', data.donem)
    if (data.etiket !== undefined) pushAssignment('etiket', data.etiket)
    if (data.type !== undefined) pushAssignment('asama', data.type)
    if (data.amount !== undefined) pushAssignment('miktar', data.amount)
    if (data.tahkikatpers !== undefined) pushAssignment('tahkikatpers', data.tahkikatpers)
    if (data.status !== undefined) pushAssignment('durumu', data.status)
    if (data.updatedAt !== undefined) pushAssignment('islemtarihi', data.updatedAt)

    params.push(sourceStatus as number)
    let whereCondition = `t.durumu = $${params.length}`

    const filters = payload.filters || {}
    const safeSearchTerm = prepareSqlSearchTerm(String(filters.search || '').trim())
    const filterCondition = buildFilterCondition(filters, 't')
    const searchCondition = safeSearchTerm
      ? ` AND (${SEARCH_COLUMNS.map((column) => `${column} ILIKE '%${safeSearchTerm}%'`).join(' OR ')})`
      : ''

    whereCondition += `${filterCondition}${searchCondition}`

    // Hata duzeltmesi (2026-09-12): "missing FROM-clause entry for table
    // 'gk'" - liste ekranindaki (AssistanceRequestListPage.tsx) "Gülkart"
    // filtresi secilince buildFilterCondition ("gulkart" -> "gk.kartno",
    // bkz. lib/utils.ts virtualFileColumns) bu alani otomatik "gk." olarak
    // yazar, ama bu route'ta "gk" diye bir JOIN HIC yoktu - "Filtrelenen
    // Tumunu Sec" + herhangi bir alani (durum/tahkikat personeli/vb.) toplu
    // guncellerken Gülkart filtresi aktifse sorgu direkt hata veriyordu.
    // bulk-whatsapp-recipients/route.ts'teki AYNI kosullu LATERAL JOIN
    // deseni burada da uygulanir - filtre/arama metninde "gk." GECMIYORSA
    // JOIN hic eklenmez (gereksiz sorgu maliyeti olmasin diye).
    const needsGulkartJoin = /\bgk\./.test(filterCondition + searchCondition)

    const pool = getSqlMonitorPool()
    // Hata duzeltmesi: eskiden "FROM public.dosyalar d WHERE t.dosyaid = d.id"
    // bir INNER JOIN gibi davraniyordu - dosyaid'i NULL olan (dosyaya hic
    // baglanmamis) muracaatlar hicbir zaman eslesmiyordu ve UPDATE bu
    // satirlari SESSIZCE atliyordu (0 rows affected, hata yok). Liste
    // ekrani (AssistanceRequestListPage.tsx) bu kayitlari LEFT JOIN ile
    // gosterdigi icin kullanici onlari secip toplu durum degistirdiginde
    // ("Filtrelenen Tumunu Sec" + durum guncelle) hicbir sey olmuyormus gibi
    // gorunuyordu. Simdi eslesen id'ler LEFT JOIN ile bir alt sorguda
    // bulunuyor, asil UPDATE id uzerinden yapiliyor - dosyasiz kayitlar da
    // dahil oluyor.
    const result = await withAuditedPoolWrite(pool, (client) => client.query(
      `
        UPDATE public.yrd_ayninakti t
        SET ${assignments.join(', ')}
        FROM (
          SELECT t.id
          FROM public.yrd_ayninakti t
          LEFT JOIN public.dosyalar d ON t.dosyaid = d.id
          ${needsGulkartJoin ? `
          LEFT JOIN LATERAL (
            SELECT nk.kartno FROM public.nakitkart nk WHERE nk.tckimlikno = t.tckimlikno ORDER BY nk.id DESC LIMIT 1
          ) gk ON TRUE` : ''}
          WHERE ${whereCondition}
        ) matched
        WHERE t.id = matched.id
      `,
      params,
    ), getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        requested: null,
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
