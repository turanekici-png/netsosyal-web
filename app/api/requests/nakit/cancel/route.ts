import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { buildFilterCondition, buildTextSearchClause } from '@/lib/utils'

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

function cleanReason(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, 100) : null
}

// Kullanici istegi (2026-09-29): "nakit müracaatlarında toplu iptal etme
// işlemi yok ... toplu nakit yardımı iptal işlemi yapabilelim" - eskiden bu
// uc nokta SADECE tek bir "id" kabul ediyordu (bkz. ManagedReportTablePage -
// openCancelModal, "selectedRows.length !== 1" siniri). Artik hem eski tekil
// bicim (id + cancelReason, geriye donuk uyumluluk icin - ör. Sosyal Asistan
// yazma araclari, bkz. lib/services/aiAssistantWriteActions.service.ts) HEM
// DE coklu bicim (items: [{id, cancelReason}], HER kayit KENDI iptal
// nedeniyle - bkz. asagidaki "otomatik red açıklamasını iptal açıklamasına
// yazalım" istegi) kabul edilir; ikisi de AYNI paylasimli cancelDate'i kullanir.
type CancelItem = { id: string; cancelReason: string }

export async function PATCH(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'requests.update', page: '/requests/nakit' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const cancelDate = cleanDate(body.cancelDate)

    if (!cancelDate) {
      return NextResponse.json({ success: false, error: 'Gecerli bir iptal tarihi girin.' }, { status: 400 })
    }

    // Kullanici istegi (2026-09-29, devam): "filtrelenen tüm kayıtları
    // seçtiğimde hepsi için iptal işlemi yapamıyorum" - "Filtrelenen Tümünü
    // Seç" secildiginde ManagedReportTablePage TUM satir verisini (binlerce
    // olabilir) tarayiciya yuklemez, sadece filtre bilgisini (filters) tasir
    // - bu yuzden "items" (id + kendi durumuaciklama'si) client'ta
    // OLUSTURULAMAZ. Bu mod, eslesen kayitlari (Musraatlar listesindeki
    // AYNI filtre/arama mantigiyla - bkz. AssistanceRequestListPage.tsx
    // dataQuery) SUNUCU tarafinda bulur ve İKİ TEK UPDATE ile isler: once
    // "Otomatik Red" asamasinda KENDI aciklamasi olan kayitlar (o aciklama
    // KORUNUR), sonra durumu HALA 0 olan (yani ilk adimda islenmeyen) geri
    // kalanlar (manuel girilen cancelReason yazilir). Ilk UPDATE zaten
    // durumu=1 yaptigi icin ikinci UPDATE'in "durumu = 0" sarti onlari
    // otomatik disarida birakir - ayri bir exclude kosulu gerekmez.
    if (body.mode === 'filtered') {
      const cancelReason = cleanReason(body.cancelReason)
      if (!cancelReason) {
        return NextResponse.json({ success: false, error: 'İptal nedeni zorunludur.' }, { status: 400 })
      }

      const filters = body.filters && typeof body.filters === 'object' ? body.filters as Record<string, string> : {}
      const filterCondition = buildFilterCondition(filters, 't')
      const searchCondition = buildTextSearchClause(
        ['t.muracaateden', 't.tckimlikno', 't.iban', 'd.dosyano'],
        String(filters.search || '').trim(),
      )

      // Musraatlar listesiyle (AssistanceRequestListPage.tsx dataQuery) AYNI
      // JOIN'ler - kullanici "dosyano"/"dosya_durumu"/"son_mesaj_*"/"gulkart"
      // gibi bu JOIN'lerden gelen sanal sutunlara gore filtrelemis olabilir.
      const matchSubquerySql = `
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
      `

      const pool = getSqlMonitorPool()
      const updatedCount = await withAuditedPoolWrite(pool, async (client) => {
        const autoResult = await client.query(
          `
            UPDATE public.yrd_ayninakti
            SET durumu = 1,
                durumutarih = $1::date,
                islemtarihi = CURRENT_TIMESTAMP
            WHERE durumu = 0
              AND asama ILIKE 'Otomatik Red'
              AND NULLIF(TRIM(durumuaciklama), '') IS NOT NULL
              AND id IN (${matchSubquerySql})
          `,
          [cancelDate],
        )
        const manualResult = await client.query(
          `
            UPDATE public.yrd_ayninakti
            SET durumu = 1,
                durumutarih = $1::date,
                durumuaciklama = $2,
                islemtarihi = CURRENT_TIMESTAMP
            WHERE durumu = 0
              AND id IN (${matchSubquerySql})
          `,
          [cancelDate, cancelReason],
        )
        return (autoResult.rowCount || 0) + (manualResult.rowCount || 0)
      }, getAuditMetaFromRequest(request))

      if (updatedCount === 0) {
        return NextResponse.json({ success: false, error: 'Iptal edilecek muracaat bulunamadi.' }, { status: 404 })
      }

      return NextResponse.json({ success: true, updatedCount })
    }

    const items: CancelItem[] = []

    if (Array.isArray(body.items)) {
      for (const rawItem of body.items) {
        const id = cleanBigIntText((rawItem as { id?: unknown })?.id)
        const reason = cleanReason((rawItem as { cancelReason?: unknown })?.cancelReason)
        if (id && reason) items.push({ id, cancelReason: reason })
      }
    } else {
      // Eski tekil bicim: { id, cancelReason }
      const id = cleanBigIntText(body.id)
      const reason = cleanReason(body.cancelReason)
      if (id && reason) items.push({ id, cancelReason: reason })
    }

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'Iptal edilecek kayit/neden bilgisi eksik.' }, { status: 400 })
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
      return NextResponse.json({ success: false, error: 'Iptal edilecek muracaat bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Muracaat iptal edilemedi.' },
      { status: 500 },
    )
  }
}
