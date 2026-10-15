// 2026-10-15 kullanici istegi: Sosyal Asistan icin yapilandirilmis "bilgi
// tabani" - mevcut serbest metin "Özel Talimatlar"a DOKUNMADAN, yanina:
//   - Terim sözlüğü   ("şunu dediğimde bunu anla")
//   - Kurallar        (rapor biçimi / veri yorumu / gizlilik / işlem)
//   - Örnek soru-cevap (asistanin dogru yaklasimi ogrenmesi icin)
//   - Hazır sorular   (sohbet ekraninda tek tikla sorulan dugmeler)
// Hem sunucu (prompt uretimi) hem istemci (Ayarlar paneli) kullanir - bu
// yuzden sunucuya ozel hicbir sey import ETMEZ.
//
// KURAL (kullanici tercihi): kodlu alanlarin (durumu, aileniteligi...)
// kod<->ad karsiliklari ASLA buraya gomulmez - her zaman Hazir Degerler'den
// (get_predefined_values) cozulur. Varsayilan icerik buna gore yazildi.

export type AsistanTerim = { id: string; terim: string; anlam: string; aktif: boolean }
export type AsistanKuralKategori = 'rapor' | 'veri' | 'gizlilik' | 'islem'
export type AsistanKural = { id: string; kategori: AsistanKuralKategori; metin: string; aktif: boolean }
export type AsistanOrnek = { id: string; soru: string; yaklasim: string; aktif: boolean }
export type AsistanHazirSoruKategori = 'istatistik' | 'rapor' | 'is-akisi' | 'online' | 'dosya'
export type AsistanHazirSoru = { id: string; kategori: AsistanHazirSoruKategori; etiket: string; soru: string; aktif: boolean }

export type AsistanBilgiTabani = {
  terimler: AsistanTerim[]
  kurallar: AsistanKural[]
  ornekler: AsistanOrnek[]
  hazirSorular: AsistanHazirSoru[]
}

export const KURAL_KATEGORI_ETIKETLERI: Record<AsistanKuralKategori, string> = {
  rapor: 'Rapor Biçimi',
  veri: 'Veri Yorumu',
  gizlilik: 'Gizlilik ve Güvenlik',
  islem: 'İşlemler',
}

export const HAZIR_SORU_KATEGORI_ETIKETLERI: Record<AsistanHazirSoruKategori, string> = {
  istatistik: 'İstatistik',
  rapor: 'Raporlar',
  'is-akisi': 'İş Akışı',
  online: 'Online Başvuru',
  dosya: 'Dosya İşlemleri',
}

export const BILGI_TABANI_SINIRLARI = {
  terim: 120,
  kural: 80,
  ornek: 60,
  hazirSoru: 60,
  metin: 1200,
} as const

let sayac = 0
export function yeniKimlik(on: string) {
  sayac += 1
  return `${on}-${Date.now().toString(36)}-${sayac.toString(36)}`
}

const t = (id: string, terim: string, anlam: string): AsistanTerim => ({ id, terim, anlam, aktif: true })
const k = (id: string, kategori: AsistanKuralKategori, metin: string, aktif = true): AsistanKural => ({ id, kategori, metin, aktif })
const o = (id: string, soru: string, yaklasim: string): AsistanOrnek => ({ id, soru, yaklasim, aktif: true })
const h = (id: string, kategori: AsistanHazirSoruKategori, etiket: string, soru: string): AsistanHazirSoru => ({ id, kategori, etiket, soru, aktif: true })

