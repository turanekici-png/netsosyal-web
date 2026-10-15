import 'server-only'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

// Kullanici istegi (2026-10-15): "Performans Raporu - personelin yaptigi Ön
// İnceleme, Tahkikat ve Sonuç Bekleyen islemlerini günlük/haftalık/aylık/
// yıllık görelim; bunun icin veritabanina bir tablo ekleyip saklayalim."
//
// is_akisi_performans: her is akisi islemi icin BIR satir. Kaynak kayit
// (kaynak_tablo + kaynak_id) benzersizdir - hem islem aninda dogrudan
// (performansKaydet) hem de rapor acilirken kaynak tablolardan eksikler
// tamamlanarak (performansEsitle) yazilir; ayni islem iki kez sayilmaz.
// Kaynak kayit sonradan silinse de bu satir kalir (gecmis saklanir).

export type IslemTuru = 'on_inceleme' | 'tahkikat' | 'sonuc_bekleyen'

export const ISLEM_TURU_ADLARI: Record<IslemTuru, string> = {
  on_inceleme: 'Ön İnceleme',
  tahkikat: 'Tahkikat',
  sonuc_bekleyen: 'Sonuç Bekleyen',
}

let tabloHazir = false

export async function performansTablosunuHazirla() {
  if (tabloHazir) return
  const pool = getSqlMonitorPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.is_akisi_performans (
      id               BIGSERIAL PRIMARY KEY,
      islem_turu       VARCHAR(20) NOT NULL,
      dosyaid          BIGINT,
      kaynak_tablo     VARCHAR(40) NOT NULL,
      kaynak_id        BIGINT NOT NULL,
      kullaniciid      INTEGER,
      kullanici_adi    TEXT,
      ekip_kullaniciid INTEGER,
      sonuc            TEXT,
      islem_zamani     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kayit_zamani     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_is_akisi_performans_kaynak UNIQUE (kaynak_tablo, kaynak_id)
    );
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_is_akisi_performans_zaman ON public.is_akisi_performans (islem_zamani);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_is_akisi_performans_kullanici ON public.is_akisi_performans (kullaniciid, islem_turu);`)
  tabloHazir = true
}

// Islem aninda kayit - hata olursa asil islemi BOZMAZ (sadece loglanir);
// eksik kalan satir bir sonraki rapor acilisinda performansEsitle ile gelir.
export async function performansKaydet(kayit: {
  islemTuru: IslemTuru
  dosyaid: string | number | bigint | null
  kaynakTablo: string
  kaynakId: string | number | bigint | null | undefined
  kullaniciId: number | null
  ekipKullaniciId?: number | null
  sonuc?: string | null
}) {
  try {
    if (kayit.kaynakId === null || kayit.kaynakId === undefined) return
    await performansTablosunuHazirla()
    await getSqlMonitorPool().query(
      `
        INSERT INTO public.is_akisi_performans
          (islem_turu, dosyaid, kaynak_tablo, kaynak_id, kullaniciid, kullanici_adi, ekip_kullaniciid, sonuc)
        VALUES ($1, $2::bigint, $3, $4::bigint, $5,
          (SELECT NULLIF(TRIM(COALESCE(kullanicitamadi, kullaniciadi)), '') FROM public.kullanicilar WHERE id = $5),
          $6, $7)
        ON CONFLICT (kaynak_tablo, kaynak_id) DO NOTHING;
      `,
      [
        kayit.islemTuru,
        kayit.dosyaid === null ? null : String(kayit.dosyaid),
        kayit.kaynakTablo,
        String(kayit.kaynakId),
        kayit.kullaniciId,
        kayit.ekipKullaniciId ?? null,
        kayit.sonuc ?? null,
      ],
    )
  } catch (error) {
    console.error('[performans] kayit yazilamadi:', error instanceof Error ? error.message : error)
  }
}

// Kaynak tablolardan eksik satirlari tamamlar (gecmis kayitlar + bu kod
// devreye girmeden once yapilmis islemler). Idempotent (ON CONFLICT).
//  - Ön İnceleme   : on_inceleme_raporlari (tamami)
//  - Tahkikat      : saha_inceleme_formu (Hane Ziyareti formu, tamami)
//  - Sonuç Bekleyen: tahkikatraporlari'nda konusu "Komisyon Raporu" olanlar
//    (bu tablo eski sistemin binlerce farkli kaydini da tasidigi icin gecmis
//    yalnizca bu konuyla alinir; yeni islemler performansKaydet ile gelir).
export async function performansEsitle() {
  await performansTablosunuHazirla()
  const pool = getSqlMonitorPool()
  const adSql = (kolon: string) =>
    `(SELECT NULLIF(TRIM(COALESCE(k.kullanicitamadi, k.kullaniciadi)), '') FROM public.kullanicilar k WHERE k.id = ${kolon})`

  const onIncelemeVar = await pool.query(`SELECT to_regclass('public.on_inceleme_raporlari') IS NOT NULL AS var`)
  if (onIncelemeVar.rows[0]?.var) {
    await pool.query(`
      INSERT INTO public.is_akisi_performans (islem_turu, dosyaid, kaynak_tablo, kaynak_id, kullaniciid, kullanici_adi, sonuc, islem_zamani)
      SELECT 'on_inceleme', r.dosyaid, 'on_inceleme_raporlari', r.id, r.kullaniciid, ${adSql('r.kullaniciid')}, r.sonuc, r.ilkislemtarihi
      FROM public.on_inceleme_raporlari r
      ON CONFLICT (kaynak_tablo, kaynak_id) DO NOTHING;
    `)
  }

  const sahaVar = await pool.query(`SELECT to_regclass('public.saha_inceleme_formu') IS NOT NULL AS var`)
  if (sahaVar.rows[0]?.var) {
    await pool.query(`
      INSERT INTO public.is_akisi_performans (islem_turu, dosyaid, kaynak_tablo, kaynak_id, kullaniciid, kullanici_adi, sonuc, islem_zamani)
      SELECT 'tahkikat', f.dosyaid, 'saha_inceleme_formu', f.id, f.kullaniciid, ${adSql('f.kullaniciid')}, f.ziyaret_sonucu, f.olusturma_tarihi
      FROM public.saha_inceleme_formu f
      ON CONFLICT (kaynak_tablo, kaynak_id) DO NOTHING;
    `)
  }

  // tahkikatraporlari.ilkislemtarihi "timestamp without time zone" ve UTC
  // olarak yazilir (bkz. lib/db/pgTypeParsers.ts) -> AT TIME ZONE 'UTC'.
  await pool.query(`
    INSERT INTO public.is_akisi_performans (islem_turu, dosyaid, kaynak_tablo, kaynak_id, kullaniciid, kullanici_adi, islem_zamani)
    SELECT 'sonuc_bekleyen', t.dosyaid, 'tahkikatraporlari', t.id, COALESCE(t.ilkkullaniciid, t.kullaniciid),
           ${adSql('COALESCE(t.ilkkullaniciid, t.kullaniciid)')}, COALESCE(t.ilkislemtarihi, t.tarih::timestamp) AT TIME ZONE 'UTC'
    FROM public.tahkikatraporlari t
    WHERE t.konu = 'Komisyon Raporu'
    ON CONFLICT (kaynak_tablo, kaynak_id) DO NOTHING;
  `)
}
