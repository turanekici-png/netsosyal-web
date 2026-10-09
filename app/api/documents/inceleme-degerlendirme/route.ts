import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, withAuditedPoolWrite } from '@/lib/db/auditContext'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { ensureIncelemeDegerlendirmeSchema } from './_lib/schema'
import { fetchAllSorularWithSecenekler } from './_lib/queries'
import { evaluateForm } from './_lib/scoring'
import { mapFormRow } from './_lib/mapRow'
import { normalizeBigInt, normalizeDate, normalizeInteger, normalizeText } from './_lib/normalize'
import type { DigerKurumYardimi, IncelemeDegerlendirmeFormPayload } from './_lib/types'

// Bu tablo (dosyalar/bireyler/yrd_* tablolarinin aksine) veritabani denetim
// (audit) trigger'i KURULU DEGIL - mevcut app/api/documents/inceleme-formu/
// route.ts ile ayni gerekce: formu olusturan oturum kullanicisini dogrudan
// bu tabloya (kullaniciid) yaziyoruz.
function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null
  return Number.isInteger(numericUserId) ? numericUserId : null
}

export const dynamic = 'force-dynamic'

function normalizeDigerKurumYardimlari(value: unknown): DigerKurumYardimi[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => ({
      kurum: normalizeText(item.kurum) ?? '',
      yardimTuru: normalizeText(item.yardimTuru) ?? undefined,
      tutar: typeof item.tutar === 'number' ? item.tutar : null,
    }))
    .filter((item) => item.kurum !== '')
}