export const VARSAYILAN_BILGI_TABANI: AsistanBilgiTabani = {
  terimler: [
    t('t-aktif-dosya', 'aktif dosya / yardım yapılabilir dosya', 'dosyalar.durumu = "Dosya Durumu" kategorisinde "Yardım Yapılabilir" karşılığı olan kod (kodu get_predefined_values ile bul).'),
    t('t-yapilamaz', 'yardım yapılamaz / pasif dosya', 'dosyalar.durumu = "Dosya Durumu" kategorisinde "Yardım Yapılamaz" karşılığı olan kod.'),
    t('t-yeni-muracaat', 'yeni müracaat', 'dosyalar.durumu = "Dosya Durumu" kategorisinde "Yeni Müracaat" karşılığı olan kod.'),
    t('t-on-inceleme', 'ön incelemedeki dosyalar', 'dosyalar.durumu = "Dosya Durumu" kategorisinde "Ön İnceleme" karşılığı olan kod.'),
    t('t-tahkikat', 'tahkikattaki / ev ziyareti bekleyen dosyalar', 'dosyalar.durumu = "Dosya Durumu" kategorisinde "Tahkikat" karşılığı olan kod.'),
    t('t-sonuc-bekleyen', 'sonuç bekleyen / komisyon bekleyen', 'dosyalar.durumu = "Dosya Durumu" kategorisinde "Sonuç Bekliyor" karşılığı olan kod.'),
    t('t-yardim-alan', 'yardım alan / yardımı devam eden', 'İlgili yrd_* tablosunda durumu = "Yardım Durumu" kategorisinde "Devam" karşılığı olan kod (yalnız o kayıtlar; reddedilen, iptal, durdurulan dahil edilmez).'),
    t('t-bekliyor', 'bekleyen yardım / başlangıcı gelmemiş yardım', 'yrd_* tablosunda durumu = "Yardım Durumu" kategorisinde "Bekliyor" karşılığı olan kod (çoğunlukla Kış Dönemi kayıtları).'),
    t('t-kis', 'kış yardımı / kış dönemi', 'yrd_* tablolarında donem = \'Kış Dönemi\' olan kayıtlar (1 Kasım – 30 Nisan arası verilen yardım).'),
    t('t-kapali', 'kapalı dönem / kesilmiş yardım', 'yrd_* tablolarında donem = \'Kapalı\' olan kayıtlar - yardımı kesilmiş/sona ermiş kayıtlardır, "yardım alan" sayımlarına katılmaz.'),
    t('t-nakit', 'nakit yardımı', 'yrd_ayninakti tablosu. "Ödenenler" = asama = \'ÖDEME YAPILDI\'. Tutar: miktar sütunu.'),
    t('t-gida', 'gıda yardımı / gıda kartı / gıda bankası', 'yrd_gidabankasi tablosu.'),
    t('t-ddg', 'dönem dışı gıda', 'yrd_ddgidadosyali tablosu.'),
    t('t-destek', 'destek paketi', 'yrd_destekpaketi tablosu.'),
    t('t-ekmek', 'ekmek yardımı / ekmek kartı', 'yrd_ekmek tablosu (miktar = günlük ekmek adedi).'),
    t('t-hazir-yemek', 'hazır yemek / sıcak yemek', 'yrd_haziryemek tablosu.'),
    t('t-giyim', 'giyim yardımı', 'yrd_giyim tablosu.'),
    t('t-aceze', 'aceze yardımı', 'yrd_aceze tablosu (tutar sütunu: tutar).'),
    t('t-oncelik', 'öncelikli dosyalar / 1. derece', 'dosyalar.yaronceliksirasi - küçük sayı daha önceliklidir; etiketleri "Yardım Öncelik Sırası" kategorisindedir.'),
    t('t-hane-geliri', 'hane geliri / kişi başı gelir', 'Hane geliri = o dosyadaki bireylerin SUM(aylikgeliri); kişi başı gelir = hane geliri / NULLIF(dosyalar.topbirey, 0).'),
    t('t-yasli', 'yaşlı / 65 yaş üstü', 'bireyler.dogumtarihi ile date_part(\'year\', age(dogumtarihi)) >= 65.'),
    t('t-cocuk', 'çocuk / 18 yaş altı', 'bireyler.dogumtarihi ile date_part(\'year\', age(dogumtarihi)) < 18.'),
    t('t-engelli', 'engelli / sağlık sorunu olan', 'bireyler.saglikdurumu = "Sağlık Durumu" kategorisinde ilgili (engelli/hasta) karşılık(lar).'),
    t('t-tek-yasayan', 'tek yaşayan / yalnız yaşayan', 'dosyalar.topbirey = 1 olan dosyalar.'),
    t('t-online', 'online başvuru / e-başvuru', 'online_basvurular tablosu (vatandaşın internetten doldurduğu form).'),
    t('t-komisyon', 'komisyon kararı / sonuç raporu', 'tahkikatraporlari tablosunda konu = \'Komisyon Raporu\' olan kayıtlar.'),
    t('t-ev-ziyareti', 'ev ziyareti / hane ziyareti raporu', 'evziyareti tablosu (tarih, konu, rapor, kullaniciid = ziyareti yapan personel).'),
    t('t-bu-ay', 'bu ay / geçen ay / bu yıl', 'Türkiye saatine göre takvim ayı/yılı: date_trunc(\'month\', CURRENT_DATE) gibi; "son 30 gün" = CURRENT_DATE - 30.'),
  ],
  kurallar: [
    k('k-turkce-baslik', 'rapor', 'Tüm sütun başlıklarını Türkçe ve okunaklı yaz (ör. dosyano AS "Dosya No", muracaattarihi AS "Müracaat Tarihi").'),
    k('k-tarih', 'rapor', 'Tarihleri GG.AA.YYYY biçiminde göster: TO_CHAR(tarih, \'DD.MM.YYYY\').'),
    k('k-para', 'rapor', 'Para tutarlarını binlik ayraçlı ve "TL" ile göster; toplamlarda yuvarlama yapma (2 ondalık).'),
    k('k-istatistik', 'rapor', 'İstatistik sorularında (kaç, dağılım, oran) grup + sayı + yüzde sütunlarıyla özet tablo ver ve en alta TOPLAM satırı ekle.'),
    k('k-siralama', 'rapor', 'Sıralama belirtilmemişse: listelerde Dosya No artan, istatistik tablolarında sayıya göre azalan sırala.'),
    k('k-ozet-cumle', 'rapor', 'Tablonun yanında 1-2 cümlelik yorum yaz: en çok/en az olanı ve dikkat çeken durumu belirt.'),
    k('k-kayit-dosya', 'veri', 'Sayım sorularında aynı dosyanın birden fazla kaydı olabilir - "kayıt sayısı" (COUNT(*)) ile "dosya sayısı" (COUNT(DISTINCT dosyaid)) farklıysa ikisini ayrı ayrı ver.'),
    k('k-tarih-araligi', 'veri', 'Kullanıcı tarih belirtmezse tüm kayıtları kullan, ama cevapta hangi tarih aralığını esas aldığını mutlaka belirt.'),
    k('k-isim-arama', 'veri', 'İsimle aramada büyük/küçük harf ve Türkçe karakter farkını yok say: translate(lower(sutun), \'çğıöşüâîû\', \'cgiosuaiu\') ILIKE ile karşılaştır; birden fazla kişi bulunursa listeleyip hangisi olduğunu sor.'),
    k('k-tum-yardimlar', 'veri', '"Hangi yardımları alıyor/almış" sorularında tüm yrd_* tablolarını UNION ALL ile birleştir ve Yardım Türü, Dönem, Durum, Başlangıç, Bitiş sütunlarıyla tek tabloda ver.'),
    k('k-mahalle', 'veri', 'Mahalle adı geçen sorularda dosyalar.mahalleadi üzerinden, Türkçe-duyarsız ILIKE ile eşleştir ("Filizli" = "FİLİZLİ MAH.").'),
    k('k-tc-tam', 'gizlilik', 'T.C. kimlik numarasını yalnız kullanıcı açıkça isterse veya kişi tespiti için gerekliyse göster.'),
    k('k-tc-maske', 'gizlilik', 'Toplu listelerde T.C. kimlik numarasını maskele: ilk 3 ve son 2 hane görünsün (ör. 123******45).', false),
    k('k-personel', 'gizlilik', 'Personel bazlı performans/işlem sayıları yalnız istenirse verilir; kişisel yorum veya değerlendirme yapma, sadece sayıları ver.'),
    k('k-onizleme', 'islem', 'Kayıt değiştiren her işlemde önce değişecek alanları "eski değer → yeni değer" biçiminde göster, onay almadan işlem yapma.'),
    k('k-toplu', 'islem', 'Birden fazla kaydı aynı anda değiştirme isteği gelirse bunu tek tek kayıtlar halinde yapacağını belirt ve her biri için ayrı onay iste.'),
  ],
  ornekler: [
    o('o-nakit-ay', 'Bu ay kaç nakit yardımı ödendi, toplam tutar ne?', 'yrd_ayninakti üzerinde asama = \'ÖDEME YAPILDI\' ve muracaattarihi bu ay olan kayıtlar: COUNT(*) AS "Kayıt", COUNT(DISTINCT dosyaid) AS "Dosya", SUM(miktar) AS "Toplam Tutar". Tek satırlık özet + kısa yorum.'),
    o('o-mahalle-aktif', 'Mahallelere göre aktif dosya sayıları', 'Önce get_predefined_values ile "Yardım Yapılabilir" kodunu bul. dosyalar WHERE durumu = kod GROUP BY mahalleadi; "Mahalle", "Dosya Sayısı", "Yüzde" sütunları; sayıya göre azalan; en altta TOPLAM.'),
    o('o-ekmek-alan', 'Ekmek yardımı alanları listele', 'Yardım Durumu "Devam" kodunu çöz. yrd_ekmek t JOIN dosyalar d ON d.id = t.dosyaid WHERE t.durumu = kod. Taban sütunlar (Sıra, Dosya No, Adı Soyadı, Adres, Telefon, Kişi Sayısı) + Miktar, Başlangıç, Bitiş, Dönem.'),
    o('o-kis-bekleyen', 'Kış dönemi bekleyenler kaç kişi?', 'Tüm yrd_* tablolarında donem = \'Kış Dönemi\' ve durumu = "Bekliyor" kodu; tablo (yardım türü) bazında kayıt ve dosya sayısı, en altta TOPLAM.'),
    o('o-kisi-yardimlari', 'Ahmet Yılmaz hangi yardımları alıyor?', 'Önce bireyler üzerinden Türkçe-duyarsız isim araması ile dosyaid bul (birden fazlaysa sor). Sonra tüm yrd_* tablolarını UNION ALL ile birleştirip o dosyanın kayıtlarını Yardım Türü, Dönem, Durum (etiket), Miktar, Tarih sütunlarıyla ver.'),
    o('o-yasli-yalniz', '65 yaş üstü yalnız yaşayanlar', 'dosyalar d JOIN bireyler b ON b.dosyaid = d.id WHERE d.topbirey = 1 AND date_part(\'year\', age(b.dogumtarihi)) >= 65; taban sütunlar + Yaş + Mahalle.'),
    o('o-hic-yardim', 'Hiç yardım almamış dosyalar', 'dosyalar d WHERE NOT EXISTS (her yrd_* tablosu için SELECT 1 ... WHERE dosyaid = d.id). Taban sütunlar + Dosya Durumu (etiket) + Müracaat Tarihi.'),
    o('o-ev-ziyareti', 'Son 30 günde personel bazında ev ziyaretleri', 'evziyareti e LEFT JOIN kullanicilar k ON k.id = e.kullaniciid WHERE e.tarih >= CURRENT_DATE - 30 GROUP BY personel adı; "Personel", "Ziyaret Sayısı"; azalan sıra; TOPLAM.'),
    o('o-yillik', 'Bu yıl ile geçen yılın nakit yardımını karşılaştır', 'yrd_ayninakti, asama = \'ÖDEME YAPILDI\', yıl bazında GROUP BY; "Yıl", "Kayıt", "Toplam Tutar"; altına değişim yüzdesini cümleyle yaz.'),
    o('o-online-dosyasiz', 'Online başvurusu olup dosyası olmayanlar', 'online_basvurular ob LEFT JOIN bireyler b ON b.tckimlikno = ob.tckimlikno WHERE b.id IS NULL; Ad, Soyad, Yardım Türü, Mahalle, Başvuru Tarihi.'),
    o('o-dusuk-gelir', 'Kişi başı geliri en düşük 20 hane', 'Her dosya için SUM(bireyler.aylikgeliri) / NULLIF(dosyalar.topbirey,0) hesapla; artan sırala, ilk 20; taban sütunlar + Hane Geliri + Kişi Başı Gelir.'),
    o('o-dosya-ac', '12345 numaralı dosyayı aç', 'open_dosya aracını doğrudan çağır (onay gerekmez); cevap: "12345 numaralı dosya açılıyor."'),
  ],
  hazirSorular: [
    h('h-ay-ozet', 'istatistik', 'Bu ayın yardım özeti', 'Bu ay hangi yardım türünden kaç kayıt var ve toplam tutarları ne? Yardım türü bazında tablo halinde ver.'),
    h('h-durum-dagilim', 'istatistik', 'Dosya durum dağılımı', 'Dosya durumlarına göre dosya sayılarını ve yüzdelerini göster.'),
    h('h-mahalle', 'istatistik', 'Mahallelere göre aktif dosyalar', 'Mahallelere göre aktif (yardım yapılabilir) dosya sayılarını en çoktan aza listele.'),
    h('h-yillik', 'istatistik', 'Nakit yardım yıllık karşılaştırma', 'Bu yıl ile geçen yılın nakit yardımı sayı ve tutar karşılaştırmasını ver.'),
    h('h-ekmek', 'rapor', 'Ekmek yardımı alanlar', 'Ekmek yardımı alanları listele.'),
    h('h-gida', 'rapor', 'Gıda yardımı alanlar', 'Gıda bankası yardımı alanları listele.'),
    h('h-kis', 'rapor', 'Kış dönemi bekleyenler', 'Kış dönemi yardımı bekleyenleri yardım türüyle birlikte listele.'),
    h('h-hic-yardim', 'rapor', 'Hiç yardım almamış dosyalar', 'Hiç yardım almamış dosyaları listele.'),
    h('h-yasli', 'rapor', '65 yaş üstü yalnız yaşayanlar', '65 yaş üstü yalnız yaşayan kişileri listele.'),
    h('h-oncelik', 'rapor', '1. derece öncelikli dosyalar', 'Yardım öncelik sırası 1. derece olan dosyaları listele.'),
    h('h-sonuc', 'is-akisi', 'Sonuç bekleyen dosyalar', 'Sonuç bekleyen dosyaları müracaat tarihine göre listele.'),
    h('h-tahkikat', 'is-akisi', 'Tahkikattaki dosyalar (mahalle)', 'Tahkikat aşamasındaki dosya sayılarını mahalle bazında ver.'),
    h('h-ziyaret', 'is-akisi', 'Son 30 gün ev ziyaretleri', 'Son 30 günde yapılan ev ziyaretlerini personel bazında say.'),
    h('h-online-bugun', 'online', 'Bugünkü online başvurular', 'Bugün gelen online başvuruları listele.'),
    h('h-online-dosyasiz', 'online', 'Dosyası olmayan online başvurular', 'Online başvurusu olup sistemde dosyası olmayanları listele.'),
    h('h-dosya-ac', 'dosya', 'Dosya aç', 'Şu numaralı dosyayı aç: '),
  ],
}

