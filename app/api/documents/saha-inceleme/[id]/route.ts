import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { ensureSahaIncelemeSchema } from '../_lib/sablon'
import { kayitDetayiniEsle, kayitOzetiniEsle, normalizeBigInt, type FormSatiri } from '../_lib/kayit'
import { evZiyaretiKonusu, kayitAlanlariniHazirla, type KaydetPayload } from '../_lib/kaydet'
import { dosyaNitelikleriniIsle } from '../_lib/dosyaNitelikleri'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import type { Sablon } from '@/lib/constants/sahaIncelemeForm'

export const dynamic = 'force-dynamic'

type Params = { id: string }

export async function GET(_request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const formId = normalizeBigInt((await params).id)
    if (!formId) return NextResponse.json({ success: false, error: 'Geçersiz form id.' }, { status: 400 })

    await ensureSahaIncelemeSchema()
    const result = await getSqlMonitorPool().query<FormSatiri>(
      `SELECT *, id::text AS id, dosyaid::text AS dosyaid, tarih::text AS tarih FROM public.saha_inceleme_formu WHERE id = $1::bigint;`,
      [formId],
    )
    if (result.rows.length === 0) return NextResponse.json({ success: false, error: 'Form bulunamadı.' }, { status: 404 })
    return NextResponse.json({ success: true, data: kayitDetayiniEsle(result.rows[0]) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form detayı alınamadı.' },
      { status: 500 },
    )
  }
}

// Kayitli formu duzenleme (2026-10-13 kullanici istegi: "daha once
// doldurulmus bir alanda degisiklik yapilabilsin, Guncelle butonuyla
// kaydedelim"). Kaydin KENDI sablon kopyasi esas alinir (form o sablonla
// doldurulmustu); dosya durumu degistirilmez, Ev Ziyareti'ndeki ilgili satir
// da yeni rapor/konu ile guncellenir.
export async function PUT(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const formId = normalizeBigInt((await params).id)
    if (!formId) return NextResponse.json({ success: false, error: 'Geçersiz form id.' }, { status: 400 })

    await ensureSahaIncelemeSchema()
    const pool = getSqlMonitorPool()
    const mevcut = await pool.query<{ dosyaid: string; sablon: Sablon; evziyareti_id: string | null; personel_aciklamasi: string | null; ozet: string | null; tarih_tr: string | null }>(
      `SELECT dosyaid::text AS dosyaid, sablon, evziyareti_id::text AS evziyareti_id, personel_aciklamasi, ozet, to_char(tarih, 'DD.MM.YYYY') AS tarih_tr FROM public.saha_inceleme_formu WHERE id = $1::bigint;`,
      [formId],
    )
    const eski = mevcut.rows[0]
    if (!eski) return NextResponse.json({ success: false, error: 'Form bulunamadı.' }, { status: 404 })

    const a = kayitAlanlariniHazirla(eski.sablon, await request.json() as KaydetPayload, eski.tarih_tr)
    if (a.hata !== null) return NextResponse.json({ success: false, error: a.hata }, { status: 400 })

    const userId = parseSessionValue(readSessionCookie(request.cookies))
    const currentUserId = userId && Number.isInteger(Number(userId)) ? Number(userId) : null

    const kayit = await withAuditedPoolWrite(pool, async (client) => {
      const result = await client.query<FormSatiri>(
        `
          UPDATE public.saha_inceleme_formu SET
            tarih = COALESCE($2::date, tarih), personel = $3, ad_soyad = $4, tc_kimlik_no = $5, telefon = $6, adres = $7,
            ziyaret_sonucu = $8, aciliyet = $9, oncelikli_ihtiyac = $10, on_degerlendirme = $11, ozet = $12,
            cevaplar = $13::jsonb, personel_aciklamasi = $14, personel_raporu = $15, guncelleme_tarihi = NOW()
          WHERE id = $1::bigint
          RETURNING *, id::text AS id, dosyaid::text AS dosyaid, tarih::text AS tarih;
        `,
        [
          formId, a.tarih, a.personel, a.adSoyad, a.tcKimlikNo, a.telefon, a.adres,
          a.ziyaretSonucu, a.aciliyet, a.oncelikliIhtiyac, a.onDegerlendirme, a.ozet,
          JSON.stringify(a.cevaplar), a.personelAciklamasi, a.personelRaporu,
        ],
      )

      // Ev Ziyareti satiri: id'si biliniyorsa o; eski kayitlarda (id tutulmadan
      // once kaydedilenler) ayni dosyadaki, eski rapor metniyle eslesen son satir.
      let evId = eski.evziyareti_id
      if (!evId) {
        const eslesen = await client.query<{ id: string }>(
          `
            SELECT id::text AS id FROM evziyareti
            WHERE dosyaid = $1::bigint AND konu LIKE 'Hane Ziyareti ve Sosyal İnceleme%'
              AND rapor IN ($2, $3)
            ORDER BY id DESC LIMIT 1;
          `,
          [eski.dosyaid, eski.personel_aciklamasi ?? '', eski.ozet ?? ''],
        )
        evId = eslesen.rows[0]?.id ?? null
      }
      if (evId) {
        await client.query(
          `
            UPDATE evziyareti SET tarih = COALESCE($2::date, tarih), konu = $3, rapor = $4, kullaniciid = $5, islemtarihi = NOW()
            WHERE id = $1::bigint;
          `,
          [evId, a.tarih, evZiyaretiKonusu(a.aciliyet), a.evZiyaretiRaporu, currentUserId],
        )
        if (!eski.evziyareti_id) {
          await client.query(`UPDATE public.saha_inceleme_formu SET evziyareti_id = $2::bigint WHERE id = $1::bigint;`, [formId, evId])
        }
      }

      // 2026-10-14: aile niteligi / yardim onceligi dosyaya islenir - yalniz
      // dosyanin EN SON formu duzenleniyorsa (eski form, guncel bilgiyi ezmesin).
      const enSon = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM public.saha_inceleme_formu WHERE dosyaid = $1::bigint ORDER BY tarih DESC, id DESC LIMIT 1;`,
        [eski.dosyaid],
      )
      if (enSon.rows[0]?.id === String(formId)) {
        await dosyaNitelikleriniIsle(client, eski.dosyaid, eski.sablon, a.cevaplar)
      }
      return result.rows[0]
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: kayitOzetiniEsle(kayit) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'İnceleme formu güncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const formId = normalizeBigInt((await params).id)
    if (!formId) return NextResponse.json({ success: false, error: 'Geçersiz form id.' }, { status: 400 })

    await ensureSahaIncelemeSchema()
    const silinen = await withAuditedPoolWrite(getSqlMonitorPool(), async (client) => {
      const result = await client.query(`DELETE FROM public.saha_inceleme_formu WHERE id = $1::bigint;`, [formId])
      return result.rowCount ?? 0
    }, getAuditMetaFromRequest(request))

    if (silinen === 0) return NextResponse.json({ success: false, error: 'Form bulunamadı.' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Form silinemedi.' },
      { status: 500 },
    )
  }
}
