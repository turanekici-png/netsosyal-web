import type { PoolClient } from 'pg'
import {
  anahtarliCevap,
  cevapMetni,
  haneAnalizi,
  haneSutunlari,
  haneHucresi,
  sayiOku,
  type Cevaplar,
  type RaporAnahtari,
  type Sablon,
  type Soru,
} from '@/lib/constants/sahaIncelemeForm'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { mulkiyetDurumuListesi } from '@/lib/services/mulkiyetDurumu.service'
import { foldTurkish } from '@/lib/utils'

// 2026-10-14 kullanici istegi: Hane Ziyareti / tahkikat formunda girilen
// bilgiler dosyanin ve bireylerin KENDI alanlarina da islensin - boylece
// tahkikat yapildikca dosyalar guncel kalir, raporlanabilir ve veri
// yalniz formun JSON kaydinda kalmaz:
//   - Aile niteligi (Hane Yapısı)   -> dosyalar.aileniteligi  (Hazır Değerler > Aile Niteliği kodu)
//   - Yardim onceligi (N. Derece)   -> dosyalar.yaronceliksirasi
//   - Toplam aylik hane geliri      -> dosyalar.toplamgelir   (formun ozet raporundaki AYNI hesap)
//   - Konut durumu (Kiracı vb.)     -> dosyalar.konutdurumu   (metin olarak, kayipsiz)
//                                    + dosyalar.mulkiyetdurumu (YALNIZ Hazır Değerler'de "Mülkiyet
//                                      Durumu" listesi tanimliysa; eski kodlarin anlami belirsiz)
//   - Hane uyesinin gelir miktari   -> bireyler.aylikgeliri  (ayni dosyada ad-soyadi TEK eslesen birey)
//
// Formda bos birakilan bilgi, dosyadaki mevcut degeri DEGISTIRMEZ.

const bul = (sablon: Sablon, anahtar: RaporAnahtari, metinler: string[]): Soru | null => {
  const tum = sablon.bolumler.flatMap((b) => b.sorular)
  const anahtarli = tum.find((s) => s.anahtar === anahtar)
  if (anahtarli) return anahtarli
  // Yalniz SORU METNINE bakilir (bolum adi degil) - orn. "Hane Yapısı ve Genel
  // Durum" bolumundeki baska bir secim sorusu yanlislikla eslesmesin.
  const secimli = tum.filter((s) => s.tur === 'tek' || s.tur === 'coklu')
  return secimli.find((s) => metinler.some((m) => foldTurkish(s.soruMetni).includes(m))) ?? null
}

const secilenMetinler = (soru: Soru | null, cevaplar: Cevaplar): string[] => {
  if (!soru) return []
  const deger = cevaplar[String(soru.id)]
  const idler = Array.isArray(deger) ? deger.filter((x): x is string => typeof x === 'string') : typeof deger === 'string' ? [deger] : []
  const metinler = idler.map((id) => soru.secenekler.find((s) => s.id === id)?.metin).filter((m): m is string => Boolean(m))
  return metinler.length > 0 ? metinler : (cevapMetni(soru, deger) ? [cevapMetni(soru, deger)] : [])
}

type KodluDeger = { id: string; name: string }
const gecerliKod = (deger: KodluDeger | undefined) => {
  const kod = deger && String(deger.id ?? '').trim() !== '' ? Number(deger.id) : NaN
  return Number.isInteger(kod) && kod > 0 ? kod : null
}

const adAnahtari = (ad: string) => foldTurkish(ad).replace(/\s+/g, ' ').trim()

// Form secenegi ile Hazır Değerler adi birebir ayni olmayabilir (orn. formda
// "Kiracı" / listede "Kira", "Müşterek Mülk" / "Müşterek Tapu"). Sirayla:
// tam ad -> biri digeriyle basliyor (en az 4 harf) -> ilk kelime ayni.
// Her adimda YALNIZ TEK aday varsa kabul edilir (yanlis eslesme olmasin).
function esnekEslestir(liste: KodluDeger[], metin: string): KodluDeger | undefined {
  const m = adAnahtari(metin)
  const adaylar = liste.filter((s) => String(s.name ?? '').trim())
  const tam = adaylar.filter((s) => adAnahtari(s.name) === m)
  if (tam.length === 1) return tam[0]
  const onek = adaylar.filter((s) => {
    const a = adAnahtari(s.name)
    return Math.min(a.length, m.length) >= 4 && (a.startsWith(m) || m.startsWith(a))
  })
  if (onek.length === 1) return onek[0]
  const ilk = m.split(' ')[0]
  const kelime = ilk.length >= 4 ? adaylar.filter((s) => adAnahtari(s.name).split(' ')[0] === ilk) : []
  return kelime.length === 1 ? kelime[0] : undefined
}

export type BireyGeliri = { ad: string; gelir: number }