const temiz = (deger: unknown, sinir: number = BILGI_TABANI_SINIRLARI.metin) =>
  typeof deger === 'string' ? deger.replace(/\s+$/g, '').slice(0, sinir) : ''

// Gelen (istemciden/DB'den) degeri guvenli bicime sokar - bilinmeyen alanlar
// atilir, metinler kisaltilir, bos satirlar elenir.
export function bilgiTabaniniTemizle(girdi: unknown): AsistanBilgiTabani {
  const kaynak = (girdi && typeof girdi === 'object' ? girdi : {}) as Partial<Record<keyof AsistanBilgiTabani, unknown>>
  const dizi = (deger: unknown) => (Array.isArray(deger) ? deger : []) as Record<string, unknown>[]
  const kimlik = (deger: unknown, on: string) => (typeof deger === 'string' && deger.trim() ? deger.slice(0, 80) : yeniKimlik(on))
  const kuralKategorileri = Object.keys(KURAL_KATEGORI_ETIKETLERI) as AsistanKuralKategori[]
  const soruKategorileri = Object.keys(HAZIR_SORU_KATEGORI_ETIKETLERI) as AsistanHazirSoruKategori[]

  return {
    terimler: dizi(kaynak.terimler)
      .map((x) => ({ id: kimlik(x.id, 't'), terim: temiz(x.terim, 200).trim(), anlam: temiz(x.anlam).trim(), aktif: x.aktif !== false }))
      .filter((x) => x.terim && x.anlam)
      .slice(0, BILGI_TABANI_SINIRLARI.terim),
    kurallar: dizi(kaynak.kurallar)
      .map((x) => ({
        id: kimlik(x.id, 'k'),
        kategori: kuralKategorileri.includes(x.kategori as AsistanKuralKategori) ? (x.kategori as AsistanKuralKategori) : 'veri',
        metin: temiz(x.metin).trim(),
        aktif: x.aktif !== false,
      }))
      .filter((x) => x.metin)
      .slice(0, BILGI_TABANI_SINIRLARI.kural),
    ornekler: dizi(kaynak.ornekler)
      .map((x) => ({ id: kimlik(x.id, 'o'), soru: temiz(x.soru, 400).trim(), yaklasim: temiz(x.yaklasim).trim(), aktif: x.aktif !== false }))
      .filter((x) => x.soru && x.yaklasim)
      .slice(0, BILGI_TABANI_SINIRLARI.ornek),
    hazirSorular: dizi(kaynak.hazirSorular)
      .map((x) => ({
        id: kimlik(x.id, 'h'),
        kategori: soruKategorileri.includes(x.kategori as AsistanHazirSoruKategori) ? (x.kategori as AsistanHazirSoruKategori) : 'rapor',
        etiket: temiz(x.etiket, 80).trim(),
        soru: temiz(x.soru, 600),
        aktif: x.aktif !== false,
      }))
      .filter((x) => x.etiket && x.soru.trim())
      .slice(0, BILGI_TABANI_SINIRLARI.hazirSoru),
  }
}

