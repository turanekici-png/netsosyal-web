import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'

export const dynamic = 'force-dynamic'

// 2026-10-15: Sonuç Bekleyen > Dosya Sahibi > "Hane Bireyleri" penceresi.
// Salt okunur; kodlu alanlar (yakınlık, cinsiyet, medeni hal, sağlık)
// Hazır Değerler'den çözülür (koda gömülmez).
export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const fileId = String(request.nextUrl.searchParams.get('fileId') ?? '').trim()
    if (!/^\d+$/.test(fileId)) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const [result, hazir] = await Promise.all([
      getSqlMonitorPool().query<{
        id: string
        ad_soyad: string | null
        tc: string | null
        yakinligi: number | null
        cinsiyeti: string | null
        medenihali: number | null
        dogum: string | null
        yas: number | null
        telefon: string | null
        saglikdurumu: number | null
        hastalikadi: string | null
        meslegi: string | null
        aylikgeliri: number | null
        olumtarihi: string | null
        tipi: number | null
      }>(
        `
          SELECT b.id::text AS id,
                 COALESCE(NULLIF(BTRIM(b.adisoyadi), ''), NULLIF(BTRIM(CONCAT_WS(' ', b.adi, b.soyadi)), '')) AS ad_soyad,
                 NULLIF(BTRIM(b.tckimlikno), '') AS tc, b.yakinligi, NULLIF(BTRIM(b.cinsiyeti), '') AS cinsiyeti, b.medenihali,
                 TO_CHAR(b.dogumtarihi, 'DD.MM.YYYY') AS dogum,
                 EXTRACT(YEAR FROM AGE(CURRENT_DATE, b.dogumtarihi))::int AS yas,
                 NULLIF(BTRIM(b.ceptel), '') AS telefon, b.saglikdurumu, NULLIF(BTRIM(b.hastalikadi), '') AS hastalikadi,
                 NULLIF(BTRIM(b.meslegi), '') AS meslegi, b.aylikgeliri,
                 NULLIF(NULLIF(BTRIM(b.olumtarihi), ''), '-') AS olumtarihi, b.tipi
          FROM bireyler b
          WHERE b.dosyaid = $1::bigint
          ORDER BY CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END, b.dogumtarihi ASC NULLS LAST, b.id ASC;
        `,
        [fileId],
      ),
      predefinedValuesService.getAll(),
    ])

    const ad = (kategori: string, kod: unknown) => {
      if (kod === null || kod === undefined || String(kod).trim() === '') return null
      const liste = (hazir.values as Record<string, Array<{ id: string; name: string }>>)[kategori] ?? []
      return liste.find((item) => String(item.id) === String(kod).trim())?.name ?? String(kod)
    }

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        adSoyad: row.ad_soyad,
        tcKimlikNo: row.tc,
        yakinlik: ad('relationship', row.yakinligi),
        basvuruSahibi: row.tipi === 1 || row.yakinligi === 0,
        cinsiyet: ad('gender', row.cinsiyeti),
        medeniHal: ad('maritalStatus', row.medenihali),
        dogumTarihi: row.dogum,
        yas: row.yas,
        telefon: row.telefon,
        saglik: ad('healthStatus', row.saglikdurumu),
        hastalik: row.hastalikadi,
        meslek: row.meslegi,
        aylikGelir: row.aylikgeliri === null ? null : Number(row.aylikgeliri),
        vefat: Boolean(row.olumtarihi),
        olumTarihi: row.olumtarihi,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Hane bireyleri alınamadı.' },
      { status: 500 },
    )
  }
}
