import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { performansEsitle } from '@/lib/workflow/performans'

export const dynamic = 'force-dynamic'

// Performans Raporu (2026-10-15) - is_akisi_performans tablosundan
// donem (gun/hafta/ay/yil) x personel x islem turu sayilari. Gruplama
// Turkiye saatine gore yapilir; hafta Pazartesi baslar (date_trunc 'week').
const DONEMLER = { gun: 'day', hafta: 'week', ay: 'month', yil: 'year' } as const

function tarihMi(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export async function GET(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/performans' })
    if (accessDenied) return accessDenied

    const params = request.nextUrl.searchParams
    const donem = (params.get('donem') ?? 'gun') as keyof typeof DONEMLER
    const birim = DONEMLER[donem] ?? 'day'
    const baslangic = tarihMi(params.get('baslangic'))
    const bitis = tarihMi(params.get('bitis'))
    if (!baslangic || !bitis) {
      return NextResponse.json({ success: false, error: 'Başlangıç ve bitiş tarihi zorunludur.' }, { status: 400 })
    }

    // 2026-10-15: "detay" - bir personelin ve/veya bir donemin islem yaptigi
    // DOSYALARIN listesi (rapordaki satira tiklaninca altinda acilir).
    if (params.get('detay') === '1') {
      const degerler: unknown[] = [baslangic, bitis]
      const kosullar = [`(p.islem_zamani AT TIME ZONE 'Europe/Istanbul')::date BETWEEN $1::date AND $2::date`]
      const kullaniciId = params.get('kullaniciId')
      if (kullaniciId && /^\d+$/.test(kullaniciId)) {
        degerler.push(Number(kullaniciId))
        kosullar.push(`p.kullaniciid = $${degerler.length}`)
      } else if (params.get('kullaniciAdi')) {
        degerler.push(params.get('kullaniciAdi'))
        kosullar.push(`p.kullaniciid IS NULL AND p.kullanici_adi = $${degerler.length}`)
      }
      const donemBaslangici = tarihMi(params.get('donemBaslangici'))
      if (donemBaslangici) {
        degerler.push(donemBaslangici)
        kosullar.push(`date_trunc('${birim}', p.islem_zamani AT TIME ZONE 'Europe/Istanbul') = $${degerler.length}::timestamp`)
      }
      const turler = (params.get('turler') || '').split(',').filter((t) => ['on_inceleme', 'tahkikat', 'sonuc_bekleyen'].includes(t))
      if (turler.length > 0) {
        degerler.push(turler)
        kosullar.push(`p.islem_turu = ANY($${degerler.length}::text[])`)
      }
      const detay = await getSqlMonitorPool().query(
        `
          SELECT p.id::text AS id, p.islem_turu AS tur, p.islem_zamani AS zaman, p.sonuc,
                 p.dosyaid::text AS dosyaid, d.dosyano AS "dosyaNo",
                 COALESCE(NULLIF(TRIM(COALESCE(k.kullanicitamadi, k.kullaniciadi)), ''), p.kullanici_adi) AS personel,
                 sahip.ad AS "dosyaSahibi", d.mahalleadi AS mahalle
          FROM public.is_akisi_performans p
          LEFT JOIN public.dosyalar d ON d.id = p.dosyaid
          LEFT JOIN public.kullanicilar k ON k.id = p.kullaniciid
          LEFT JOIN LATERAL (
            SELECT COALESCE(NULLIF(BTRIM(b.adisoyadi), ''), NULLIF(BTRIM(CONCAT_WS(' ', b.adi, b.soyadi)), '')) AS ad
            FROM public.bireyler b
            WHERE b.dosyaid = p.dosyaid
            ORDER BY CASE WHEN b.tipi = 1 THEN 0 WHEN b.yakinligi = 0 THEN 1 ELSE 2 END, b.id
            LIMIT 1
          ) sahip ON TRUE
          WHERE ${kosullar.join(' AND ')}
          ORDER BY p.islem_zamani DESC
          LIMIT 1000;
        `,
        degerler,
      )
      return NextResponse.json({ success: true, data: detay.rows })
    }

    // Gecmis/eksik kayitlari kaynak tablolardan tamamla (idempotent)
    await performansEsitle()

    const result = await getSqlMonitorPool().query<{
      donem: string
      kullaniciid: number | null
      ad: string | null
      islem_turu: string
      adet: string
    }>(
      `
        SELECT
          to_char(date_trunc('${birim}', p.islem_zamani AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM-DD') AS donem,
          p.kullaniciid,
          COALESCE(NULLIF(TRIM(COALESCE(k.kullanicitamadi, k.kullaniciadi)), ''), p.kullanici_adi) AS ad,
          p.islem_turu,
          COUNT(*)::bigint AS adet
        FROM public.is_akisi_performans p
        LEFT JOIN public.kullanicilar k ON k.id = p.kullaniciid
        WHERE (p.islem_zamani AT TIME ZONE 'Europe/Istanbul')::date BETWEEN $1::date AND $2::date
        GROUP BY 1, 2, 3, 4
        ORDER BY 1 DESC;
      `,
      [baslangic, bitis],
    )

    const ilkKayit = await getSqlMonitorPool().query<{ ilk: string | null }>(
      `SELECT to_char(MIN(islem_zamani AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM-DD') AS ilk FROM public.is_akisi_performans;`,
    )

    return NextResponse.json({
      success: true,
      data: {
        donem,
        baslangic,
        bitis,
        ilkKayitTarihi: ilkKayit.rows[0]?.ilk ?? null,
        satirlar: result.rows.map((row) => ({
          donem: row.donem,
          kullaniciId: row.kullaniciid === null ? null : String(row.kullaniciid),
          ad: row.ad || (row.kullaniciid === null ? 'Bilinmiyor' : `Kullanıcı #${row.kullaniciid}`),
          tur: row.islem_turu,
          adet: Number(row.adet),
        })),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Performans raporu alınamadı.' },
      { status: 500 },
    )
  }
}
