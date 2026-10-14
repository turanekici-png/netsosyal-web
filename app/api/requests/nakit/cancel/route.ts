import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'
import { CANCEL_REASON_SEPARATOR } from '@/lib/nakitAutoRejectText'
import { ensureCashReasonColumnWidth } from '@/lib/services/cashReasonColumn'

export const dynamic = 'force-dynamic'

function cleanBigIntText(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null

  const date = new Date(`${text}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : text
}

function cleanReason(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

// Kullanici istegi (2026-09-29): toplu nakit iptali. Eski tekil bicim
// (id + cancelReason) ve "items: [{id, cancelReason}]" bicimi geriye donuk
// uyumluluk icin AYNEN korunur (ör. Sosyal Asistan yazma araclari, bkz.
// lib/services/aiAssistantWriteActions.service.ts) - verilen neden oldugu
// gibi yazilir.
//
// Kullanici istegi (2026-10-14): "iptal edildiğinde açıklama kısmında
// bulunan otomatik ret bilgisini ve kullanıcının yazmış olduğu bilgiyi iptal
// nedeni olarak kaydederek ... aralarında ------- işareti ile ayırarak hem
// müracaat iptal açıklamasına hem de günün tarihi ile ve bilgi başlığı ile
// tahkikat raporu alanına eklesin ... bilgi konu başlığının yanına - işareti
// koyarak dönem bilgisini de yazsın". Yeni bicim (ManagedReportTablePage):
//   { cancelDate, mode: 'selected', ids, cancelReason, writeReport }
//   { cancelDate, mode: 'filtered', filters, cancelReason, writeReport }
// Her kayit icin iptal nedeni SUNUCUDA olusturulur:
//   [kaydin otomatik red aciklamasi] ------- [kullanicinin yazdigi neden]
// (hangisi varsa; eskiden otomatik red aciklamasi varsa kullanicinin yazdigi
// YOK SAYILIYORDU). writeReport=true ise ayni metin, dosyasi olan her kayit
// icin tahkikatraporlari'na (Dosya Yönetimi > Raporlar ve Tahkikatlar) gunun
// tarihi ve "Bilgi - <dönem>" konusuyla eklenir. Hepsi TEK transaction.
type CancelItem = { id: string; cancelReason: string }

export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'requests.update', page: '/requests/nakit' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const cancelDate = cleanDate(body.cancelDate)

    if (!cancelDate) {
      return NextResponse.json({ success: false, error: 'Geçerli bir iptal tarihi girin.' }, { status: 400 })
    }

    // durumuaciklama 100 -> 500 karakter (kullanıcı kararı, bkz.
    // cashReasonColumn.ts); genişletilemezse metin gerçek uzunluğa kesilir.
    const reasonMaxLength = await ensureCashReasonColumnWidth()

    if (body.mode === 'filtered' || body.mode === 'selected') {
      const manualReason = cleanReason(body.cancelReason, reasonMaxLength) || ''
      const writeReport = body.writeReport === true

      let targetCondition: string
      const extraParams: unknown[] = []

      if (body.mode === 'selected') {
        const ids = Array.isArray(body.ids)
          ? Array.from(new Set(body.ids.map(cleanBigIntText).filter((id: string | null): id is string => Boolean(id))))
          : []
        if (ids.length === 0) {
          return NextResponse.json({ success: false, error: 'İptal edilecek kayıt seçilmedi.' }, { status: 400 })
        }
        extraParams.push(ids)
        targetCondition = `t.id = ANY($6::bigint[])`
      } else {
        // "Filtrelenen Tümünü Seç": istemci satır verisini taşımaz, hangi
        // kayıtların Otomatik Red olduğunu bilemez - neden alanı zorunlu
        // (önceki davranış korunur).
        if (!manualReason) {
          return NextResponse.json({ success: false, error: 'İptal nedeni zorunludur.' }, { status: 400 })
        }

        const filters = body.filters && typeof body.filters === 'object' ? body.filters as Record<string, string> : {}
        const filterCondition = buildFilterCondition(filters, 't')
        const searchCondition = buildTextSearchClause(
          ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano'],
          String(filters.search || '').trim(),
        )

        // Müracaatlar listesiyle (AssistanceRequestListPage.tsx dataQuery)
        // AYNI JOIN'ler - kullanıcı bu JOIN'lerden gelen sanal sütunlara göre
        // filtrelemiş olabilir.
        targetCondition = `t.id IN (
          SELECT t.id
          FROM public.yrd_ayninakti t
          LEFT JOIN public.dosyalar d ON t.dosyaid = d.id
          LEFT JOIN LATERAL (
            SELECT durum, telefon, adisoyadi, created_at, kanal
            FROM public.sms_gonderim_log
            WHERE dosyaid = d.id::text
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
          ) sm ON TRUE
          LEFT JOIN LATERAL (
            SELECT nk.kartno
            FROM public.nakitkart nk
            WHERE nk.tckimlikno = t.tckimlikno
            ORDER BY nk.id DESC
            LIMIT 1
          ) gk ON TRUE
          WHERE t.durumu = 0 ${filterCondition} ${searchCondition}
        )`
      }

      const pool = getSqlMonitorPool()
      const result = await withAuditedPoolWrite(pool, (client) => client.query(
        `
          WITH targets AS (
            SELECT
              t.id,
              t.dosyaid,
              NULLIF(BTRIM(t.donem), '') AS donem,
              CASE
                WHEN t.asama ILIKE 'Otomatik Red' AND NULLIF(BTRIM(t.durumuaciklama), '') IS NOT NULL
                  THEN BTRIM(t.durumuaciklama)
              END AS auto_reason
            FROM public.yrd_ayninakti t
            WHERE t.durumu = 0
              AND ${targetCondition}
          ),
          prepared AS (
            SELECT
              tg.*,
              NULLIF(CONCAT_WS($3::text, tg.auto_reason, NULLIF($2::text, '')), '') AS full_reason
            FROM targets tg
          ),
          prepared_final AS (
            -- iptal açıklaması alanı sınırlı (500), tahkikat raporu (text) tam metni alır
            SELECT pr.*, LEFT(pr.full_reason, $4::int) AS final_reason
            FROM prepared pr
          ),
          updated AS (
            UPDATE public.yrd_ayninakti y
            SET durumu = 1,
                durumutarih = $1::date,
                durumuaciklama = p.final_reason,
                islemtarihi = CURRENT_TIMESTAMP
            FROM prepared_final p
            WHERE y.id = p.id
              AND y.durumu = 0
              AND p.final_reason IS NOT NULL
            RETURNING y.id, p.dosyaid, p.donem, p.full_reason
          ),
          reports AS (
            INSERT INTO public.tahkikatraporlari (dosyaid, tarih, konu, rapor, ilkislemtarihi, islemtarihi)
            SELECT
              u.dosyaid,
              (NOW() AT TIME ZONE 'Europe/Istanbul')::date,
              LEFT(CASE WHEN u.donem IS NULL THEN 'Bilgi' ELSE 'Bilgi - ' || u.donem END, 200)::varchar(200),
              u.full_reason,
              NOW(),
              NOW()
            FROM updated u
            WHERE $5::boolean
              AND u.dosyaid IS NOT NULL
            RETURNING id
          )
          SELECT
            (SELECT COUNT(*) FROM updated)::int AS updated_count,
            (SELECT COUNT(*) FROM reports)::int AS report_count,
            (SELECT COUNT(*) FROM updated WHERE dosyaid IS NULL)::int AS no_file_count,
            (SELECT COUNT(*) FROM prepared_final WHERE final_reason IS NULL)::int AS missing_reason_count
        `,
        [cancelDate, manualReason, CANCEL_REASON_SEPARATOR, reasonMaxLength, writeReport, ...extraParams],
      ), getAuditMetaFromRequest(request))

      const row = result.rows[0] as {
        updated_count: number
        report_count: number
        no_file_count: number
        missing_reason_count: number
      }
      const updatedCount = Number(row?.updated_count || 0)

      if (updatedCount === 0) {
        const missing = Number(row?.missing_reason_count || 0)
        return NextResponse.json({
          success: false,
          error: missing > 0
            ? 'İptal nedeni girilmediği için kayıtlar iptal edilemedi.'
            : 'İptal edilecek müracaat bulunamadı (kayıtlar zaten iptal edilmiş olabilir).',
        }, { status: missing > 0 ? 400 : 404 })
      }

      return NextResponse.json({
        success: true,
        updatedCount,
        reportCount: Number(row?.report_count || 0),
        noFileCount: writeReport ? Number(row?.no_file_count || 0) : 0,
        missingReasonCount: Number(row?.missing_reason_count || 0),
      })
    }

    // ---- Eski biçimler (items / tekil id) - değişmedi ----
    const items: CancelItem[] = []

    if (Array.isArray(body.items)) {
      for (const rawItem of body.items) {
        const id = cleanBigIntText((rawItem as { id?: unknown })?.id)
        const reason = cleanReason((rawItem as { cancelReason?: unknown })?.cancelReason, reasonMaxLength)
        if (id && reason) items.push({ id, cancelReason: reason })
      }
    } else {
      const id = cleanBigIntText(body.id)
      const reason = cleanReason(body.cancelReason, reasonMaxLength)
      if (id && reason) items.push({ id, cancelReason: reason })
    }

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'İptal edilecek kayıt veya iptal nedeni eksik.' }, { status: 400 })
    }

    const updatedCount = await withAuditedWrite(async (tx) => {
      let count = 0
      for (const item of items) {
        const result = await tx.$executeRaw`
          UPDATE yrd_ayninakti
          SET durumu = 1,
              durumutarih = ${cancelDate}::date,
              durumuaciklama = ${item.cancelReason},
              islemtarihi = CURRENT_TIMESTAMP
          WHERE id = ${item.id}::bigint
            AND durumu = 0
        `
        count += Number(result)
      }
      return count
    }, getAuditMetaFromRequest(request))

    if (updatedCount === 0) {
      return NextResponse.json({ success: false, error: 'İptal edilecek müracaat bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Müracaat iptal edilemedi.' },
      { status: 500 },
    )
  }
}
