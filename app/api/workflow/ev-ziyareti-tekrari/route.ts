import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { etkinKimlik } from '@/lib/auth/tahkikatEkip'
import { performansKaydet } from '@/lib/workflow/performans'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureSahaIncelemeSchema } from '@/app/api/documents/saha-inceleme/_lib/sablon'
import { aktifEvZiyaretiTekrarlari, evZiyaretiTekrarTablosunuHazirla } from '@/lib/workflow/evZiyaretiTekrar'

export const dynamic = 'force-dynamic'

// Ev Ziyareti Tekrarı (2026-10-15) - bkz. lib/workflow/evZiyaretiTekrar.ts
//  GET  ?fileId=  -> dosyanin aktif tekrar uyarisi (Tahkikat form sekmesi icin)
//  POST           -> Sonuç Bekleyen'deki dosyayi tahkikata geri gonderir

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function cleanId(value: unknown) {
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? text : null
}

export async function GET(request: NextRequest) {
  try {
    const fileId = cleanId(request.nextUrl.searchParams.get('fileId'))
    if (!fileId) return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    const uyarilar = await aktifEvZiyaretiTekrarlari([fileId])
    return NextResponse.json({ success: true, data: uyarilar.get(fileId) ?? null })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Ev ziyareti tekrar bilgisi alınamadı.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/guncelleme' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanId(payload.fileId)
    const konu = cleanText(payload.title, 200)
    const rapor = cleanText(payload.content, 10000)
    if (!fileId || !konu || !rapor) {
      return NextResponse.json({ success: false, error: 'Konu ve rapor alanları zorunludur.' }, { status: 400 })
    }

    await ensureSahaIncelemeSchema()
    await evZiyaretiTekrarTablosunuHazirla()
    const kimlik = await etkinKimlik(await getSessionUser(), request.cookies)
    const kullaniciId = kimlik.kullaniciId

    const sonuc = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const dosya = await client.query<{ durumu: number | null }>(
        `SELECT durumu FROM dosyalar WHERE id = $1::bigint FOR UPDATE;`,
        [fileId],
      )
      if (dosya.rows.length === 0) throw new Error('Dosya bulunamadı.')
      if (Number(dosya.rows[0].durumu) !== 2) {
        throw new Error('Dosya artık Sonuç Bekleyen aşamasında değil (başka biri işlem yapmış olabilir).')
      }

      // Son ev ziyareti: en son Hane Ziyareti formu; yoksa en son Ev Ziyareti raporu
      const sonForm = await client.query<{ tarih: string | null; personel: string | null; sonuc: string | null }>(
        `
          SELECT TO_CHAR(f.tarih, 'YYYY-MM-DD') AS tarih,
                 COALESCE(NULLIF(BTRIM(f.personel), ''), NULLIF(BTRIM(k.kullanicitamadi), ''), NULLIF(BTRIM(k.kullaniciadi), '')) AS personel,
                 NULLIF(BTRIM(f.ziyaret_sonucu), '') AS sonuc
          FROM public.saha_inceleme_formu f
          LEFT JOIN kullanicilar k ON k.id::text = f.kullaniciid::text
          WHERE f.dosyaid = $1::bigint
          ORDER BY f.tarih DESC NULLS LAST, f.id DESC
          LIMIT 1;
        `,
        [fileId],
      )
      let sonZiyaret = sonForm.rows[0] ?? null
      if (!sonZiyaret) {
        const sonEv = await client.query<{ tarih: string | null; personel: string | null; sonuc: string | null }>(
          `
            SELECT TO_CHAR(v.tarih, 'YYYY-MM-DD') AS tarih,
                   COALESCE(NULLIF(BTRIM(k.kullanicitamadi), ''), NULLIF(BTRIM(k.kullaniciadi), '')) AS personel,
                   NULLIF(BTRIM(v.konu), '') AS sonuc
            FROM evziyareti v
            LEFT JOIN kullanicilar k ON k.id::text = v.kullaniciid::text
            WHERE v.dosyaid = $1::bigint
            ORDER BY v.tarih DESC NULLS LAST, v.id DESC
            LIMIT 1;
          `,
          [fileId],
        )
        sonZiyaret = sonEv.rows[0] ?? null
      }

      // Rapor Dosya Yönetimi > Raporlar ve Tahkikatlar'a (tahkikatraporlari) yazilir
      const raporKaydi = await client.query<{ id: string }>(
        `
          INSERT INTO public.tahkikatraporlari (dosyaid, tarih, konu, rapor, kullaniciid, ilkkullaniciid, ilkislemtarihi, islemtarihi)
          VALUES ($1::bigint, CURRENT_DATE, $2, $3, $4, $4, NOW(), NOW())
          RETURNING id::text AS id;
        `,
        [fileId, konu, rapor, kullaniciId],
      )

      // Onceki aktif uyari (varsa) yenisiyle degisir
      await client.query(
        `UPDATE public.ev_ziyareti_tekrar SET kapanma_tarihi = NOW() WHERE dosyaid = $1::bigint AND kapanma_tarihi IS NULL;`,
        [fileId],
      )
      const tekrarKaydi = await client.query<{ id: string }>(
        `
          INSERT INTO public.ev_ziyareti_tekrar
            (dosyaid, tahkikatrapor_id, konu, rapor, son_ziyaret_tarihi, son_ziyaret_personeli, son_ziyaret_sonucu,
             isteyen_kullaniciid, isteyen_kullanici_adi)
          VALUES ($1::bigint, $2::bigint, $3, $4, $5::date, $6, $7, $8::int,
            (SELECT COALESCE(NULLIF(BTRIM(kullanicitamadi), ''), NULLIF(BTRIM(kullaniciadi), '')) FROM kullanicilar WHERE id = $8::int))
          RETURNING id::text AS id;
        `,
        [
          fileId,
          raporKaydi.rows[0]?.id ?? null,
          konu,
          rapor,
          sonZiyaret?.tarih ?? null,
          sonZiyaret?.personel ?? null,
          sonZiyaret?.sonuc ?? null,
          kullaniciId,
        ],
      )

      // Dosya tekrar Tahkikat'a duser
      await client.query(
        `
          UPDATE dosyalar
          SET durumu = 1, durumutarih = CURRENT_DATE, durumuaciklama = $2,
              kullaniciid = $3, islemtarihi = NOW()
          WHERE id = $1::bigint;
        `,
        [fileId, `Ev ziyareti tekrarı: ${konu}`.slice(0, 100), kullaniciId],
      )

      return { raporId: raporKaydi.rows[0]?.id ?? null, tekrarId: tekrarKaydi.rows[0]?.id ?? null }
    }, getAuditMetaFromRequest(request))

    // 2026-10-15: Performans Raporu - Sonuç Bekleyen islemi olarak sayilir
    // (kaynak ev_ziyareti_tekrar; komisyon raporu listesine karismaz)
    await performansKaydet({
      islemTuru: 'sonuc_bekleyen',
      dosyaid: fileId,
      kaynakTablo: 'ev_ziyareti_tekrar',
      kaynakId: sonuc.tekrarId,
      kullaniciId,
      ekipKullaniciId: kimlik.ekipKullaniciId,
      sonuc: `Ev Ziyareti Tekrarı: ${konu}`.slice(0, 200),
    })

    return NextResponse.json({ success: true, data: { fileId, raporId: sonuc.raporId, nextStatus: 1 } }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Ev ziyareti tekrarı kaydedilemedi.' },
      { status: 500 },
    )
  }
}
