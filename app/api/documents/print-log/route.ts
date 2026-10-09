import { NextRequest, NextResponse } from 'next/server'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { resolveAuditUserName } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

// Bir yardım türü veya müracaat formu YAZDIRILDIĞINDA çağrılır - amaç, bu
// aksiyonu da "Kullanıcı Günlük İşlem Performansı" panelinde bir işlem gibi
// göstermek. Yazdırma bir veritabani guncellemesi olmadigi (hicbir alan
// degismedigi) icin normal denetim/audit akisina hic girmiyordu; bu yuzden
// burada sistem_hareket_log'a ozel bir 'yazdir' turu kaydi ekleniyor (bkz.
// lib/services/userDailyActivity.service.ts - o sorgu bu turu de sayar).
//
// "Aynı gün içinde aynı dosyadan birden fazla yazdırma = 1 işlem" kurali:
// tablo_adi='dosyalar', kayit_id=dosyaId sabit tutulup, ayni kullanici +
// ayni dosya + ayni gun icin zaten bir 'yazdir' kaydi varsa YENIDEN
// EKLENMIYOR - boylece dosyadaki hangi yardim turunden/kac kez yazdirilirsa
// yazdirilsin, o dosya o gun icin en fazla 1 kez sayilir.
function normalizeBigInt(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { dosyaId?: unknown; type?: unknown } | null
    const dosyaId = normalizeBigInt(body?.dosyaId)
    const label = typeof body?.type === 'string' && body.type.trim() ? body.type.trim() : 'Form'

    if (!dosyaId) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const actorName = await resolveAuditUserName()
    if (!actorName || actorName === 'Sistem') {
      // Oturum belirlenemiyorsa gercek bir personel sayilamaz - sessizce atla.
      return NextResponse.json({ success: true, logged: false })
    }

    const pool = getSqlMonitorPool()

    const existing = await pool.query(
      `
        SELECT 1
        FROM sistem_hareket_log
        WHERE kullanici_adi = $1
          AND tablo_adi = 'dosyalar'
          AND kayit_id = $2::text
          AND islem_tipi = 'yazdir'
          AND tarih::date = CURRENT_DATE
        LIMIT 1;
      `,
      [actorName, dosyaId],
    )

    if ((existing.rowCount ?? 0) > 0) {
      return NextResponse.json({ success: true, logged: false })
    }

    await pool.query(
      `
        INSERT INTO sistem_hareket_log
          (kullanici_adi, islem_tipi, tablo_adi, kayit_id, aciklama, tarih, revision_no)
        VALUES (
          $1,
          'yazdir',
          'dosyalar',
          $2::text,
          $3,
          NOW(),
          COALESCE(
            (SELECT MAX(h.revision_no) FROM sistem_hareket_log h WHERE h.tablo_adi = 'dosyalar' AND h.kayit_id = $2::text),
            0
          ) + 1
        );
      `,
      [actorName, dosyaId, `${label} formu yazdırıldı.`],
    )

    return NextResponse.json({ success: true, logged: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yazdırma kaydı oluşturulamadı.' },
      { status: 500 },
    )
  }
}