export async function dosyaNitelikleriniHesapla(sablon: Sablon, cevaplar: Cevaplar) {
  const { values } = await predefinedValuesService.getAll()

  // --- Aile niteligi -> Hazır Değerler > Aile Niteliği kodu
  let aileNiteligi: number | null = null
  const aileSecimleri = secilenMetinler(bul(sablon, 'aile_niteligi', ['aile nitel', 'hane yapisi']), cevaplar)
  if (aileSecimleri.length > 0) {
    const secenekler = (values.familyType ?? []) as KodluDeger[]
    const eslesenler = aileSecimleri
      .map((metin) => secenekler.find((s) => foldTurkish(s.name) === foldTurkish(metin)))
      .filter((s): s is KodluDeger => Boolean(s))
    // Birden fazla secilmisse "Normal Aile" disindaki (ozel durum) once gelir
    aileNiteligi = gecerliKod(eslesenler.find((s) => !foldTurkish(s.name).includes('normal')) ?? eslesenler[0])
  }

  // --- Yardim onceligi -> "1. Derece ( Çok Kötü )" => 1 (birden fazlaysa en kucuk)
  let yardimOnceligi: number | null = null
  const dereceler = secilenMetinler(bul(sablon, 'yardim_onceligi', ['yardim oncelig', 'oncelik derece']), cevaplar)
    .map((metin) => Number((metin.match(/(\d+)/) ?? [])[1]))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 100)
  if (dereceler.length > 0) yardimOnceligi = Math.min(...dereceler)

  // --- Toplam gelir: formun ozet raporundaki hesap (uye gelirleri > beyan > gelir tablosu)
  const analiz = haneAnalizi(sablon, cevaplar)
  const toplamGelir = analiz.toplamGelir !== null && Number.isFinite(analiz.toplamGelir) && analiz.toplamGelir >= 0
    ? Math.round(analiz.toplamGelir * 100) / 100
    : null

  // --- Konut durumu (metin) + istege bagli mulkiyet kodu
  const konutSorusu = bul(sablon, 'konut_durumu', ['konut durumu', 'mulkiyet durumu'])
  const konutMetni = (konutSorusu ? secilenMetinler(konutSorusu, cevaplar).join(', ') : anahtarliCevap(sablon, cevaplar, 'konut_durumu') ?? '').trim()
  const konutDurumu = konutMetni ? konutMetni.slice(0, 100) : null
  let mulkiyetDurumu: number | null = null
  if (konutDurumu) {
    // Hazır Değerler > "mülkiyet" listesi (bkz. lib/services/mulkiyetDurumu.service.ts)
    mulkiyetDurumu = gecerliKod(esnekEslestir(await mulkiyetDurumuListesi(), konutDurumu))
  }

  // --- Hane uyelerinin gelirleri -> bireyler.aylikgeliri
  const bireyGelirleri: BireyGeliri[] = []
  if (analiz.soru) {
    const sutun = haneSutunlari(analiz.soru)
    if (sutun.ad && sutun.gelir) {
      for (const satir of analiz.satirlar) {
        const ad = haneHucresi(satir, sutun.ad)
        // Formun kendi sayi okuyucusu ("12.500,50" / "12500.5" / "12.500")
        const gelir = sayiOku(haneHucresi(satir, sutun.gelir))
        if (ad && gelir !== null && Number.isFinite(gelir) && gelir >= 0) bireyGelirleri.push({ ad, gelir: Math.round(gelir) })
      }
    }
  }

  return { aileNiteligi, yardimOnceligi, toplamGelir, konutDurumu, mulkiyetDurumu, bireyGelirleri }
}

export async function dosyaNitelikleriniIsle(client: PoolClient, dosyaid: string, sablon: Sablon, cevaplar: Cevaplar) {
  const h = await dosyaNitelikleriniHesapla(sablon, cevaplar)

  if (h.aileNiteligi !== null || h.yardimOnceligi !== null || h.toplamGelir !== null || h.konutDurumu !== null || h.mulkiyetDurumu !== null) {
    await client.query(
      `
        UPDATE dosyalar
        SET aileniteligi     = COALESCE($2::int, aileniteligi),
            yaronceliksirasi = COALESCE($3::int, yaronceliksirasi),
            toplamgelir      = COALESCE($4::numeric, toplamgelir),
            konutdurumu      = COALESCE($5::varchar, konutdurumu),
            mulkiyetdurumu   = COALESCE($6::int, mulkiyetdurumu)
        WHERE id = $1::bigint;
      `,
      [dosyaid, h.aileNiteligi, h.yardimOnceligi, h.toplamGelir, h.konutDurumu, h.mulkiyetDurumu],
    )
  }

  // Bireyler: ayni dosyada ad-soyadi (Turkce harf/boyut duyarsiz) TEK kisiyle
  // eslesen uyeye yazilir; eslesmeyen ya da birden fazla eslesen atlanir.
  const islenenBireyler: Array<{ ad: string; bireyId: string; gelir: number }> = []
  if (h.bireyGelirleri.length > 0) {
    const bireyler = await client.query<{ id: string; ad: string | null }>(
      `SELECT id::text AS id, COALESCE(NULLIF(TRIM(adisoyadi), ''), TRIM(CONCAT_WS(' ', adi, soyadi))) AS ad FROM bireyler WHERE dosyaid = $1::bigint;`,
      [dosyaid],
    )
    for (const { ad, gelir } of h.bireyGelirleri) {
      const eslesen = bireyler.rows.filter((b) => b.ad && adAnahtari(b.ad) === adAnahtari(ad))
      if (eslesen.length !== 1) continue
      await client.query(`UPDATE bireyler SET aylikgeliri = $2::int WHERE id = $1::bigint;`, [eslesen[0].id, gelir])
      islenenBireyler.push({ ad, bireyId: eslesen[0].id, gelir })
    }
  }

  return { ...h, islenenBireyler }
}