export async function GET(request: NextRequest) {
  try {
    const dosyaid = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const result = await getSqlMonitorPool().query(
      `
        SELECT *
        FROM public.inceleme_degerlendirme_formu
        WHERE dosyaid = $1::bigint
        ORDER BY tarih DESC, id DESC;
      `,
      [dosyaid],
    )

    return NextResponse.json({ success: true, data: result.rows.map(mapFormRow) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Inceleme degerlendirme formlari alinamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.evaluation', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await request.json() as IncelemeDegerlendirmeFormPayload
    const dosyaid = normalizeBigInt(payload.dosyaid)
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id zorunludur.' }, { status: 400 })
    }
    if (!Array.isArray(payload.cevaplar) || payload.cevaplar.length === 0) {
      return NextResponse.json({ success: false, error: 'En az bir cevap gonderilmelidir.' }, { status: 400 })
    }

    await ensureIncelemeDegerlendirmeSchema()
    const sorular = await fetchAllSorularWithSecenekler()
    const haneKisiSayisi = normalizeInteger(payload.haneKisiSayisi)
    const sonuc = evaluateForm(payload.cevaplar, sorular, haneKisiSayisi)
    // Personel bos birakirsa karar araligina gore onerilen varsayilan
    // yardim turunu kullan (spesifikasyondaki "karar tablosu" onerileri).
    const yardimTuruOnerisi = normalizeText(payload.yardimTuruOnerisi) ?? sonuc.yardimTuruOnerisiOnerilen

    const currentUserId = getCurrentUserId(request)
    const pool = getSqlMonitorPool()

    const kaydedilenForm = await withAuditedPoolWrite(pool, async (client) => {
      const formResult = await client.query(
        `
          INSERT INTO public.inceleme_degerlendirme_formu (
            dosyaid, tarih, personel, tc_kimlik_no, ad_soyad, telefon, adres, il, ilce, koy, muhtar_adi,
            hane_kisi_sayisi, diger_kurum_yardimlari, toplam_puan, maksimum_puan, karar,
            yardim_turu_onerisi, eliminasyon_sonucu, eliminasyon_red_nedeni, onay_durumu,
            kullaniciid, olusturma_tarihi, guncelleme_tarihi
          )
          VALUES (
            $1::bigint, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12::integer, $13::jsonb, $14::smallint, $15::smallint, $16,
            $17, $18, $19, $20,
            $21, NOW(), NOW()
          )
          RETURNING *;
        `,
        [
          dosyaid,
          normalizeDate(payload.tarih),
          normalizeText(payload.personel),
          normalizeText(payload.tcKimlikNo),
          normalizeText(payload.adSoyad),
          normalizeText(payload.telefon),
          normalizeText(payload.adres),
          normalizeText(payload.il),
          normalizeText(payload.ilce),
          normalizeText(payload.koy),
          normalizeText(payload.muhtarAdi),
          haneKisiSayisi,
          JSON.stringify(normalizeDigerKurumYardimlari(payload.digerKurumYardimlari)),
          sonuc.toplamPuan,
          sonuc.maksimumPuan,
          sonuc.karar,
          yardimTuruOnerisi,
          sonuc.eliminasyonSonucu,
          sonuc.eliminasyonRedNedeni,
          sonuc.onayDurumu,
          currentUserId,
        ],
      )

      const form = formResult.rows[0]
      const formId = form.id

      for (const cevap of sonuc.cevapSonuclari) {
        await client.query(
          `
            INSERT INTO public.inceleme_form_cevaplar (
              form_id, soru_id, secilen_secenekler, metin_cevap, sayi_cevap, toplam_puan
            )
            VALUES ($1::bigint, $2::bigint, $3::integer[], $4, $5::numeric, $6::smallint)
            ON CONFLICT (form_id, soru_id) DO UPDATE SET
              secilen_secenekler = EXCLUDED.secilen_secenekler,
              metin_cevap = EXCLUDED.metin_cevap,
              sayi_cevap = EXCLUDED.sayi_cevap,
              toplam_puan = EXCLUDED.toplam_puan;
          `,
          [
            formId,
            cevap.soruId,
            cevap.secilenSecenekler && cevap.secilenSecenekler.length > 0 ? cevap.secilenSecenekler : null,
            cevap.metinCevap ?? null,
            cevap.sayiCevap ?? null,
            cevap.toplamPuan,
          ],
        )
      }

      // Kullanici istegi (13 Eylul 2026): "tahkikat raporu doldurup kaydet
      // butonuna basılınca ilgili dosyanın durumunu 2 yaparak sonuç bekleme
      // sayfasına göndersin" - Tahkikat Formu kaydedildiginde dosya, Güncelleme/
      // Sonuç Bekleme listesine (durumu = 2, bkz. app/api/workflow/guncelleme/
      // route.ts WHERE d.durumu = 2) otomatik gecirilir. Ayni desen, eski (artik
      // kullanilmayan) app/api/workflow/tahkikat/report/route.ts'de de vardi.
      await client.query(
        `
          UPDATE dosyalar
          SET
            durumu = 2,
            durumutarih = CURRENT_DATE,
            durumuaciklama = 'Tahkikat formu dolduruldu',
            kullaniciid = $2,
            islemtarihi = NOW()
          WHERE id = $1::bigint;
        `,
        [dosyaid, currentUserId],
      )

      // Kullanici istegi (13 Eylul 2026, devami): "tahkikat gorevlisinin
      // doldurmus oldugu rapor ozetini ilgili dosyanin Tahkikat ve Raporlar
      // alanindaki Ev Ziyareti alanini tarih, konu ve rapor seklinde yazsin,
      // bu alan sosyal yardim veritabanindaki evziyareti tablosunda olmasi
      // gerekiyor" - Dosya İşlemleri > Raporlar ve Tahkikatlar > "Ev Ziyareti
      // Formları" sekmesi (bkz. app/api/home-visits/route.ts) ve Sonuç
      // Bekleyen sayfasindaki "Son Ev Ziyareti" de AYNI evziyareti tablosunu
      // okuyor - Tahkikat Formu kaydedilince buraya da bir satir eklenir.
      const konu = sonuc.eliminasyonSonucu === 'RED'
        ? 'Tahkikat Raporu (Eleme: RED)'
        : `Tahkikat Raporu${sonuc.karar ? ` (${sonuc.karar})` : ''}`
      const rapor = normalizeText(payload.raporOzeti)
        ?? (sonuc.eliminasyonSonucu === 'RED'
          ? `Kriter değerlendirmesi sonucunda başvuru elenmiştir: ${sonuc.eliminasyonRedNedeni || ''}`
          : `Toplam puan ${sonuc.toplamPuan ?? 0}/${sonuc.maksimumPuan}, ${sonuc.karar ?? '-'}.`)

      await client.query(
        `
          INSERT INTO evziyareti (dosyaid, tarih, konu, rapor, kullaniciid, ilkkullaniciid, ilkislemtarihi, islemtarihi)
          VALUES ($1::bigint, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $5, NOW(), NOW());
        `,
        [dosyaid, normalizeDate(payload.tarih), konu, rapor, currentUserId],
      )

      return form
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: mapFormRow(kaydedilenForm) })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Inceleme degerlendirme formu kaydedilemedi.' },
      { status: 500 },
    )
  }
}
