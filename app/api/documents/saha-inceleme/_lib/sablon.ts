import type { PoolClient } from 'pg'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import {
  VARSAYILAN_BOLUMLER,
  VARSAYILAN_FORM_AYARLARI,
  type Bolum,
  type FormAyarlari,
  type OtomatikDolum,
  type RaporAnahtari,
  type Sablon,
  type Secenek,
  type Soru,
  type SoruTuru,
  type TabloSutunu,
} from '@/lib/constants/sahaIncelemeForm'

// Hane Ziyareti ve Sosyal Inceleme Formu - sema + sablon (bolum/soru/ayar)
// okuma-yazma. Eski "inceleme_degerlendirme_formu" (puanlamali v2) ile
// AYNI tablolari KULLANMAZ: yeni form paralel tablolarda kuruldu ki 3001'de
// denenirken canlidaki eski form bozulmasin (ikisi ayni veritabanini
// kullaniyor). Desen, projedeki diger ensure*Schema() fonksiyonlariyla
// ayni: route'larin basinda cagrilir, IF NOT EXISTS ile idempotent.

const GECERLI_TURLER: SoruTuru[] = ['metin', 'uzun_metin', 'sayi', 'tarih', 'tarih_saat', 'tek', 'coklu', 'tablo', 'imza']
const GECERLI_OTOMATIK: OtomatikDolum[] = ['basvuru_sahibi', 'tc_kimlik_no', 'telefon', 'adres', 'personel', 'ziyaret_zamani', 'hane_kisi_sayisi', 'hane_uyeleri']
const GECERLI_ANAHTAR: RaporAnahtari[] = ['ziyaret_sonucu', 'aciliyet', 'oncelikli_ihtiyac', 'on_degerlendirme', 'konut_durumu', 'toplam_gelir', 'aile_niteligi', 'yardim_onceligi']
const AYAR_ANAHTARLARI = Object.keys(VARSAYILAN_FORM_AYARLARI) as (keyof FormAyarlari)[]

let semaHazir = false

