import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { applyCashAutoReject, applyCashAutoRejectRevert, previewCashAutoReject } from '@/lib/services/cashAutoReject.service'

export const dynamic = 'force-dynamic'

// Kullanici istegi: Nakit Yardımı listesindeki TÜM durumu=0 (bekleyen)
// müracaatlar, Ayarlar > Hazır Değerler > Yardım Kriterleri sınırlarına göre
// toplu kontrol edilir; sadece durumu=0 kayıtlar değerlendirilir/güncellenir
// (bkz. lib/services/cashAutoReject.service.ts). "revert" modu, daha once
// Otomatik Red yapilmis ama artik kriterlerin ALTINDA kalan kayitlari
// "İncelenecek"e geri alir (ters yon).
export async function POST(request: Request) {
  try {
    // Kullanici istegi: Otomatik Red kontrolu/uygulamasi ARTIK genel
    // "assistance.update" yetkisiyle degil, ayri/ozel "assistance.autoReject"
    // yetkisiyle korunuyor - sadece bu yetkiye sahip kullanicilar (Nakit
    // Yardımı listesindeki toplu buton VEYA müracaat penceresindeki canlı
    // otomasyon uzerinden) bu islemi yapabilir.
    const accessDenied = await requireApiAccess({ action: 'assistance.autoReject', page: '/assistance/nakit' })
    if (accessDenied) return accessDenied

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const mode = body.mode === 'apply' ? 'apply' : body.mode === 'revert' ? 'revert' : 'preview'

    if (mode === 'apply') {
      // Kullanici istegi (2026-09-29): "otomatik red açıklamasını nakit
      // yardımları tablosunda da görelim" - artik client, preview'da
      // gosterilen TAM reason metnini de (id ile birlikte) gonderir; bu
      // metin durumuaciklama alanina yazilir (bkz. cashAutoReject.service.ts).
      const rawMatches = Array.isArray(body.matches) ? body.matches : []
      const matches = rawMatches
        .map((item) => {
          const record = item as { id?: unknown; reason?: unknown }
          return { id: String(record?.id ?? '').trim(), reason: String(record?.reason ?? '').trim() }
        })
        .filter((match) => /^\d+$/.test(match.id))

      if (matches.length === 0) {
        return NextResponse.json({ success: false, error: 'Uygulanacak kayıt bulunamadı.' }, { status: 400 })
      }

      const updatedCount = await applyCashAutoReject(matches, getAuditMetaFromRequest(request))
      return NextResponse.json({ success: true, data: { updatedCount } })
    }

    if (mode === 'revert') {
      const rawIds = Array.isArray(body.ids) ? body.ids : []
      const ids = rawIds.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id))

      if (ids.length === 0) {
        return NextResponse.json({ success: false, error: 'Uygulanacak kayıt bulunamadı.' }, { status: 400 })
      }

      const updatedCount = await applyCashAutoRejectRevert(ids, getAuditMetaFromRequest(request))
      return NextResponse.json({ success: true, data: { updatedCount } })
    }

    const { checkedCount, matches, reverts, thresholds, hasCriteria } = await previewCashAutoReject()

    if (!hasCriteria) {
      return NextResponse.json({
        success: false,
        error: 'Ayarlar > Hazır Değerler > Yardım Kriterleri altında hiçbir dönem için "Aylık Gelir" veya "Araç Modeli" sınırı tanımlı değil.',
      }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: { checkedCount, matches, reverts, thresholds } })
  } catch (error) {
    console.error('[Nakit Otomatik Red] Hata:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Otomatik red kontrolü yapılamadı.' },
      { status: 500 },
    )
  }
}
