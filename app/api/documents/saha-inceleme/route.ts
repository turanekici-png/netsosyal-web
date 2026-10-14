import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { ensureSahaIncelemeSchema, sablonuGetir } from './_lib/sablon'
import { kayitOzetiniEsle, normalizeBigInt, type FormSatiri } from './_lib/kayit'
import { evZiyaretiKonusu, kayitAlanlariniHazirla, type KaydetPayload } from './_lib/kaydet'
import { dosyaNitelikleriniIsle } from './_lib/dosyaNitelikleri'

export const dynamic = 'force-dynamic'

// Bu tabloda (dosyalar/bireyler/yrd_* aksine) audit trigger'i yok - formu
// kaydeden kullanici dogrudan kullaniciid kolonuna yazilir (eski Tahkikat
// Formu ile ayni gerekce).
function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null
  return Number.isInteger(numericUserId) ? numericUserId : null
}

const LISTE_KOLONLARI = `
  id::text AS id, dosyaid::text AS dosyaid, dosya_no, tarih::text AS tarih, personel, ad_soyad,
  ziyaret_sonucu, aciliyet, oncelikli_ihtiyac, on_degerlendirme, ozet, personel_aciklamasi, personel_raporu, kullaniciid, olusturma_tarihi,
  evziyareti_id::text AS evziyareti_id
`

export async function GET(request: NextRequest) {
  try {
    const dosyaid = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    await ensureSahaIncelemeSchema()
    const result = await getSqlMonitorPool().query<FormSatiri>(
      `SELECT ${LISTE_KOLONLARI} FROM public.saha_inceleme_formu WHERE dosyaid = $1::bigint ORDER BY tarih DESC, id DESC;`,
      [dosyaid],
    )
    return NextResponse.json({ success: true, data: result.rows.map(kayitOzetiniEsle) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'İnceleme formları alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as KaydetPayload
    const dosyaid = normalizeBigInt(payload.dosyaid)
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id zorunludur.' }, { status: 400 })
    }

    await ensureSahaIncelemeSchema()
    // Kayitta SUNUCUDAKI guncel (aktif) sablon esas alinir ve kayda kopyasi
    // yazilir - sonradan Ayarlar'dan soru silinse de bu kayit eksiksiz kalir.
    const sablon = await sablonuGetir(false)
    const a = kayitAlanlariniHazirla(sablon, payload)
    if (a.hata !== null) return NextResponse.json({ success: false, error: a.hata }, { status: 400 })

    const currentUserId = getCurrentUserId(request)
    const pool = getSqlMonitorPool()

    const kayit = await withAuditedPoolWrite(pool, async (client) => {
      const dosya = await client.query<{ dosyano: string | null }>(`SELECT dosyano FROM dosyalar WHERE id = $1::bigint;`, [dosyaid])
      if (dosya.rows.length === 0) throw new Error('Dosya bulunamadı.')

      // Kisa ozet / birlesik rapor Dosya İşlemleri > Ev Ziyareti Formları'na
      // yazilir (Sonuç Bekleyen ekranindaki "Son Ev Ziyareti" de bunu okur).
      // Satirin id'si forma saklanir - form guncellenince ayni satir guncellenir.
      const ev = await client.query<{ id: string }>(
        `
          INSERT INTO evziyareti (dosyaid, tarih, konu, rapor, kullaniciid, ilkkullaniciid, ilkislemtarihi, islemtarihi)
          VALUES ($1::bigint, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $5, NOW(), NOW())
          RETURNING id::text AS id;
        `,
        [
          dosyaid,
          a.tarih,
          evZiyaretiKonusu(a.aciliyet),
          a.evZiyaretiRaporu,
          currentUserId,
        ],
      )

      const result = await client.query<FormSatiri>(
        `
          INSERT INTO public.saha_inceleme_formu (
            dosyaid, dosya_no, tarih, personel, ad_soyad, tc_kimlik_no, telefon, adres,
            ziyaret_sonucu, aciliyet, oncelikli_ihtiyac, on_degerlendirme, ozet,
            cevaplar, sablon, kullaniciid, personel_aciklamasi, personel_raporu, evziyareti_id
          )
          VALUES (
            $1::bigint, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19::bigint
          )
          RETURNING ${LISTE_KOLONLARI};
        `,
        [
          dosyaid,
          dosya.rows[0].dosyano,
          a.tarih,
          a.personel,
          a.adSoyad,
          a.tcKimlikNo,
          a.telefon,
          a.adres,
          a.ziyaretSonucu,
          a.aciliyet,
          a.oncelikliIhtiyac,
          a.onDegerlendirme,
          a.ozet,
          JSON.stringify(a.cevaplar),
          JSON.stringify(sablon),
          currentUserId,
          a.personelAciklamasi,
          a.personelRaporu,
          ev.rows[0]?.id ?? null,
        ],
      )

      // Onceki Tahkikat Formu ile ayni akis: form kaydedilince dosya Sonuç
      // Bekleyen listesine (durumu = 2) gecer.
      await client.query(
        `
          UPDATE dosyalar
          SET durumu = 2, durumutarih = CURRENT_DATE, durumuaciklama = 'Tahkikat formu dolduruldu',
              kullaniciid = $2, islemtarihi = NOW()
          WHERE id = $1::bigint;
        `,
        [dosyaid, currentUserId],
      )

      // 2026-10-14: formdaki aile niteligi / yardim onceligi dosyaya da islenir
      await dosyaNitelikleriniIsle(client, String(dosyaid), sablon, a.cevaplar)

      return result.rows[0]
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: kayitOzetiniEsle(kayit) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'İnceleme formu kaydedilemedi.' },
      { status: 500 },
    )
  }
}