export async function ensureSahaIncelemeSchema() {
  if (semaHazir) return
  const pool = getSqlMonitorPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.saha_inceleme_bolum (
      id        BIGSERIAL PRIMARY KEY,
      sira      INTEGER NOT NULL DEFAULT 0,
      baslik    TEXT NOT NULL,
      aciklama  TEXT,
      aktif     BOOLEAN NOT NULL DEFAULT true
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.saha_inceleme_soru (
      id                BIGSERIAL PRIMARY KEY,
      bolum_id          BIGINT NOT NULL REFERENCES public.saha_inceleme_bolum(id) ON DELETE CASCADE,
      sira              INTEGER NOT NULL DEFAULT 0,
      soru_metni        TEXT NOT NULL,
      tur               VARCHAR(20) NOT NULL,
      zorunlu           BOOLEAN NOT NULL DEFAULT false,
      aktif             BOOLEAN NOT NULL DEFAULT true,
      ipucu             TEXT,
      secenekler        JSONB NOT NULL DEFAULT '[]'::jsonb,
      sutunlar          JSONB NOT NULL DEFAULT '[]'::jsonb,
      sabit_satirlar    JSONB NOT NULL DEFAULT '[]'::jsonb,
      bos_satir_sayisi  INTEGER NOT NULL DEFAULT 3,
      otomatik          VARCHAR(30),
      anahtar           VARCHAR(40)
    );
  `)
  // 2026-10-14: uzun metin alaninin yuksekligi (satir; NULL = otomatik)
  await pool.query(`ALTER TABLE public.saha_inceleme_soru ADD COLUMN IF NOT EXISTS yukseklik INTEGER;`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_saha_inceleme_soru_bolum ON public.saha_inceleme_soru (bolum_id, sira);`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.saha_inceleme_ayar (
      anahtar  VARCHAR(40) PRIMARY KEY,
      deger    TEXT
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.saha_inceleme_formu (
      id                  BIGSERIAL PRIMARY KEY,
      dosyaid             BIGINT NOT NULL,
      dosya_no            TEXT,
      tarih               DATE NOT NULL DEFAULT CURRENT_DATE,
      personel            TEXT,
      ad_soyad            TEXT,
      tc_kimlik_no        TEXT,
      telefon             TEXT,
      adres               TEXT,
      ziyaret_sonucu      TEXT,
      aciliyet            TEXT,
      oncelikli_ihtiyac   TEXT,
      on_degerlendirme    TEXT,
      ozet                TEXT,
      cevaplar            JSONB NOT NULL DEFAULT '{}'::jsonb,
      sablon              JSONB NOT NULL,
      kullaniciid         INTEGER,
      olusturma_tarihi    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncelleme_tarihi   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  // Kullanici istegi (2026-10-13): ozet raporun altinda tahkikat gorevlisinin
  // kendi serbest aciklamasi.
  await pool.query(`ALTER TABLE public.saha_inceleme_formu ADD COLUMN IF NOT EXISTS personel_aciklamasi TEXT;`)
  // Kullanici istegi (2026-10-13, 2. tur): otomatik ozetin yanindaki personelin
  // kendi raporu. personel_aciklamasi artik ikisinin BIRLESTIRILMIS raporunu tutar.
  await pool.query(`ALTER TABLE public.saha_inceleme_formu ADD COLUMN IF NOT EXISTS personel_raporu TEXT;`)
  // 2026-10-13: kayitli form duzenlenince (PUT) Ev Ziyareti'ndeki AYNI satir
  // guncellensin diye o satirin id'si.
  await pool.query(`ALTER TABLE public.saha_inceleme_formu ADD COLUMN IF NOT EXISTS evziyareti_id BIGINT;`)
  // 2026-10-14: tahkikat formundan dosyaya islenen bilgiler (bkz. _lib/dosyaNitelikleri.ts).
  // Kayit transaction'i BASLAMADAN burada eklenir (DDL kilidi kayitla catismasin).
  await pool.query(`ALTER TABLE public.dosyalar ADD COLUMN IF NOT EXISTS toplamgelir NUMERIC(14,2);`)
  await pool.query(`ALTER TABLE public.dosyalar ADD COLUMN IF NOT EXISTS konutdurumu VARCHAR(100);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_saha_inceleme_formu_dosya ON public.saha_inceleme_formu (dosyaid);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_saha_inceleme_formu_tarih ON public.saha_inceleme_formu (tarih);`)

  await varsayilanSablonuYukle(false)
  semaHazir = true
}

// Hic bolum yoksa (ilk kurulum) ya da "sifirla" isteniyorsa PDF'teki
// varsayilan formu yazar. Kayitli formlar etkilenmez (her biri kendi
// sablon kopyasini tasir).
export async function varsayilanSablonuYukle(sifirla: boolean, disClient?: PoolClient) {
  const pool = getSqlMonitorPool()
  const client = disClient ?? await pool.connect()
  try {
    if (!disClient) await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(905113271)')

    if (!sifirla) {
      const mevcut = await client.query<{ c: number }>('SELECT count(*)::int AS c FROM public.saha_inceleme_bolum;')
      if ((mevcut.rows[0]?.c ?? 0) > 0) {
        if (!disClient) await client.query('COMMIT')
        return
      }
    } else {
      await client.query('DELETE FROM public.saha_inceleme_bolum;')
      await client.query(`DELETE FROM public.saha_inceleme_ayar WHERE anahtar <> $1;`, [REVIZYON_ANAHTARI])
    }
    await revizyonuArtir(client)

    for (const [bolumIndex, bolum] of VARSAYILAN_BOLUMLER.entries()) {
      const bolumResult = await client.query<{ id: string }>(
        `INSERT INTO public.saha_inceleme_bolum (sira, baslik, aciklama) VALUES ($1, $2, $3) RETURNING id::text AS id;`,
        [bolumIndex + 1, bolum.baslik, bolum.aciklama ?? null],
      )
      const bolumId = bolumResult.rows[0].id
      for (const [soruIndex, soru] of bolum.sorular.entries()) {
        const secenekler: Secenek[] = (soru.secenekler ?? []).map((metin, i) => ({ id: `s${i + 1}`, metin }))
        await client.query(
          `
            INSERT INTO public.saha_inceleme_soru (
              bolum_id, sira, soru_metni, tur, zorunlu, ipucu, secenekler, sutunlar,
              sabit_satirlar, bos_satir_sayisi, otomatik, anahtar
            )
            VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12);
          `,
          [
            bolumId,
            soruIndex + 1,
            soru.soruMetni,
            soru.tur,
            soru.zorunlu ?? false,
            soru.ipucu ?? null,
            JSON.stringify(secenekler),
            JSON.stringify(soru.sutunlar ?? []),
            JSON.stringify(soru.sabitSatirlar ?? []),
            soru.bosSatirSayisi ?? 3,
            soru.otomatik ?? null,
            soru.anahtar ?? null,
          ],
        )
      }
    }

    for (const anahtar of AYAR_ANAHTARLARI) {
      await client.query(
        `INSERT INTO public.saha_inceleme_ayar (anahtar, deger) VALUES ($1, $2) ON CONFLICT (anahtar) DO NOTHING;`,
        [anahtar, VARSAYILAN_FORM_AYARLARI[anahtar]],
      )
    }

    if (!disClient) await client.query('COMMIT')
  } catch (error) {
    if (!disClient) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    if (!disClient) client.release()
  }
}

type BolumSatiri = { id: string; sira: number; baslik: string; aciklama: string | null; aktif: boolean }
type SoruSatiri = {
  id: string
  bolum_id: string
  sira: number
  soru_metni: string
  tur: SoruTuru
  zorunlu: boolean
  aktif: boolean
  ipucu: string | null
  secenekler: Secenek[] | null
  sutunlar: TabloSutunu[] | null
  sabit_satirlar: string[] | null
  bos_satir_sayisi: number
  yukseklik: number | null
  otomatik: OtomatikDolum | null
  anahtar: RaporAnahtari | null
}

// tumu=false: sadece aktif bolum/sorular (form doldurma). tumu=true:
// pasifler dahil (tasarim ekrani).
export async function sablonuGetir(tumu: boolean): Promise<Sablon> {
  await ensureSahaIncelemeSchema()
  const pool = getSqlMonitorPool()
  const [bolumResult, soruResult, ayarResult] = await Promise.all([
    pool.query<BolumSatiri>(
      `SELECT id::text AS id, sira, baslik, aciklama, aktif FROM public.saha_inceleme_bolum WHERE ($1::boolean OR aktif) ORDER BY sira, id;`,
      [tumu],
    ),
    pool.query<SoruSatiri>(
      `
        SELECT id::text AS id, bolum_id::text AS bolum_id, sira, soru_metni, tur, zorunlu, aktif, ipucu,
               secenekler, sutunlar, sabit_satirlar, bos_satir_sayisi, yukseklik, otomatik, anahtar
        FROM public.saha_inceleme_soru
        WHERE ($1::boolean OR aktif)
        ORDER BY sira, id;
      `,
      [tumu],
    ),
    pool.query<{ anahtar: string; deger: string | null }>(`SELECT anahtar, deger FROM public.saha_inceleme_ayar;`),
  ])

  const ayarlar: FormAyarlari = { ...VARSAYILAN_FORM_AYARLARI }
  let revizyon = 0
  for (const row of ayarResult.rows) {
    if ((AYAR_ANAHTARLARI as string[]).includes(row.anahtar)) {
      ayarlar[row.anahtar as keyof FormAyarlari] = row.deger ?? ''
    } else if (row.anahtar === REVIZYON_ANAHTARI) {
      revizyon = Number(row.deger) || 0
    }
  }

  const bolumler: Bolum[] = bolumResult.rows.map((row) => ({
    id: Number(row.id),
    sira: row.sira,
    baslik: row.baslik,
    aciklama: row.aciklama,
    aktif: row.aktif,
    sorular: [],
  }))
  const bolumMap = new Map(bolumler.map((b) => [b.id, b]))
  for (const row of soruResult.rows) {
    const bolum = bolumMap.get(Number(row.bolum_id))
    if (!bolum) continue
    bolum.sorular.push({
      id: Number(row.id),
      bolumId: Number(row.bolum_id),
      sira: row.sira,
      soruMetni: row.soru_metni,
      tur: row.tur,
      zorunlu: row.zorunlu,
      aktif: row.aktif,
      ipucu: row.ipucu,
      secenekler: Array.isArray(row.secenekler) ? row.secenekler : [],
      sutunlar: Array.isArray(row.sutunlar) ? row.sutunlar : [],
      sabitSatirlar: Array.isArray(row.sabit_satirlar) ? row.sabit_satirlar : [],
      bosSatirSayisi: row.bos_satir_sayisi,
      yukseklik: row.yukseklik ?? null,
      otomatik: row.otomatik,
      anahtar: row.anahtar,
    })
  }

  return { ayarlar, bolumler, revizyon }
}

// ---------------------------------------------------------------------------
// Revizyon (eszamanli duzenleme korumasi). Tasarim ekrani sayfayi actigi
// andaki revizyonu Kaydet'te geri gonderir; bu arada sablon baska yerde
// degistiyse kayit reddedilir (sessizce ustune yazilmaz).
// ---------------------------------------------------------------------------
export const REVIZYON_ANAHTARI = 'revizyon'

export class SablonCakismasi extends Error {
  constructor() {
    super('Form şablonu siz bu sayfayı açtıktan sonra başka bir yerde değiştirildi. Değişikliklerin kaybolmaması için sayfayı yenileyip (F5) tekrar düzenleyin.')
  }
}

export async function revizyonuArtir(client: PoolClient, beklenen?: number | null) {
  const mevcut = await client.query<{ deger: string | null }>(`SELECT deger FROM public.saha_inceleme_ayar WHERE anahtar = $1;`, [REVIZYON_ANAHTARI])
  const simdiki = Number(mevcut.rows[0]?.deger) || 0
  if (beklenen !== undefined && beklenen !== null && beklenen !== simdiki) throw new SablonCakismasi()
  await client.query(
    `INSERT INTO public.saha_inceleme_ayar (anahtar, deger) VALUES ($1, $2) ON CONFLICT (anahtar) DO UPDATE SET deger = EXCLUDED.deger;`,
    [REVIZYON_ANAHTARI, String(simdiki + 1)],
  )
}

// ---------------------------------------------------------------------------
// Tasarim ekranindan gelen TUM sablonu tek islemde kaydeder. Gelen listede
// olmayan bolum/sorular silinir; id'si olmayan (ya da gecici, negatif id'li)
// yeniler eklenir. Kayitli formlar etkilenmez (kendi kopyalarini tasirlar).
// ---------------------------------------------------------------------------

function metin(value: unknown, maks = 2000): string {
  return String(value ?? '').trim().slice(0, maks)
}

function temizSecenekler(value: unknown): Secenek[] {
  if (!Array.isArray(value)) return []
  const goruldu = new Set<string>()
  const sonuc: Secenek[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const kayit = item as Record<string, unknown>
    const m = metin(kayit.metin, 500)
    let id = metin(kayit.id, 60) || `s${sonuc.length + 1}`
    if (!m) continue
    while (goruldu.has(id)) id = `${id}_`
    goruldu.add(id)
    sonuc.push({ id, metin: m })
  }
  return sonuc
}

function temizSutunlar(value: unknown): TabloSutunu[] {
  if (!Array.isArray(value)) return []
  const goruldu = new Set<string>()
  const sonuc: TabloSutunu[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const kayit = item as Record<string, unknown>
    const baslik = metin(kayit.baslik, 300)
    if (!baslik) continue
    let id = metin(kayit.id, 60) || `c${sonuc.length + 1}`
    while (goruldu.has(id)) id = `${id}_`
    goruldu.add(id)
    const tur = kayit.tur === 'sayi' || kayit.tur === 'secim' ? kayit.tur : 'metin'
    const secenekler = Array.isArray(kayit.secenekler)
      ? kayit.secenekler.map((s) => metin(s, 200)).filter(Boolean)
      : []
    // Secenekler tur "secim" degilken de korunur - sutun turu gecici olarak
    // degistirilip geri alinirsa liste kaybolmasin.
    sonuc.push(secenekler.length > 0 ? { id, baslik, tur, secenekler } : { id, baslik, tur })
  }
  return sonuc
}

export function gelenSablonuDogrula(govde: unknown): { sablon: Sablon } | { hata: string } {
  if (!govde || typeof govde !== 'object') return { hata: 'Geçersiz istek.' }
  const kayit = govde as { ayarlar?: Record<string, unknown>; bolumler?: unknown }
  if (!Array.isArray(kayit.bolumler)) return { hata: 'Bölüm listesi eksik.' }

  const ayarlar: FormAyarlari = { ...VARSAYILAN_FORM_AYARLARI }
  for (const anahtar of AYAR_ANAHTARLARI) {
    if (kayit.ayarlar && anahtar in kayit.ayarlar) ayarlar[anahtar] = metin(kayit.ayarlar[anahtar], 5000)
  }

  const bolumler: Bolum[] = []
  const kullanilanAnahtarlar = new Set<string>()
  for (const [bolumIndex, hamBolum] of (kayit.bolumler as unknown[]).entries()) {
    if (!hamBolum || typeof hamBolum !== 'object') continue
    const b = hamBolum as Record<string, unknown>
    const baslik = metin(b.baslik, 300)
    if (!baslik) return { hata: `${bolumIndex + 1}. bölümün başlığı boş olamaz.` }

    const sorular: Soru[] = []
    for (const [soruIndex, hamSoru] of (Array.isArray(b.sorular) ? b.sorular : []).entries()) {
      if (!hamSoru || typeof hamSoru !== 'object') continue
      const s = hamSoru as Record<string, unknown>
      const soruMetni = metin(s.soruMetni, 1000)
      if (!soruMetni) return { hata: `"${baslik}" bölümünde metni boş bir soru var.` }
      const tur = GECERLI_TURLER.includes(s.tur as SoruTuru) ? s.tur as SoruTuru : 'metin'
      const secenekler = temizSecenekler(s.secenekler)
      const sutunlar = temizSutunlar(s.sutunlar)
      if ((tur === 'tek' || tur === 'coklu') && secenekler.length === 0) {
        return { hata: `"${soruMetni}" sorusu için en az bir seçenek girilmeli.` }
      }
      if (tur === 'tablo' && sutunlar.length === 0) {
        return { hata: `"${soruMetni}" tablosu için en az bir sütun girilmeli.` }
      }
      let anahtar = GECERLI_ANAHTAR.includes(s.anahtar as RaporAnahtari) ? s.anahtar as RaporAnahtari : null
      if (anahtar && kullanilanAnahtarlar.has(anahtar)) anahtar = null
      if (anahtar) kullanilanAnahtarlar.add(anahtar)
      const id = Number(s.id)
      sorular.push({
        id: Number.isInteger(id) && id > 0 ? id : 0,
        bolumId: 0,
        sira: soruIndex + 1,
        soruMetni,
        tur,
        zorunlu: s.zorunlu === true,
        aktif: s.aktif !== false,
        ipucu: metin(s.ipucu, 1000) || null,
        secenekler: tur === 'tek' || tur === 'coklu' ? secenekler : [],
        sutunlar: tur === 'tablo' ? sutunlar : [],
        sabitSatirlar: tur === 'tablo' && Array.isArray(s.sabitSatirlar)
          ? (s.sabitSatirlar as unknown[]).map((x) => metin(x, 300)).filter(Boolean)
          : [],
        bosSatirSayisi: Math.max(0, Math.min(30, Math.trunc(Number(s.bosSatirSayisi) || 0))),
        yukseklik: tur === 'uzun_metin' && Number(s.yukseklik) > 0 ? Math.min(30, Math.trunc(Number(s.yukseklik))) : null,
        otomatik: GECERLI_OTOMATIK.includes(s.otomatik as OtomatikDolum) ? s.otomatik as OtomatikDolum : null,
        anahtar,
      })
    }

    const id = Number(b.id)
    bolumler.push({
      id: Number.isInteger(id) && id > 0 ? id : 0,
      sira: bolumIndex + 1,
      baslik,
      aciklama: metin(b.aciklama, 3000) || null,
      aktif: b.aktif !== false,
      sorular,
    })
  }

  if (bolumler.length === 0) return { hata: 'Formda en az bir bölüm olmalı.' }
  return { sablon: { ayarlar, bolumler } }
}

export async function sablonuKaydet(client: PoolClient, sablon: Sablon, beklenenRevizyon?: number | null) {
  await client.query('SELECT pg_advisory_xact_lock(905113271)')
  await revizyonuArtir(client, beklenenRevizyon)

  const mevcutBolumler = await client.query<{ id: string }>('SELECT id::text AS id FROM public.saha_inceleme_bolum;')
  const mevcutSorular = await client.query<{ id: string }>('SELECT id::text AS id FROM public.saha_inceleme_soru;')
  const mevcutBolumIdler = new Set(mevcutBolumler.rows.map((r) => Number(r.id)))
  const mevcutSoruIdler = new Set(mevcutSorular.rows.map((r) => Number(r.id)))
  const kalanBolumIdler = new Set<number>()
  const kalanSoruIdler = new Set<number>()

  for (const bolum of sablon.bolumler) {
    let bolumId = bolum.id
    if (bolumId && mevcutBolumIdler.has(bolumId)) {
      await client.query(
        `UPDATE public.saha_inceleme_bolum SET sira = $2, baslik = $3, aciklama = $4, aktif = $5 WHERE id = $1::bigint;`,
        [bolumId, bolum.sira, bolum.baslik, bolum.aciklama, bolum.aktif],
      )
    } else {
      const result = await client.query<{ id: string }>(
        `INSERT INTO public.saha_inceleme_bolum (sira, baslik, aciklama, aktif) VALUES ($1, $2, $3, $4) RETURNING id::text AS id;`,
        [bolum.sira, bolum.baslik, bolum.aciklama, bolum.aktif],
      )
      bolumId = Number(result.rows[0].id)
    }
    kalanBolumIdler.add(bolumId)

    for (const soru of bolum.sorular) {
      const degerler = [
        bolumId, soru.sira, soru.soruMetni, soru.tur, soru.zorunlu, soru.aktif, soru.ipucu,
        JSON.stringify(soru.secenekler), JSON.stringify(soru.sutunlar), JSON.stringify(soru.sabitSatirlar),
        soru.bosSatirSayisi, soru.otomatik, soru.anahtar, soru.yukseklik ?? null,
      ]
      if (soru.id && mevcutSoruIdler.has(soru.id)) {
        await client.query(
          `
            UPDATE public.saha_inceleme_soru SET
              bolum_id = $2::bigint, sira = $3, soru_metni = $4, tur = $5, zorunlu = $6, aktif = $7, ipucu = $8,
              secenekler = $9::jsonb, sutunlar = $10::jsonb, sabit_satirlar = $11::jsonb,
              bos_satir_sayisi = $12, otomatik = $13, anahtar = $14, yukseklik = $15
            WHERE id = $1::bigint;
          `,
          [soru.id, ...degerler],
        )
        kalanSoruIdler.add(soru.id)
      } else {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO public.saha_inceleme_soru (
              bolum_id, sira, soru_metni, tur, zorunlu, aktif, ipucu, secenekler, sutunlar,
              sabit_satirlar, bos_satir_sayisi, otomatik, anahtar, yukseklik
            )
            VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
            RETURNING id::text AS id;
          `,
          degerler,
        )
        kalanSoruIdler.add(Number(result.rows[0].id))
      }
    }
  }

  const silinecekSorular = [...mevcutSoruIdler].filter((id) => !kalanSoruIdler.has(id))
  if (silinecekSorular.length > 0) {
    await client.query(`DELETE FROM public.saha_inceleme_soru WHERE id = ANY($1::bigint[]);`, [silinecekSorular])
  }
  const silinecekBolumler = [...mevcutBolumIdler].filter((id) => !kalanBolumIdler.has(id))
  if (silinecekBolumler.length > 0) {
    await client.query(`DELETE FROM public.saha_inceleme_bolum WHERE id = ANY($1::bigint[]);`, [silinecekBolumler])
  }

  for (const anahtar of AYAR_ANAHTARLARI) {
    await client.query(
      `INSERT INTO public.saha_inceleme_ayar (anahtar, deger) VALUES ($1, $2) ON CONFLICT (anahtar) DO UPDATE SET deger = EXCLUDED.deger;`,
      [anahtar, sablon.ayarlar[anahtar]],
    )
  }
}
