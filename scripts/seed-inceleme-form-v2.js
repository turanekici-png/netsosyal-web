const { Pool } = require('pg')
require('dotenv').config()

// Kullanici raporu (13 Eylul 2026): "İnceleme Formu v2" alaninda hala eski
// sorular duruyor. Kok neden: proxy.ts (Next.js middleware) TUM /api/*
// isteklerini oturum kontrolunden geciriyor - route koduna (ve dolayisiyla
// ensureIncelemeDegerlendirmeSchema()/seed mantigina) hicbir zaman
// ulasilmadi, bu yuzden yeni tablolar canli veritabaninda hic olusmadi.
//
// 13 Eylul 2026 (2. tur): Kullanici, soru/secenek metinlerinin NIHAI
// (birebir) halini iceren daha detayli bir spesifikasyon gonderdi - Bilgi
// bolumu Il/Ilce/Koy'u ayri sorulara boldu, bircok kriter/degerlendirme
// sorusunun tam metnini degistirdi, "hane_kisi_sayisi" icin ayri acik bir
// sayisal alan istedi (onceki "SORU5 bandindan tahmin et" workaround'u
// kaldirildi) ve karar araligina gore varsayilan yardim turu onerisi ekledi.
// Bu script, app/api/documents/inceleme-degerlendirme/_lib/schema.ts +
// seed.ts icindeki GUNCEL (duzeltilmis) SQL/seed mantigini, oturum
// gerektirmeyen dogrudan bir pg baglantisiyla calistirir (mevcut
// scripts/ensure-*.js konvansiyonuyla ayni desen). Idempotent - tekrar
// calistirmak zararsizdir; gercek form kaydi varsa sistem sorularini
// SILMEZ (guvenlik icin).

