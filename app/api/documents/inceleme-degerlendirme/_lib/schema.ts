import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { seedIncelemeFormSorulari } from './seed'

// Inceleme Formu v2 - eski "inceleme_formu" (app/api/documents/inceleme-formu)
// ile AYNI ISIM DEGIL, kasitli olarak "inceleme_degerlendirme_formu" adiyla
// paralel bir sema kuruyoruz (bkz. proje plani). Mevcut inceleme_formu
// tablosuna/route'una hic dokunulmuyor.
//
// Mevcut projedeki ensureIncelemeFormuTable() deseniyle ayni yaklasim:
// route handler'larin en basinda cagrilir, IF NOT EXISTS ile idempotent
// calisir, ayrica bir migration dizini/araci gerektirmez.
let schemaEnsured = false

export async function ensureIncelemeDegerlendirmeSchema() {
  if (schemaEnsured) return
  const pool = getSqlMonitorPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.inceleme_form_soru (
      id                BIGSERIAL PRIMARY KEY,
      bolum             VARCHAR(20) NOT NULL CHECK (bolum IN ('bilgi','kriter','degerlendirme','gozlem')),
      sira              SMALLINT NOT NULL DEFAULT 0,
      soru_metni        TEXT NOT NULL,
      secim_turu        VARCHAR(10) NOT NULL CHECK (secim_turu IN ('tek','coklu','metin','sayi')),
      zorunlu           BOOLEAN NOT NULL DEFAULT false,
      aktif             BOOLEAN NOT NULL DEFAULT true,
      red_kriteri       BOOLEAN NOT NULL DEFAULT false,
      red_secenegi      VARCHAR(200),
      sistem_sorusu     BOOLEAN NOT NULL DEFAULT false,
      puanlama_kurali   VARCHAR(30),
      olusturma_tarihi  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ind_inceleme_form_soru_bolum ON public.inceleme_form_soru (bolum, sira);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.inceleme_form_secenekler (
      id              BIGSERIAL PRIMARY KEY,
      soru_id         BIGINT NOT NULL REFERENCES public.inceleme_form_soru(id) ON DELETE CASCADE,
      sira            SMALLINT NOT NULL DEFAULT 0,
      secenek_metni   TEXT NOT NULL,
      puan            SMALLINT NOT NULL DEFAULT 0,
      red_tetikler    BOOLEAN NOT NULL DEFAULT false,
      yonetici_onayi  BOOLEAN NOT NULL DEFAULT false,
      aktif           BOOLEAN NOT NULL DEFAULT true
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ind_inceleme_form_secenekler_soru ON public.inceleme_form_secenekler (soru_id, sira);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.inceleme_degerlendirme_formu (
      id                      BIGSERIAL PRIMARY KEY,
      dosyaid                 BIGINT NOT NULL,
      tarih                   DATE NOT NULL DEFAULT CURRENT_DATE,
      personel                TEXT,
      tc_kimlik_no            TEXT,
      ad_soyad                TEXT,
      telefon                 TEXT,
      adres                   TEXT,
      il                      TEXT,
      ilce                    TEXT,
      koy                     TEXT,
      muhtar_adi              TEXT,
      hane_kisi_sayisi        INTEGER,
      diger_kurum_yardimlari  JSONB NOT NULL DEFAULT '[]'::jsonb,
      toplam_puan             SMALLINT,
      maksimum_puan           SMALLINT NOT NULL DEFAULT 100,
      karar                   VARCHAR(30),
      yardim_turu_onerisi     TEXT,
      eliminasyon_sonucu      VARCHAR(10) CHECK (eliminasyon_sonucu IN ('KABUL','RED')),
      eliminasyon_red_nedeni  TEXT,
      onay_durumu             VARCHAR(20) NOT NULL DEFAULT 'onay_gerekmiyor',
      onay_notu               TEXT,
      kullaniciid             INTEGER,
      olusturma_tarihi        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme_tarihi       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  // Tablo daha once (bu kolonlar eklenmeden once) olusturulmus olabilir -
  // CREATE TABLE IF NOT EXISTS bu durumda kolonlari eklemez, ayrica ALTER gerekir.
  await pool.query(`
    ALTER TABLE public.inceleme_degerlendirme_formu ADD COLUMN IF NOT EXISTS hane_kisi_sayisi INTEGER;
  `)
  // Kullanici istegi (13 Eylul 2026): "Kişi Bilgileri" alani TC/Ad Soyad/
  // Telefon/Adres'e sadelestirildi - Ad Soyad ve Adres, dosyadan otomatik
  // cekilip formun kendi satirina da (o anki halinin arsivlenmesi icin)
  // kaydediliyor.
  await pool.query(`
    ALTER TABLE public.inceleme_degerlendirme_formu ADD COLUMN IF NOT EXISTS ad_soyad TEXT;
  `)
  await pool.query(`
    ALTER TABLE public.inceleme_degerlendirme_formu ADD COLUMN IF NOT EXISTS adres TEXT;
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ind_inceleme_degerlendirme_dosyaid ON public.inceleme_degerlendirme_formu (dosyaid);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ind_inceleme_degerlendirme_onay ON public.inceleme_degerlendirme_formu (onay_durumu);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.inceleme_form_cevaplar (
      id                  BIGSERIAL PRIMARY KEY,
      form_id             BIGINT NOT NULL REFERENCES public.inceleme_degerlendirme_formu(id) ON DELETE CASCADE,
      soru_id             BIGINT NOT NULL REFERENCES public.inceleme_form_soru(id),
      secilen_secenekler  INTEGER[],
      metin_cevap         TEXT,
      sayi_cevap          NUMERIC(14,2),
      toplam_puan         SMALLINT
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ind_inceleme_form_cevaplar_form ON public.inceleme_form_cevaplar (form_id);
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_inceleme_form_cevaplar_form_soru ON public.inceleme_form_cevaplar (form_id, soru_id);
  `)

  await seedIncelemeFormSorulari(pool)

  schemaEnsured = true
}
