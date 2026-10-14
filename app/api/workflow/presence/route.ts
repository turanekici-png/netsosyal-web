import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-10-14): Is Akisi listelerinde (Ön İnceleme /
// Tahkikat / Sonuç Bekleyen) bir kaydin rapor penceresi bir kullanicida
// ACIKKEN diger kullanicilar o satiri kirmizi ve "X bu rapor uzerinde
// calisiyor" uyarisiyla gorsun.
//
// Mekanizma: pencereyi acan istemci ~15 sn'de bir "tut" sinyali gonderir
// (son_sinyal guncellenir), kapatinca "birak" der. Sinyal SINYAL_SURESI_SN
// boyunca gelmezse (sekme kapandi / tarayici coktu / ag koptu) kayit
// KENDILIGINDEN dusmus sayilir - kalici kilit kalmaz. Bu bir UYARI
// mekanizmasidir, diger kullaniciyi engellemez.
//
// oturum_id: sekme basina rastgele kimlik - ayni kullanici iki sekmede
// ayni kaydi acarsa ikinci sekme de "baska bir oturum" olarak uyarilir.

const LISTELER = new Set(['on-inceleme', 'tahkikat', 'guncelleme'])
const SINYAL_SURESI_SN = 45

let tabloHazir: Promise<void> | null = null
function tabloyuHazirla() {
  if (!tabloHazir) {
    tabloHazir = (async () => {
      await getSqlMonitorPool().query(`
        CREATE TABLE IF NOT EXISTS public.is_akisi_calisma (
          dosyaid       BIGINT       NOT NULL,
          liste         VARCHAR(30)  NOT NULL,
          oturum_id     VARCHAR(64)  NOT NULL,
          kullaniciid   BIGINT,
          kullanici_adi TEXT,
          baslangic     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          son_sinyal    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          PRIMARY KEY (dosyaid, liste, oturum_id)
        );
      `)
      await getSqlMonitorPool().query(`CREATE INDEX IF NOT EXISTS is_akisi_calisma_liste_sinyal_idx ON public.is_akisi_calisma (liste, son_sinyal);`)
    })().catch((error) => {
      tabloHazir = null
      throw error
    })
  }
  return tabloHazir
}

function gecerliOturum(value: unknown) {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9-]{8,64}$/.test(text) ? text : null
}

function gecerliDosya(value: unknown) {
  const text = String(value ?? '').trim()
  return /^\d{1,18}$/.test(text) ? text : null
}

// GET ?liste=tahkikat -> o listede su an ACIK olan kayitlar
export async function GET(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })

    const liste = request.nextUrl.searchParams.get('liste') || ''
    if (!LISTELER.has(liste)) return NextResponse.json({ success: false, error: 'Geçersiz liste.' }, { status: 400 })

    await tabloyuHazirla()
    const pool = getSqlMonitorPool()
    // Cok eski (1 saatten fazla sinyalsiz) satirlari ara ara temizle.
    if (Math.random() < 0.05) {
      await pool.query(`DELETE FROM public.is_akisi_calisma WHERE son_sinyal < NOW() - INTERVAL '1 hour';`).catch(() => {})
    }
    const result = await pool.query<{ dosyaid: string; oturum_id: string; kullaniciid: string | null; kullanici_adi: string | null; baslangic: Date }>(
      `
        SELECT dosyaid::text AS dosyaid, oturum_id, kullaniciid::text AS kullaniciid, kullanici_adi, baslangic
        FROM public.is_akisi_calisma
        WHERE liste = $1 AND son_sinyal > NOW() - ($2::int * INTERVAL '1 second')
        ORDER BY baslangic ASC;
      `,
      [liste, SINYAL_SURESI_SN],
    )

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        fileId: row.dosyaid,
        sessionId: row.oturum_id,
        userId: row.kullaniciid,
        userName: row.kullanici_adi || 'Bir kullanıcı',
        since: row.baslangic instanceof Date ? row.baslangic.toISOString() : String(row.baslangic),
      })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message || 'Çalışma bilgisi alınamadı.' }, { status: 500 })
  }
}

// POST { islem: 'tut' | 'birak', dosyaId, liste, oturumId }
export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const islem = body.islem === 'birak' ? 'birak' : body.islem === 'tut' ? 'tut' : null
    const dosyaId = gecerliDosya(body.dosyaId)
    const liste = String(body.liste ?? '')
    const oturumId = gecerliOturum(body.oturumId)
    if (!islem || !dosyaId || !oturumId || !LISTELER.has(liste)) {
      return NextResponse.json({ success: false, error: 'Geçersiz istek.' }, { status: 400 })
    }

    await tabloyuHazirla()
    const pool = getSqlMonitorPool()
    if (islem === 'birak') {
      await pool.query(
        `DELETE FROM public.is_akisi_calisma WHERE dosyaid = $1::bigint AND liste = $2 AND oturum_id = $3;`,
        [dosyaId, liste, oturumId],
      )
    } else {
      const userId = /^\d+$/.test(String(sessionUser.id)) ? String(sessionUser.id) : null
      await pool.query(
        `
          INSERT INTO public.is_akisi_calisma (dosyaid, liste, oturum_id, kullaniciid, kullanici_adi, baslangic, son_sinyal)
          VALUES (
            $1::bigint, $2, $3, $4::bigint,
            (SELECT COALESCE(NULLIF(TRIM(k.kullanicitamadi), ''), NULLIF(TRIM(k.kullaniciadi), '')) FROM kullanicilar k WHERE k.id::text = $5 LIMIT 1),
            NOW(), NOW()
          )
          ON CONFLICT (dosyaid, liste, oturum_id)
          DO UPDATE SET son_sinyal = NOW(),
            -- uzun suredir sinyal yoksa (yeniden acilis) baslangic sifirlanir
            baslangic = CASE WHEN public.is_akisi_calisma.son_sinyal < NOW() - INTERVAL '${SINYAL_SURESI_SN} seconds' THEN NOW() ELSE public.is_akisi_calisma.baslangic END;
        `,
        [dosyaId, liste, oturumId, userId, userId ?? ''],
      )
    }

    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message || 'Çalışma bilgisi kaydedilemedi.' }, { status: 500 })
  }
}