const SEED_SORULAR = [
  { bolum: 'bilgi', sira: 1, soruMetni: 'TC Kimlik No', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 2, soruMetni: 'Telefon', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 3, soruMetni: 'İl', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 4, soruMetni: 'İlçe', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 5, soruMetni: 'Köy / Mahalle', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 6, soruMetni: 'Muhtar Adı Soyadı', secimTuru: 'metin' },
  { bolum: 'bilgi', sira: 7, soruMetni: 'Ziyaret Tarihi', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 8, soruMetni: 'Personel Adı', secimTuru: 'metin', zorunlu: true },

  {
    bolum: 'kriter', sira: 1, soruMetni: 'Başvuru sahibi veya hanedeki herhangi bir birey adına taşınmaz kaydı var mı?', secimTuru: 'coklu', redKriteri: true,
    secenekler: [
      { secenekMetni: 'Konut kaydı yok', puan: 0 },
      { secenekMetni: 'Bir adet konut kaydı var', puan: 0 },
      { secenekMetni: 'Birden fazla konut kaydı var', puan: 0, redTetikler: true },
      { secenekMetni: 'Hisseli taşınmaz kaydı var', puan: 0, yoneticiOnayi: true },
    ],
  },
  {
    bolum: 'kriter', sira: 2, soruMetni: 'Hanedeki herhangi bir birey adına belediyemizin belirlediği model sınırının üzerinde veya birden fazla araç kaydı var mı?', secimTuru: 'tek', redKriteri: true,
    secenekler: [
      { secenekMetni: 'Araç kriteri uygun', puan: 0 },
      { secenekMetni: 'Araç kriteri uygun değil', puan: 0, redTetikler: true },
    ],
  },
  {
    bolum: 'kriter', sira: 3, soruMetni: 'Hanedeki herhangi bir birey adına aktif vergi mükellefiyet kaydı bulunuyor mu?', secimTuru: 'tek', redKriteri: true,
    secenekler: [
      { secenekMetni: 'Aktif vergi mükellefi bulunmuyor', puan: 0 },
      { secenekMetni: 'Aktif vergi mükellefi mevcut', puan: 0, redTetikler: true },
    ],
  },
  {
    bolum: 'kriter', sira: 4, soruMetni: 'Hanedeki herhangi bir bireyin aktif SGK sigorta kaydı var mı?', secimTuru: 'tek', redKriteri: true,
    secenekler: [
      { secenekMetni: 'Aktif SGK kaydı bulunmuyor', puan: 0 },
      { secenekMetni: 'Aktif SGK kaydı mevcut', puan: 0, redTetikler: true },
    ],
  },
  {
    bolum: 'kriter', sira: 5, soruMetni: 'Hanede 18-55 yaş arasında, sağlıklı ve çalışabilir durumda birey var mı? (Engelli, öğrenci, asker, tutuklu veya çalışamaz hasta hariç - belge zorunludur)', secimTuru: 'tek', redKriteri: true,
    secenekler: [
      { secenekMetni: 'Çalışabilir sağlıklı birey bulunmuyor', puan: 0 },
      { secenekMetni: 'Çalışabilir sağlıklı birey mevcut', puan: 0, redTetikler: true },
    ],
  },
  {
    bolum: 'kriter', sira: 6, soruMetni: 'Başvuru sahibinin nüfusa kayıtlı adresi Sivas Merkez mi?', secimTuru: 'tek', redKriteri: true,
    secenekler: [
      { secenekMetni: "Sivas Merkez'de ikamet ediyor", puan: 0 },
      { secenekMetni: "Sivas Merkez'de ikamet etmiyor", puan: 0, redTetikler: true },
    ],
  },
  {
    bolum: 'kriter', sira: 7, soruMetni: 'Hanenin toplam aylık geliri belediyemizin belirlediği gelir limitini aşıyor mu?', secimTuru: 'tek', redKriteri: true,
    secenekler: [
      { secenekMetni: 'Gelir limitini aşmıyor', puan: 0 },
      { secenekMetni: 'Gelir limitini aşıyor', puan: 0, redTetikler: true },
    ],
  },

  {
    bolum: 'degerlendirme', sira: 1, soruMetni: 'Hanenin toplam aylık geliri nedir?', secimTuru: 'tek',
    puanlamaKurali: 'gelir_kademeli',
    secenekler: [
      { secenekMetni: 'Hanede hiçbir gelir bulunmuyor', puan: 35 },
      { secenekMetni: 'Aylık toplam gelir var (manuel girilecek)', puan: 0 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 2, soruMetni: 'Hanenin geliri nasıl sağlanmaktadır? (Birden fazla seçilebilir)', secimTuru: 'coklu',
    secenekler: [
      { secenekMetni: 'Düzenli ve belgelenebilir bir gelir kaynağı yok', puan: 5 },
      { secenekMetni: 'Yalnızca sosyal yardım veya bağışla geçiniyor', puan: 4 },
      { secenekMetni: 'Eşinden nafaka alıyor', puan: 3 },
      { secenekMetni: 'Günlük yevmiye, seyyar satıcılık gibi düzensiz işlerden', puan: 2 },
      { secenekMetni: 'Kiraladığı taşınmazdan gelir elde ediyor', puan: -5 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 3, soruMetni: 'Başvuru sahibinin yaşadığı konut için hangisi geçerlidir?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Kendi evi', puan: 0 },
      { secenekMetni: 'Kiracı', puan: 12 },
      { secenekMetni: 'Sosyal konut', puan: 8 },
      { secenekMetni: 'Yakınının evi (kira ödenmiyor)', puan: 5 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 4, soruMetni: 'Yerinde yapılan incelemede konuta ilişkin hangisi gözlemlenmiştir?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Ciddi yapısal sorun var; ısıtma, su veya elektrik altyapısı işlevini yitirmiş', puan: 8 },
      { secenekMetni: 'Bakımsız, rutubetli veya kısmen altyapı sorunu mevcut', puan: 4 },
      { secenekMetni: 'Temel ihtiyaçları karşılayan, yaşanabilir durumda', puan: 0 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 5, soruMetni: 'Hanede kaç kişi yaşamaktadır?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: '1 – 2 kişi', puan: 2 },
      { secenekMetni: '3 – 4 kişi', puan: 5 },
      { secenekMetni: '5 – 6 kişi', puan: 8 },
      { secenekMetni: '7 ve üzeri kişi', puan: 10 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 6, soruMetni: 'Hanede sağlık durumu geçim koşullarını olumsuz etkileyen birey var mı? (Birden fazla seçilebilir)', secimTuru: 'coklu',
    secenekler: [
      { secenekMetni: 'Ağır ve süreğen hastalık var (kanser, diyaliz, yoğun bakım gerektiren vb.)', puan: 10 },
      { secenekMetni: 'Düzenli tedavi ve kontrol gerektiren kronik hastalık var', puan: 5 },
      { secenekMetni: 'Engel oranı %80 ve üzeri olan birey var', puan: 10 },
      { secenekMetni: 'Engel oranı %40 – %79 arasında olan birey var', puan: 5 },
      { secenekMetni: 'Sağlık alanında önemli bir sorun bulunmuyor', puan: 0 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 7, soruMetni: 'Hanenin genel yapısı nasıldır?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Eşini kaybetmiş (dul)', puan: 8 },
      { secenekMetni: 'Eşi cezaevinde', puan: 6 },
      { secenekMetni: 'Boşanmış, tek yaşıyor', puan: 6 },
      { secenekMetni: 'Anne ya da babasıyla yaşıyor', puan: 4 },
      { secenekMetni: 'İmam nikahıyla yaşıyor', puan: 3 },
    ],
  },
  {
    bolum: 'degerlendirme', sira: 8, soruMetni: 'Başvuru sahibinin yardım alabileceği yakını ya da sosyal çevresi var mı?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Herhangi bir yakını veya sosyal desteği bulunmuyor, tamamen yalnız', puan: 5 },
      { secenekMetni: 'Zaman zaman destek sağlayan yakınları veya komşuları var', puan: 2 },
      { secenekMetni: 'Düzenli yardım ve destek alabileceği aile veya akrabası mevcut', puan: 0 },
    ],
  },

  {
    bolum: 'gozlem', sira: 1, soruMetni: 'Ziyaret sırasında evde yeterli yiyecek gözlemlendi mi?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Evet, yeterli düzeyde', puan: 0 },
      { secenekMetni: 'Kısmen, yetersiz', puan: 0 },
      { secenekMetni: 'Hayır, belirgin biçimde yetersiz', puan: 0 },
    ],
  },
  {
    bolum: 'gozlem', sira: 2, soruMetni: 'Konutun ısınma sistemi çalışır durumda mı?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Evet, sorunsuz çalışıyor', puan: 0 },
      { secenekMetni: 'Kısmen, yetersiz ısınıyor', puan: 0 },
      { secenekMetni: 'Hayır, çalışmıyor', puan: 0 },
    ],
  },
  {
    bolum: 'gozlem', sira: 3, soruMetni: 'Hanedeki öğrenci durumu nedir?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'İlköğretim çağında öğrenci var', puan: 0 },
      { secenekMetni: 'Üniversite çağında öğrenci var', puan: 0 },
      { secenekMetni: 'Öğrenci yok', puan: 0 },
    ],
  },
  {
    bolum: 'gozlem', sira: 4, soruMetni: 'Başvuru sahibinin beyanı ile yerinde yapılan gözlem örtüşüyor mu?', secimTuru: 'tek',
    secenekler: [
      { secenekMetni: 'Beyan ile gözlem tamamen uyumlu', puan: 0 },
      { secenekMetni: 'Kısmen uyumlu, küçük farklılıklar var', puan: 0 },
      { secenekMetni: 'Ciddi çelişki tespit edildi', puan: 0, yoneticiOnayi: true },
    ],
  },
  { bolum: 'gozlem', sira: 5, soruMetni: 'Forma yansımayan ancak değerlendirmeye katkı sağlayabilecek gözlemler:', secimTuru: 'metin' },
]