// Sohbetin sistem talimatina eklenen metin. Yalniz AKTIF ogeler girer;
// hic aktif oge yoksa bos doner (prompt'a hicbir sey eklenmez).
export function bilgiTabaniTalimati(tabani: AsistanBilgiTabani): string {
  const bolumler: string[] = []
  const terimler = tabani.terimler.filter((x) => x.aktif)
  if (terimler.length) {
    bolumler.push(`TERİM SÖZLÜĞÜ (kullanıcı soldaki ifadeyi kullandığında sağdaki anlamı esas al):\n${terimler.map((x) => `- "${x.terim}" → ${x.anlam}`).join('\n')}`)
  }
  const kurallar = tabani.kurallar.filter((x) => x.aktif)
  if (kurallar.length) {
    const gruplar = (Object.keys(KURAL_KATEGORI_ETIKETLERI) as AsistanKuralKategori[])
      .map((kategori) => {
        const satirlar = kurallar.filter((x) => x.kategori === kategori)
        return satirlar.length ? `${KURAL_KATEGORI_ETIKETLERI[kategori]}:\n${satirlar.map((x) => `- ${x.metin}`).join('\n')}` : ''
      })
      .filter(Boolean)
    bolumler.push(`KURUM KURALLARI:\n${gruplar.join('\n')}`)
  }
  const ornekler = tabani.ornekler.filter((x) => x.aktif)
  if (ornekler.length) {
    bolumler.push(`ÖRNEK SORULAR VE DOĞRU YAKLAŞIM (benzer sorularda bu yaklaşımı izle; tablo/sütun adlarını gerçek şemaya göre uyarla, kodları her zaman get_predefined_values ile çöz):\n${ornekler.map((x, i) => `${i + 1}) Soru: ${x.soru}\n   Yaklaşım: ${x.yaklasim}`).join('\n')}`)
  }
  return bolumler.join('\n\n')
}
