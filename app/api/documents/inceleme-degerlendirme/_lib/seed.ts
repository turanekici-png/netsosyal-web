import type { Pool } from 'pg'
import type { PuanlamaKurali, SecimTuru, SoruBolum } from './types'

// Kullanicinin "Inceleme Formu v2" spesifikasyonundaki sistem sorulari -
// birebir onun verdigi metin ve puanlarla. Bunlar sistem_sorusu=true olarak
// eklenir: kullanici silemez, sadece sirasini degistirebilir (bkz.
// app/api/documents/inceleme-degerlendirme/sorular/[id]/route.ts).
type SeedSecenek = {
  secenekMetni: string
  puan: number
  redTetikler?: boolean
  yoneticiOnayi?: boolean
}

type SeedSoru = {
  bolum: SoruBolum
  sira: number
  soruMetni: string
  secimTuru: SecimTuru
  zorunlu?: boolean
  redKriteri?: boolean
  puanlamaKurali?: PuanlamaKurali
  secenekler?: SeedSecenek[]
}

export const SEED_SORULAR: SeedSoru[] = [
  // ---- BILGI ----
  { bolum: 'bilgi', sira: 1, soruMetni: 'TC Kimlik No', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 2, soruMetni: 'Telefon', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 3, soruMetni: 'İl', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 4, soruMetni: 'İlçe', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 5, soruMetni: 'Köy / Mahalle', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 6, soruMetni: 'Muhtar Adı Soyadı', secimTuru: 'metin' },
  { bolum: 'bilgi', sira: 7, soruMetni: 'Ziyaret Tarihi', secimTuru: 'metin', zorunlu: true },
  { bolum: 'bilgi', sira: 8, soruMetni: 'Personel Adı', secimTuru: 'metin', zorunlu: true },

  // ---- KRITER (eleme kriterleri, her biri redKriteri:true) ----
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

  // ---- DEGERLENDIRME (puanli, toplam 0-100'e clamp edilir) ----
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

  // ---- GOZLEM (puana dahil DEGIL) ----
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

// Tabloda hic sistem sorusu yoksa (ilk calisma) tek seferlik seed atar.
// pg_advisory_xact_lock ile, es zamanli ilk isteklerin (ornegin hot-reload
// sirasinda route'un birden fazla kez tetiklenmesi) cift seed olusturmasini
// engeller.
export async function seedIncelemeFormSorulari(pool: Pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Rastgele sabit bir 64-bit kilit anahtari - sadece bu seed islemine ozel.
    await client.query('SELECT pg_advisory_xact_lock(837260194)')

    const existing = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.inceleme_form_soru WHERE sistem_sorusu = true;`,
    )
    if (Number(existing.rows[0]?.count || '0') > 0) {
      await client.query('COMMIT')
      return
    }

    for (const soru of SEED_SORULAR) {
      const soruResult = await client.query<{ id: string }>(
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
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