async function ensureSchema(pool) {
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
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_inceleme_form_soru_bolum ON public.inceleme_form_soru (bolum, sira);`)

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
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_inceleme_form_secenekler_soru ON public.inceleme_form_secenekler (soru_id, sira);`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.inceleme_degerlendirme_formu (
      id                      BIGSERIAL PRIMARY KEY,
      dosyaid                 BIGINT NOT NULL,
      tarih                   DATE NOT NULL DEFAULT CURRENT_DATE,
      personel                TEXT,
      tc_kimlik_no            TEXT,
      telefon                 TEXT,
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
  await pool.query(`ALTER TABLE public.inceleme_degerlendirme_formu ADD COLUMN IF NOT EXISTS hane_kisi_sayisi INTEGER;`)
  await pool.query(`ALTER TABLE public.inceleme_degerlendirme_formu ADD COLUMN IF NOT EXISTS ad_soyad TEXT;`)
  await pool.query(`ALTER TABLE public.inceleme_degerlendirme_formu ADD COLUMN IF NOT EXISTS adres TEXT;`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_inceleme_degerlendirme_dosyaid ON public.inceleme_degerlendirme_formu (dosyaid);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_inceleme_degerlendirme_onay ON public.inceleme_degerlendirme_formu (onay_durumu);`)

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
  await pool.query(`CREATE INDEX IF NOT EXISTS ind_inceleme_form_cevaplar_form ON public.inceleme_form_cevaplar (form_id);`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inceleme_form_cevaplar_form_soru ON public.inceleme_form_cevaplar (form_id, soru_id);`)
}

async function reseed(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(837260194)')

    const formCount = await client.query(`SELECT count(*)::int AS c FROM public.inceleme_degerlendirme_formu;`)
    const existingSoruCount = await client.query(`SELECT count(*)::int AS c FROM public.inceleme_form_soru WHERE sistem_sorusu = true;`)

    if (formCount.rows[0].c > 0) {
      console.log(`UYARI: ${formCount.rows[0].c} adet gercek form kaydi var - guvenlik icin sistem sorulari SILINMEDI/degistirilmedi.`)
      console.log('Yeni soru metinlerini gormek icin once bu formlarin ne yapilacagina karar verin.')
      await client.query('ROLLBACK')
      return
    }

    if (existingSoruCount.rows[0].c > 0) {
      console.log(`Mevcut ${existingSoruCount.rows[0].c} sistem sorusu (ve secenekleri, CASCADE ile) siliniyor - guncel metinlerle yeniden eklenecek...`)
      await client.query(`DELETE FROM public.inceleme_form_soru WHERE sistem_sorusu = true;`)
    }

    for (const soru of SEED_SORULAR) {
      const soruResult = await client.query(
        `
          INSERT INTO public.inceleme_form_soru (
            bolum, sira, soru_metni, secim_turu, zorunlu, red_kriteri,
            sistem_sorusu, puanlama_kurali
          )
          VALUES ($1, $2, $3, $4, $5, $6, true, $7)
          RETURNING id::text AS id;
        `,
        [
          soru.bolum,
          soru.sira,
          soru.soruMetni,
          soru.secimTuru,
          soru.zorunlu ?? false,
          soru.redKriteri ?? false,
          soru.puanlamaKurali ?? null,
        ],
      )
      const soruId = soruResult.rows[0]?.id
      console.log(`Soru eklendi: [${soru.bolum}] ${soru.soruMetni} (id=${soruId})`)
      if (!soruId || !soru.secenekler) continue

      for (const [index, secenek] of soru.secenekler.entries()) {
        await client.query(
          `
            INSERT INTO public.inceleme_form_secenekler (
              soru_id, sira, secenek_metni, puan, red_tetikler, yonetici_onayi
            )
            VALUES ($1::bigint, $2, $3, $4, $5, $6);
          `,
          [
            soruId,
            index + 1,
            secenek.secenekMetni,
            secenek.puan,
            secenek.redTetikler ?? false,
            secenek.yoneticiOnayi ?? false,
          ],
        )
      }
    }

    await client.query('COMMIT')
    console.log(`Toplam ${SEED_SORULAR.length} sistem sorusu (guncel metinlerle) eklendi.`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await ensureSchema(pool)
    console.log('Semalar hazir (4 tablo + hane_kisi_sayisi kolonu).')
    await reseed(pool)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
