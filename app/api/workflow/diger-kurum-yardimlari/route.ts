import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

// 2026-10-15: Sonuç Bekleyen penceresindeki "Diğer Kurum Yardımları" -
// dosyanin diger kurumlardan aldigi yardimlar (yrd_digerkrmalyrdm). Dosya
// Yönetimi'ndeki ayni kaynak (bkz. app/api/documents/fetch/route.ts); o uc
// nokta acilista bildirimleri "görüldü" isaretledigi icin burada ayri, salt
// okunur sorgu kullanilir.
export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const fileId = String(request.nextUrl.searchParams.get('fileId') ?? '').trim()
    if (!/^\d+$/.test(fileId)) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const result = await getSqlMonitorPool().query<{
      id: string
      tarih: string | null
      ad_soyad: string | null
      tc_kimlik_no: string | null
      kurum: string | null
      yardim_turu: string | null
      aciklama: string | null
      miktar: number | null
    }>(
      `
        SELECT t.id::text AS id, TO_CHAR(t.tarih, 'YYYY-MM-DD') AS tarih,
               NULLIF(BTRIM(t.adisoyadi), '') AS ad_soyad,
               COALESCE(NULLIF(BTRIM(t.tckimlikno), ''), NULLIF(BTRIM(b.tckimlikno), '')) AS tc_kimlik_no,
               NULLIF(BTRIM(t.yardimalkrmadi), '') AS kurum,
               NULLIF(BTRIM(t.yardimturu), '') AS yardim_turu,
               NULLIF(BTRIM(t.aciklama), '') AS aciklama,
               t.miktar
        FROM yrd_digerkrmalyrdm t
        LEFT JOIN LATERAL (
          SELECT tckimlikno FROM bireyler WHERE dosyaid = t.dosyaid AND adisoyadi = t.adisoyadi LIMIT 1
        ) b ON true
        -- Kayitlarin bir kismi (ice aktarilanlar) dosyaya bagli degil, yalniz
        -- T.C. ile tutuluyor: hanedeki bireylerin T.C.'siyle eslesenler de gelir.
        WHERE t.dosyaid = $1::int
           OR (t.dosyaid IS NULL AND NULLIF(BTRIM(t.tckimlikno), '') IN (
                SELECT BTRIM(hb.tckimlikno) FROM bireyler hb
                WHERE hb.dosyaid = $1::int AND NULLIF(BTRIM(hb.tckimlikno), '') IS NOT NULL
              ))
        ORDER BY t.tarih DESC NULLS LAST, t.id DESC;
      `,
      [fileId],
    )

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        tarih: row.tarih,
        adSoyad: row.ad_soyad,
        tcKimlikNo: row.tc_kimlik_no,
        kurum: row.kurum,
        yardimTuru: row.yardim_turu,
        aciklama: row.aciklama,
        miktar: row.miktar === null || row.miktar === undefined ? null : Number(row.miktar),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Diğer kurum yardımları alınamadı.' },
      { status: 500 },
    )
  }
}
