import { NextRequest, NextResponse } from 'next/server'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

type AidMovementRow = {
  id: string
  kartno: string | null
  dosyaid: string | null
  firmatip: string | null
  firmaAdi: string | null
  yardimtip: string | null
  miktar: string | null
  tarih: string | null
}

function normalizeBigInt(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

export async function GET(request: NextRequest) {
  try {
    const dosyaId = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))

    if (!dosyaId) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    // firmaid -> mobil_kullanicilar.id: yardimin hangi bakkal/bufe/market'ten
    // alindigini gosteren gercek isyeri adi (firmaad) burada tutulur;
    // yardim_hareketleri.firmatip sadece genel kategoridir (ör. "bufe"),
    // isyerinin ADINI vermez.
    const result = await getSqlMonitorPool().query<AidMovementRow>(
      `
        SELECT t.id::text,
               t.kartno,
               t.dosyaid::text,
               COALESCE(NULLIF(BTRIM(t.firmatip), ''), 'Grup Belirtilmedi') AS firmatip,
               NULLIF(BTRIM(mk.firmaad), '') AS "firmaAdi",
               COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Yardım Türü Belirtilmedi') AS yardimtip,
               t.miktar::text,
               t.tarih
        FROM public.yardim_hareketleri t
        LEFT JOIN public.mobil_kullanicilar mk ON mk.id = t.firmaid
        WHERE t.dosyaid = $1::bigint
        ORDER BY
          COALESCE(NULLIF(BTRIM(t.firmatip), ''), 'Grup Belirtilmedi') ASC,
          COALESCE(NULLIF(BTRIM(t.yardimtip), ''), 'Yardım Türü Belirtilmedi') ASC,
          t.tarih DESC NULLS LAST,
          t.id DESC;
      `,
      [dosyaId],
    )

    return NextResponse.json({ success: true, data: result.rows })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Yardım hareketleri alınamadı.' },
      { status: 500 },
    )
  }
}
