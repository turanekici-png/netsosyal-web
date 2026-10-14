// Hane Ziyareti ve Sosyal İnceleme Formu (2026-10-13) - "Tahkikat Formu"
// butonunun actigi formun YENI hali. Eski eleme kriterli + puanlamali
// "Inceleme Formu v2" (inceleme_degerlendirme_formu) kullanici istegiyle
// tamamen kaldirildi: bu form PUAN/KARAR URETMEZ ("tek basina yardim hakki
// dogurmaz veya ret karari olusturmaz"), sadece saha incelemesini standart
// bicimde kaydeder.
//
// Bolumler ve sorular Ayarlar > Tahkikat Formu Tasarımı ekranindan
// eklenip cikarilabilir (saha_inceleme_bolum / saha_inceleme_soru). Her
// kayit, dolduruldugu andaki sablonun bir KOPYASINI (sablon JSONB) da
// saklar - sonradan bir soru silinse/degistirilse bile eski kayitlar
// eksiksiz gorunur/yazdirilir.
//
// Bu dosya hem istemci (form, tasarim ekrani) hem sunucu (API, yazdirma)
// tarafindan kullanilir - icinde DB/sunucu koduna ait hicbir sey olmamali.

// 'imza': dokunmatik imza (kalem/parmak/fare) - cevap PNG data URL olarak saklanir.
export type SoruTuru = 'metin' | 'uzun_metin' | 'sayi' | 'tarih' | 'tarih_saat' | 'tek' | 'coklu' | 'tablo' | 'imza'

// Imza cevabi icin kabul edilen azami data URL boyutu (~600 KB).
export const IMZA_AZAMI_UZUNLUK = 800_000

export const SORU_TURU_ETIKETLERI: Record<SoruTuru, string> = {
  metin: 'Kısa metin',
  uzun_metin: 'Uzun metin',
  sayi: 'Sayı',
  tarih: 'Tarih',
  tarih_saat: 'Tarih - saat',
  tek: 'Tek seçim',
  coklu: 'Çoklu seçim',
  tablo: 'Tablo',
  imza: 'İmza (dokunmatik)',
}

// Form acildiginda dosyadan/oturumdan otomatik doldurulan alanlar.
export type OtomatikDolum =
  | 'basvuru_sahibi'
  | 'tc_kimlik_no'
  | 'telefon'
  | 'adres'
  | 'personel'
  | 'ziyaret_zamani'
  | 'hane_kisi_sayisi'
  | 'hane_uyeleri'

export const OTOMATIK_DOLUM_ETIKETLERI: Record<OtomatikDolum, string> = {
  basvuru_sahibi: 'Başvuru sahibinin adı soyadı',
  tc_kimlik_no: 'TC kimlik no',
  telefon: 'Telefon',
  adres: 'Adres',
  personel: 'Formu dolduran personel',
  ziyaret_zamani: 'Şu anki tarih-saat',
  hane_kisi_sayisi: 'Hanedeki kişi sayısı',
  hane_uyeleri: 'Hane üyeleri listesi (tablo)',
}

// Raporlarda (İnceleme Formları, Sonuç Bekleyen) ayri kolon olarak
// gosterilen alanlar - kayit aninda bu anahtarli sorunun cevabi formun
// kendi satirina da yazilir.
export type RaporAnahtari =
  | 'ziyaret_sonucu'
  | 'aciliyet'
  | 'oncelikli_ihtiyac'
  | 'on_degerlendirme'
  | 'konut_durumu'
  | 'toplam_gelir'
  // 2026-10-14: secimi dosyanin kendi alanlarina da islenir (dosyalar.aileniteligi / yaronceliksirasi)
  | 'aile_niteligi'
  | 'yardim_onceligi'

export const RAPOR_ANAHTARI_ETIKETLERI: Record<RaporAnahtari, string> = {
  ziyaret_sonucu: 'Ziyaret sonucu',
  aciliyet: 'İhtiyacın aciliyeti',
  oncelikli_ihtiyac: 'Öncelikli ihtiyaç',
  on_degerlendirme: 'Ön değerlendirme / önerilen işlem',
  konut_durumu: 'Konut durumu',
  toplam_gelir: 'Toplam aylık gelir',
  aile_niteligi: 'Aile niteliği (dosyaya işlenir)',
  yardim_onceligi: 'Yardım önceliği (dosyaya işlenir)',
}

export type Secenek = { id: string; metin: string }

export type TabloSutunTuru = 'metin' | 'sayi' | 'secim'
export type TabloSutunu = { id: string; baslik: string; tur: TabloSutunTuru; secenekler?: string[] }

export type Soru = {
  id: number
  bolumId: number
  sira: number
  soruMetni: string
  tur: SoruTuru
  zorunlu: boolean
  aktif: boolean
  ipucu: string | null
  secenekler: Secenek[]
  sutunlar: TabloSutunu[]
  // Tablo sorularinda ilk sutunu SABIT olan satirlar (ör. gider kalemleri) -
  // bossa satirlar personel tarafindan eklenir/silinir.
  sabitSatirlar: string[]
  // Bos tabloya baslangicta kac bos satir konacagi (yazdirilan bos formda da).
  bosSatirSayisi: number
  // Uzun metin alaninin formdaki yuksekligi (satir sayisi); bos = otomatik.
  yukseklik?: number | null
  otomatik: OtomatikDolum | null
  anahtar: RaporAnahtari | null
}

export type Bolum = {
  id: number
  sira: number
  baslik: string
  aciklama: string | null
  aktif: boolean
  sorular: Soru[]
}

export type FormAyarlari = {
  kurumBasligi: string
  formBasligi: string
  altBaslik: string
  kullanimNotu: string
  surum: string
  sonNot: string
  altBilgi: string
}

// revizyon: her kayitta artan sayac - tasarim ekrani eski bir surumu
// kaydedip baskasinin (ya da baska sekmenin) degisikligini ezmesin diye.
export type Sablon = { ayarlar: FormAyarlari; bolumler: Bolum[]; revizyon?: number }

export type TabloSatiri = { sabit?: string; hucreler: Record<string, string> }
export type CevapDegeri = string | string[] | TabloSatiri[]
export type Cevaplar = Record<string, CevapDegeri>

// yasGrubu: tarihsel ad - artik dosyadaki dogum tarihinden hesaplanan TAM YAS tasir.
export type HaneUyesi = { adSoyad: string; yasGrubu: string; yakinlik: string; adres?: string }

export type SahaIncelemeKaydi = {
  id: string
  dosyaid: string
  dosyaNo: string | null
  tarih: string
  personel: string | null
  adSoyad: string | null
  ziyaretSonucu: string | null
  aciliyet: string | null
  oncelikliIhtiyac: string | null
  onDegerlendirme: string | null
  ozet: string | null
  // Birlestirilmis kurumsal tahkikat raporu (otomatik ozet + personel raporu).
  personelAciklamasi: string | null
  // Personelin otomatik ozetin yanina yazdigi kendi raporu.
  personelRaporu: string | null
  kullaniciid: number | null
  olusturmaTarihi: string
  // Formun kayitta olusturdugu Ev Ziyareti satiri (evziyareti.id) - gecmis
  // listelerinde ayni raporun iki kez gorunmemesi icin.
  evziyaretiId?: string | null
}

export type SahaIncelemeDetay = SahaIncelemeKaydi & {
  tcKimlikNo: string | null
  telefon: string | null
  adres: string | null
  cevaplar: Cevaplar
  sablon: Sablon
}

export const VARSAYILAN_FORM_AYARLARI: FormAyarlari = {
  kurumBasligi: 'BELEDİYE SOSYAL YARDIM BİRİMİ',
  formBasligi: 'HANE ZİYARETİ VE SOSYAL İNCELEME FORMU',
  altBaslik: 'Genel ihtiyaç ve yaşam koşullarının değerlendirilmesi',
  kullanimNotu:
    'Bu form, saha incelemesinde gerekli ve ilgili bilgileri standart biçimde kaydetmek içindir. Yalnızca yardım değerlendirmesi için gerekli alanları doldurun; bilinmeyen bilgileri tahmin etmeyin. Vatandaşın beyanı, belgeyle doğrulanan bilgi ve personelin doğrudan gözlemi ayrı kaydedilmelidir. Bu form tek başına yardım hakkı doğurmaz veya ret kararı oluşturmaz.',
  surum: 'Sürüm 1 - 13.10.2026',
  sonNot:
    'Nihai karar, belediyenin yetkili birimi ve yürürlükteki yardım kriterleri çerçevesinde verilir. Saha personelinin bu formdaki ön değerlendirmesi tek başına onay/ret kararı değildir.',
  altBilgi: 'BELEDİYE SOSYAL YARDIM BİRİMİ • HANE ZİYARETİ VE SOSYAL İNCELEME FORMU • KURUM İÇİ KULLANIM',
}

// ---------------------------------------------------------------------------
// VARSAYILAN SABLON - kullanicinin verdigi "Hane Ziyareti ve Sosyal Inceleme
// Formu" PDF'inin icerigi (kullanici istegiyle bolumler 1-10 sirali; PDF'te
// 8 numara yoktu). id'ler burada yer tutucudur, DB'ye eklenince gercek
// id'ler atanir.
// ---------------------------------------------------------------------------

type SeedSoru = Omit<Soru, 'id' | 'bolumId' | 'sira' | 'aktif' | 'secenekler' | 'sutunlar' | 'sabitSatirlar' | 'bosSatirSayisi' | 'ipucu' | 'otomatik' | 'anahtar' | 'zorunlu'> & {
  zorunlu?: boolean
  ipucu?: string
  secenekler?: string[]
  sutunlar?: TabloSutunu[]
  sabitSatirlar?: string[]
  bosSatirSayisi?: number
  otomatik?: OtomatikDolum
  anahtar?: RaporAnahtari
}
export type SeedBolum = { baslik: string; aciklama?: string; sorular: SeedSoru[] }

const BILGI_KAYNAGI = ['Beyan', 'Belge', 'Diğer']

export const VARSAYILAN_BOLUMLER: SeedBolum[] = [
  {
    baslik: 'Ziyaret ve Başvuru Bilgileri',
    sorular: [
      { soruMetni: 'İlgili birim', tur: 'metin' },
      { soruMetni: 'İnceleme türü', tur: 'tek', secenekler: ['İlk inceleme', 'Takip', 'Yeniden değerlendirme'] },
      { soruMetni: 'Ziyaret tarihi-saat', tur: 'tarih_saat', otomatik: 'ziyaret_zamani', zorunlu: true },
      { soruMetni: 'Başvuru sahibi (ad-soyad)', tur: 'metin', otomatik: 'basvuru_sahibi', zorunlu: true },
      { soruMetni: 'İletişim bilgisi (gerekliyse)', tur: 'metin', otomatik: 'telefon' },
      { soruMetni: 'Adres (başvuru kaydındaki adresle eşleştirme için gerekli ölçüde)', tur: 'uzun_metin', otomatik: 'adres' },
      { soruMetni: 'Ziyarete katılan belediye personeli / sicil no', tur: 'metin', otomatik: 'personel', zorunlu: true },
      { soruMetni: 'Görüşülen kişi ve başvuru sahibiyle ilişkisi', tur: 'metin' },
      { soruMetni: 'Ziyaret sonucu', tur: 'tek', anahtar: 'ziyaret_sonucu', zorunlu: true, secenekler: ['Görüşme yapıldı', 'Hane ziyareti gerçekleşmedi', 'Yeniden ziyaret gerekli'] },
      { soruMetni: 'Gerçekleşmediyse nedeni / takip tarihi', tur: 'metin' },
    ],
  },
  {
    baslik: 'Hane Yapısı',
    sorular: [
      { soruMetni: 'Hanede fiilen yaşayan toplam kişi sayısı', tur: 'sayi', otomatik: 'hane_kisi_sayisi' },
      {
        soruMetni: 'Hane üyeleri',
        tur: 'tablo',
        otomatik: 'hane_uyeleri',
        bosSatirSayisi: 5,
        sutunlar: [
          { id: 'ad', baslik: 'Hane üyesi (ad-soyad veya kurumun kullandığı kod)', tur: 'metin' },
          { id: 'yas', baslik: 'Yaş', tur: 'sayi' },
          { id: 'yakinlik', baslik: 'Yakınlık', tur: 'metin' },
          { id: 'durum', baslik: 'Eğitim/çalışma durumu', tur: 'metin' },
          { id: 'katki', baslik: 'Hane giderlerine katkı', tur: 'secim', secenekler: ['Var', 'Yok', 'Bilinmiyor'] },
        ],
      },
      { soruMetni: 'Hanede fiilen yaşamayan ancak düzenli maddi katkı sağlayan kişi/kurum (gerekiyorsa)', tur: 'metin' },
      { soruMetni: 'Hane yapısına ilişkin açıklama (yalnızca değerlendirmeyle ilgili)', tur: 'uzun_metin' },
    ],
  },
  {
    baslik: 'Gelir ve Çalışma Durumu',
    sorular: [
      {
        soruMetni: 'Hanenin gelir türleri',
        tur: 'coklu',
        secenekler: ['Ücretli çalışma', 'Emekli aylığı', 'Dul/yetim aylığı', 'Sosyal yardım/ödenek', 'Serbest iş/geçici iş', 'Tarım/hayvancılık', 'Düzenli aile desteği', 'Düzenli gelir yok', 'Diğer'],
      },
      {
        soruMetni: 'Gelir kaynakları',
        tur: 'tablo',
        bosSatirSayisi: 3,
        sutunlar: [
          { id: 'kaynak', baslik: 'Gelir kaynağı', tur: 'metin' },
          { id: 'tutar', baslik: 'Aylık yaklaşık tutar (TL)', tur: 'sayi' },
          { id: 'duzen', baslik: 'Düzenlilik', tur: 'secim', secenekler: ['Düzenli', 'Değişken'] },
          { id: 'bilgi', baslik: 'Bilginin kaynağı', tur: 'secim', secenekler: BILGI_KAYNAGI },
        ],
      },
      { soruMetni: 'Haneye giren toplam aylık yaklaşık gelir (TL)', tur: 'sayi', anahtar: 'toplam_gelir' },
      { soruMetni: 'İş kaybı/gelir azalması varsa, ne zamandan beri? (gerekli ölçüde)', tur: 'metin' },
      { soruMetni: 'Gelir bilgisine ilişkin doğrulanması gereken husus', tur: 'metin' },
    ],
  },
  {
    baslik: 'Zorunlu Giderler ve Borçlar',
    sorular: [
      {
        soruMetni: 'Zorunlu giderler',
        tur: 'tablo',
        sabitSatirlar: ['Kira / konut gideri', 'Elektrik / su / doğalgaz / ısınma', 'Gıda ve temel ihtiyaçlar', 'Ulaşım / eğitim', 'Sağlık / bakım giderleri (gerekiyorsa)', 'Diğer zorunlu gider'],
        sutunlar: [
          { id: 'kalem', baslik: 'Gider kalemi', tur: 'metin' },
          { id: 'tutar', baslik: 'Aylık yaklaşık tutar (TL)', tur: 'sayi' },
          { id: 'aciklama', baslik: 'Açıklama / ödeme güçlüğü (gerekiyorsa)', tur: 'metin' },
        ],
      },
      { soruMetni: 'Ödenemeyen kira/fatura veya tahliye riski var mı?', tur: 'tek', secenekler: ['Hayır', 'Evet'] },
      { soruMetni: 'Tahliye / ödenemeyen kira-fatura açıklaması', tur: 'metin' },
      { soruMetni: 'Borç bilgisi (yardım değerlendirmesi için gerekli ve orantılı ölçüde)', tur: 'uzun_metin' },
    ],
  },
  {
    baslik: 'Konut ve Temel Yaşam Koşulları',
    sorular: [
      { soruMetni: 'Konut durumu', tur: 'tek', anahtar: 'konut_durumu', secenekler: ['Mülk sahibi', 'Kiracı', 'Aile/başka kişi yanında', 'Lojman', 'Geçici barınma', 'Diğer'] },
      { soruMetni: 'Eksik veya riskli koşullar (yalnızca somut ve ilgili gözlemler)', tur: 'uzun_metin' },
      { soruMetni: 'Temel eşya ihtiyacı varsa', tur: 'uzun_metin' },
    ],
  },
  {
    baslik: 'Eğitim, Bakım ve Sosyal Destek İhtiyaçları',
    sorular: [
      {
        soruMetni: 'Destek ihtiyaçları',
        tur: 'coklu',
        secenekler: [
          'Çocukların eğitim/okul ihtiyaçları',
          'Kırtasiye/kıyafet/beslenme ihtiyacı',
          'Yaşlı birey için destek ihtiyacı',
          'Engellilik/erişilebilirlik kaynaklı destek ihtiyacı',
          'Günlük yaşamda bakım desteği ihtiyacı',
          'Ulaşım veya hizmete erişim güçlüğü',
          'Aile/çevre desteği sınırlı',
          'Diğer sosyal destek ihtiyacı',
          'Bu bölümde özel bir ihtiyaç beyan edilmedi',
        ],
      },
      { soruMetni: 'İhtiyacın kısa açıklaması ve gerekli yönlendirme', tur: 'uzun_metin', ipucu: 'Gereksiz sağlık ayrıntısı yazmayın.' },
    ],
  },
  {
    baslik: 'Başvuru Sahibinin Beyanı ve Öncelikli İhtiyacı',
    aciklama: '“Şu anda karşılanmasını en çok istediğiniz ihtiyaç nedir?”',
    sorular: [
      { soruMetni: 'Başvuru sahibinin kendi ifadeleriyle kısa özeti', tur: 'uzun_metin' },
      {
        soruMetni: 'Öncelikli ihtiyaç',
        tur: 'coklu',
        anahtar: 'oncelikli_ihtiyac',
        secenekler: ['Gıda', 'Temizlik/hijyen', 'Giyim', 'Ev eşyası', 'Kira/barınma', 'Fatura/ısınma', 'Eğitim', 'Ulaşım', 'Sosyal hizmete yönlendirme', 'Diğer'],
      },
      { soruMetni: 'İhtiyacın aciliyeti', tur: 'tek', anahtar: 'aciliyet', zorunlu: true, secenekler: ['Acil (0–72 saat)', 'Öncelikli', 'Rutin değerlendirme'] },
      { soruMetni: 'Acil olarak karşılanmaması hâlinde oluşabilecek somut risk', tur: 'uzun_metin' },
    ],
  },
  {
    baslik: 'Personelin Gözlemi ve Değerlendirmesi',
    aciklama: 'Bu bölümde yorumlayıcı/etiketleyici ifadeler yerine doğrulanabilir olgular yazılmalıdır. Beyan ile gözlem ayrılmalı; görünüş, evin düzeni veya eşya yeniliği tek başına muhtaçlık ölçütü yapılmamalıdır.',
    sorular: [
      {
        soruMetni: 'Gözlem ve değerlendirme',
        tur: 'tablo',
        sabitSatirlar: ['Gelir-gider dengesi', 'Temel ihtiyaçlar', 'Barınma ve yaşam koşulları', 'Sosyal risk / acil durum', 'Eksik bilgi / takip gereği'],
        sutunlar: [
          { id: 'konu', baslik: 'Konu', tur: 'metin' },
          { id: 'kaynak', baslik: 'Bilginin türü', tur: 'secim', secenekler: ['Beyan', 'Belgeyle doğrulanan bilgi', 'Doğrudan gözlem'] },
          { id: 'aciklama', baslik: 'Açıklama', tur: 'metin' },
        ],
      },
    ],
  },
  {
    baslik: 'Ön Değerlendirme ve Önerilen İşlem',
    sorular: [
      {
        soruMetni: 'Ön değerlendirme',
        tur: 'coklu',
        anahtar: 'on_degerlendirme',
        secenekler: [
          'Başvuru dosyası mevcut bilgilerle değerlendirmeye sunulabilir',
          'Ek bilgi/belge talebi gerekli (yalnızca gerekli olanlar belirtilecek)',
          'Acil ihtiyaç için yetkili birime bildirim gerekli',
          'Belediye içindeki başka hizmete yönlendirme önerilir',
          'Başka kurum/kuruluşa yönlendirme önerilir',
          'Takip ziyareti/telefon görüşmesi gerekli',
        ],
      },
      { soruMetni: 'Önerilen yardım/yönlendirme ve gerekçesi', tur: 'uzun_metin' },
      { soruMetni: 'Talep edilen ek bilgi/belge ve neden gerekli olduğu', tur: 'uzun_metin' },
      { soruMetni: 'Takip sorumlusu ve hedef tarih', tur: 'metin' },
    ],
  },
  {
    baslik: 'Görüşme Sonu ve İmzalar',
    aciklama: 'İmza, başvurunun kabul edildiği, verilen bilgilerin tümünün doğrulandığı veya kişisel verilerin işlenmesine açık rıza verildiği anlamına gelecek şekilde kullanılmamalıdır. İmza alınmasının amacı açıkça belirtilmelidir.',
    sorular: [
      { soruMetni: 'Vatandaşa sonraki adım / başvuru takibi hakkında bilgi verildi', tur: 'tek', secenekler: ['Evet', 'Hayır'] },
      { soruMetni: 'Vatandaşın ek açıklaması (isteğe bağlı)', tur: 'uzun_metin' },
      { soruMetni: 'İkinci personel (varsa)', tur: 'metin' },
      { soruMetni: 'Başvuru sahibi / görüşülen kişi imzası', tur: 'imza', ipucu: 'Yalnızca görüşmeye katılım veya teslim alındı kaydı içindir.' },
      // Kullanici istegi (2026-10-13): personel adi, personel imzasinin hemen ustunde.
      { soruMetni: 'Personel adı-soyadı', tur: 'metin', otomatik: 'personel' },
      { soruMetni: 'Personel imzası', tur: 'imza' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

export function yeniGeciciId(onEk: string) {
  return `${onEk}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function secenekMetinleri(soru: Pick<Soru, 'secenekler'>, deger: CevapDegeri | undefined): string[] {
  if (deger === undefined || deger === null) return []
  const idler = Array.isArray(deger) ? (deger as unknown[]).filter((x): x is string => typeof x === 'string') : [deger as string]
  return idler
    .map((id) => soru.secenekler.find((s) => s.id === id)?.metin)
    .filter((metin): metin is string => Boolean(metin))
}

export function bosMu(soru: Pick<Soru, 'tur'>, deger: CevapDegeri | undefined): boolean {
  if (deger === undefined || deger === null) return true
  if (soru.tur === 'tablo') {
    return !(deger as TabloSatiri[]).some((satir) => Object.values(satir.hucreler || {}).some((v) => String(v ?? '').trim() !== ''))
  }
  if (Array.isArray(deger)) return deger.length === 0
  return String(deger).trim() === ''
}

// Bir cevabi raporlarda/ozetlerde kullanilacak duz metne cevirir.
export function cevapMetni(soru: Soru, deger: CevapDegeri | undefined): string {
  if (bosMu(soru, deger)) return ''
  if (soru.tur === 'imza') return 'İmzalandı'
  if (soru.tur === 'tek' || soru.tur === 'coklu') return secenekMetinleri(soru, deger).join(', ')
  if (soru.tur === 'tablo') {
    return (deger as TabloSatiri[])
      .filter((satir) => Object.values(satir.hucreler || {}).some((v) => String(v ?? '').trim() !== ''))
      .map((satir) => soru.sutunlar
        .map((sutun, index) => {
          const hucre = index === 0 && satir.sabit ? satir.sabit : satir.hucreler?.[sutun.id]
          return String(hucre ?? '').trim()
        })
        .filter(Boolean)
        .join(' - '))
      .join('; ')
  }
  if (soru.tur === 'tarih_saat') return String(deger).replace('T', ' ')
  return String(deger).trim()
}

export function anahtarliCevap(sablon: Sablon, cevaplar: Cevaplar, anahtar: RaporAnahtari): string | null {
  for (const bolum of sablon.bolumler) {
    for (const soru of bolum.sorular) {
      if (soru.anahtar === anahtar) {
        const metin = cevapMetni(soru, cevaplar[String(soru.id)])
        return metin || null
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// OZET RAPOR (2026-10-13, kullanici istegi: "doldurulan cevap ve bilgilere
// gore altta bir ozet rapor olustursun, kurumsal ve profesyonel olsun").
// Sorular Ayarlar'dan serbestce degistirilebildigi icin rapor SABIT soru
// metinlerine baglanmaz: gostergeler otomatik dolum / rapor anahtarlari ve
// tablo yapisindan (sayisal sutunlar), bulgular ise o anki TUM cevaplardan
// uretilir. Formun altinda canli, yazdirma ciktisinda da ayni sekilde.
// ---------------------------------------------------------------------------

export type OzetGostergeTonu = 'notr' | 'mavi' | 'yesil' | 'amber' | 'kirmizi'
export type OzetGosterge = { etiket: string; deger: string; ton: OzetGostergeTonu }
export type OzetBulguBolumu = { no: number; baslik: string; maddeler: { soru: string; cevap: string }[] }
export type OzetRapor = {
  gostergeler: OzetGosterge[]
  paragraf: string
  bulgular: OzetBulguBolumu[]
  doluAlan: number
  toplamAlan: number
  cocukSayisi?: number
}

function tl(n: number): string {
  return `${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`
}

export function sayiOku(deger: unknown): number | null {
  const metin = String(deger ?? '').trim()
  if (!metin) return null
  // "12.500,50" / "12.500" / "12500.5" / "12500" bicimlerini kabul et
  const normal = /,\d{1,2}$/.test(metin)
    ? metin.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(metin)
      ? metin.replace(/\./g, '')
      : metin.replace(/,/g, '')
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

function tarihGoster(deger: string | null): string | null {
  if (!deger) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(deger)
  return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}` : ''}` : deger
}

function aciliyetTonu(metin: string | null): OzetGostergeTonu {
  const n = (metin || '').toLocaleLowerCase('tr-TR')
  if (n.startsWith('acil')) return 'kirmizi'
  if (n.startsWith('öncelikli')) return 'amber'
  return metin ? 'yesil' : 'notr'
}

// ---------------------------------------------------------------------------
// HANE ANALIZI (2026-10-13): form ekrani, ozet rapor, birlesik rapor ve
// yazdirma ciktisi hane bilgisini TEK yerden hesaplasin (onceden form ekrani
// uye gelirlerini, raporlar ise yalnizca "toplam gelir" sorusunu kullaniyordu).
// Hane uyeleri tablosunun sutunlari Ayarlar'dan serbestce degistirilebildigi
// icin sutunlar id'ye, yoksa basliga/seceneklere gore taninir.
// ---------------------------------------------------------------------------

export type HaneSutunlari = {
  ad?: TabloSutunu
  yas?: TabloSutunu
  yakinlik?: TabloSutunu
  saglik?: TabloSutunu
  calisma?: TabloSutunu
  katki?: TabloSutunu
  gelir?: TabloSutunu
  adres?: TabloSutunu
}

const trKucuk = (m: string) => m.toLocaleLowerCase('tr-TR')

export function haneSutunlari(soru: Pick<Soru, 'sutunlar'>): HaneSutunlari {
  const s = soru.sutunlar
  const baslikta = (parca: string) => (c: TabloSutunu) => trKucuk(c.baslik).includes(parca)
  return {
    ad: s.find((c) => c.id === 'ad') ?? s.find((c) => c.tur === 'metin' && /ad[- ]?soyad|hane üyesi/.test(trKucuk(c.baslik))),
    yas: s.find((c) => c.id === 'yas') ?? s.find((c) => trKucuk(c.baslik) === 'yaş'),
    yakinlik: s.find((c) => c.id === 'yakinlik') ?? s.find(baslikta('yakınlık')),
    saglik: s.find((c) => c.tur === 'secim' && (c.secenekler ?? []).some((x) => trKucuk(x) === 'sağlıklı')),
    calisma: s.find((c) => c.tur === 'secim' && trKucuk(c.baslik).includes('çalışma')),
    katki: s.find((c) => c.id === 'katki') ?? s.find((c) => c.tur === 'secim' && trKucuk(c.baslik).includes('katkı')),
    gelir: s.find((c) => c.tur === 'sayi' && trKucuk(c.baslik).includes('gelir')),
    adres: s.find((c) => c.tur !== 'secim' && trKucuk(c.baslik).includes('adres')),
  }
}

export type GelirKaynagi = 'uye' | 'beyan' | 'tablo'
export const GELIR_KAYNAGI_METNI: Record<GelirKaynagi, string> = {
  uye: 'hane üyelerine girilen gelirlerin toplamı',
  beyan: 'beyan edilen toplam gelir',
  tablo: 'gelir kaynakları tablosu toplamı',
}

export type HaneAnalizi = {
  soru: Soru | null
  sutunlar: HaneSutunlari
  // icinde en az bir dolu hucre olan satirlar
  satirlar: TabloSatiri[]
  kisiSayisi: number | null
  toplamGelir: number | null
  gelirKaynagi: GelirKaynagi | null
  kisiBasi: number | null
  // null: tabloda saglik/yas sutunu yok ya da hic saglik durumu girilmemis
  calisabilecek: number | null
  // "Hane gelirine katki: Yok" secili ama gelir tutari girilmis uyeler
  katkiCelisen: string[]
}

export const haneHucresi = (satir: TabloSatiri, sutun?: TabloSutunu) => (sutun ? String(satir.hucreler?.[sutun.id] ?? '').trim() : '')

// Saglikli ve 18 yas ve uzeri hane uyesi "calisabilecek durumda" sayilir.
export function calisabilirMi(satir: TabloSatiri, sutunlar: HaneSutunlari): boolean {
  if (!sutunlar.saglik || !sutunlar.yas) return false
  if (trKucuk(haneHucresi(satir, sutunlar.saglik)) !== 'sağlıklı') return false
  const yas = sayiOku(haneHucresi(satir, sutunlar.yas))
  return yas !== null && yas >= 18
}

export function haneAnalizi(sablon: Sablon, cevaplar: Cevaplar): HaneAnalizi {
  const tumSorular = sablon.bolumler.flatMap((b) => b.sorular)
  const soru = tumSorular.find((s) => s.otomatik === 'hane_uyeleri' && s.tur === 'tablo') ?? null
  const sutunlar = soru ? haneSutunlari(soru) : {}
  const satirlar = soru
    ? ((cevaplar[String(soru.id)] as TabloSatiri[] | undefined) ?? []).filter((r) => Object.values(r.hucreler || {}).some((v) => String(v ?? '').trim()))
    : []

  // Kisi sayisi: "fiilen yasayan kisi sayisi" sorusu (personel duzeltebilir), yoksa satir sayisi
  const kisiSorusu = tumSorular.find((s) => s.otomatik === 'hane_kisi_sayisi')
  const kisiCevap = kisiSorusu ? sayiOku(cevaplar[String(kisiSorusu.id)]) : null
  const kisiSayisi = kisiCevap && kisiCevap > 0 ? kisiCevap : (satirlar.length || null)

  // Toplam gelir: 1) uyelere girilen gelirler 2) "toplam gelir" sorusu 3) ayni bolumdeki tablo toplami
  let toplamGelir: number | null = null
  let gelirKaynagi: GelirKaynagi | null = null
  if (sutunlar.gelir) {
    for (const r of satirlar) {
      const n = sayiOku(haneHucresi(r, sutunlar.gelir))
      if (n !== null) { toplamGelir = (toplamGelir ?? 0) + n; gelirKaynagi = 'uye' }
    }
  }
  if (toplamGelir === null) {
    const gelirSorusu = tumSorular.find((s) => s.anahtar === 'toplam_gelir')
    const beyan = gelirSorusu ? sayiOku(cevaplar[String(gelirSorusu.id)]) : null
    if (beyan !== null) {
      toplamGelir = beyan
      gelirKaynagi = 'beyan'
    } else if (gelirSorusu) {
      const bolum = sablon.bolumler.find((b) => b.sorular.some((s) => s.id === gelirSorusu.id))
      for (const t of bolum?.sorular ?? []) {
        if (t.tur !== 'tablo' || t.sabitSatirlar.length) continue
        for (const r of (cevaplar[String(t.id)] as TabloSatiri[] | undefined) ?? []) {
          for (const c of t.sutunlar.filter((x) => x.tur === 'sayi')) {
            const n = sayiOku(r.hucreler?.[c.id])
            if (n !== null) { toplamGelir = (toplamGelir ?? 0) + n; gelirKaynagi = 'tablo' }
          }
        }
      }
    }
  }
  const kisiBasi = toplamGelir !== null && kisiSayisi ? toplamGelir / kisiSayisi : null

  const saglikGirilmis = sutunlar.saglik ? satirlar.some((r) => haneHucresi(r, sutunlar.saglik)) : false
  const calisabilecek = sutunlar.saglik && sutunlar.yas && saglikGirilmis
    ? satirlar.filter((r) => calisabilirMi(r, sutunlar)).length
    : null

  const katkiCelisen = sutunlar.katki && sutunlar.gelir
    ? satirlar
      .filter((r) => trKucuk(haneHucresi(r, sutunlar.katki)) === 'yok' && (sayiOku(haneHucresi(r, sutunlar.gelir)) ?? 0) > 0)
      .map((r) => haneHucresi(r, sutunlar.ad) || haneHucresi(r, sutunlar.yakinlik) || 'Adı girilmemiş üye')
    : []

  return { soru, sutunlar, satirlar, kisiSayisi, toplamGelir, gelirKaynagi, kisiBasi, calisabilecek, katkiCelisen }
}

// Raporlarda tek hane uyesinin okunur satiri:
// "AHMET YILMAZ (48 yaş, eşi; sağlıklı; ücretli çalışma; aylık geliri 15.000 TL)"
export function haneUyesiMetni(satir: TabloSatiri, sutunlar: HaneSutunlari): string {
  const ad = haneHucresi(satir, sutunlar.ad)
  const yas = haneHucresi(satir, sutunlar.yas)
  const kimlik = [yas ? (/^\d+$/.test(yas) ? `${yas} yaş` : yas) : '', trKucuk(haneHucresi(satir, sutunlar.yakinlik))].filter(Boolean).join(', ')
  const gelir = sayiOku(haneHucresi(satir, sutunlar.gelir))
  const ekler = [
    kimlik,
    trKucuk(haneHucresi(satir, sutunlar.saglik)),
    trKucuk(haneHucresi(satir, sutunlar.calisma)),
    gelir !== null && gelir > 0 ? `aylık geliri ${tl(gelir)}` : '',
  ].filter(Boolean)
  if (!ad) return ekler.length ? ekler.join('; ') : ''
  return ekler.length ? `${ad} (${ekler.join('; ')})` : ad
}

export function ozetRaporuUret(sablon: Sablon, cevaplar: Cevaplar): OzetRapor {
  const tumSorular = sablon.bolumler.flatMap((b) => b.sorular)
  const otomatikDeger = (o: OtomatikDolum) => {
    const soru = tumSorular.find((s) => s.otomatik === o)
    return soru ? cevapMetni(soru, cevaplar[String(soru.id)]) || null : null
  }
  const anahtar = (a: RaporAnahtari) => anahtarliCevap(sablon, cevaplar, a)

  // --- hane bilgisi (form ekraniyla ayni hesap - haneAnalizi)
  const hane = haneAnalizi(sablon, cevaplar)
  const haneSatirlari = hane.satirlar
  const kisiSayisi = hane.kisiSayisi
  const yasSutunu = hane.sutunlar.yas
  const yaslar = yasSutunu ? haneSatirlari.map((r) => haneHucresi(r, yasSutunu)) : []
  // Hucrede tam yas (yeni) ya da eski yas grubu ("0-6", "7-17", "65+") olabilir.
  const yasSayisi = (y: string) => (/^\d{1,3}$/.test(y) ? Number(y) : null)
  const cocuk = yaslar.filter((y) => { const n = yasSayisi(y); return n !== null ? n < 18 : y === '0-6' || y === '7-17' }).length
  const yasli = yaslar.filter((y) => { const n = yasSayisi(y); return n !== null ? n >= 65 : y === '65+' }).length

  // --- gelir / gider (gelir: haneAnalizi; gider: sabit satirli tablolardaki sayisal sutunlar)
  const toplamGelir = hane.toplamGelir
  let giderToplami = 0
  let giderVar = false
  for (const soru of tumSorular) {
    if (soru.tur !== 'tablo' || soru.sabitSatirlar.length === 0) continue
    const sayiSutunlari = soru.sutunlar.filter((c) => c.tur === 'sayi')
    for (const satir of (cevaplar[String(soru.id)] as TabloSatiri[] | undefined) ?? []) {
      for (const c of sayiSutunlari) {
        const n = sayiOku(satir.hucreler?.[c.id])
        if (n !== null) { giderToplami += n; giderVar = true }
      }
    }
  }
  const kisiBasi = hane.kisiBasi

  const ziyaretSonucu = anahtar('ziyaret_sonucu')
  const aciliyet = anahtar('aciliyet')
  const gostergeler: OzetGosterge[] = [
    { etiket: 'Ziyaret sonucu', deger: ziyaretSonucu || '—', ton: ziyaretSonucu ? 'mavi' : 'notr' },
    { etiket: 'İhtiyacın aciliyeti', deger: aciliyet || '—', ton: aciliyetTonu(aciliyet) },
    { etiket: 'Hanedeki kişi sayısı', deger: kisiSayisi ? `${kisiSayisi} kişi` : '—', ton: 'notr' },
    ...(hane.calisabilecek !== null
      ? [{ etiket: 'Çalışabilecek birey', deger: `${hane.calisabilecek} kişi`, ton: (hane.calisabilecek > 0 ? 'yesil' : 'amber') as OzetGostergeTonu }]
      : []),
    { etiket: 'Aylık toplam gelir', deger: toplamGelir !== null ? tl(toplamGelir) : '—', ton: 'notr' },
    { etiket: 'Kişi başı aylık gelir', deger: kisiBasi !== null ? tl(Math.round(kisiBasi)) : '—', ton: 'notr' },
    { etiket: 'Aylık zorunlu gider', deger: giderVar ? tl(giderToplami) : '—', ton: 'notr' },
  ]
  if (toplamGelir !== null && giderVar) {
    const fark = toplamGelir - giderToplami
    gostergeler.push({ etiket: 'Gelir - gider farkı', deger: `${fark < 0 ? '−' : ''}${tl(Math.abs(fark))}`, ton: fark < 0 ? 'kirmizi' : 'yesil' })
  }

  // --- resmi dilde degerlendirme paragrafi
  const cumleler: string[] = []
  const kisi = otomatikDeger('basvuru_sahibi')
  const tarih = tarihGoster(otomatikDeger('ziyaret_zamani'))
  const personel = otomatikDeger('personel')
  if (kisi || tarih) {
    cumleler.push(`${tarih ? `${tarih} tarihinde ` : ''}${kisi ? `${kisi} adına kayıtlı hane için` : 'hane için'} ${personel ? `${personel} tarafından ` : ''}saha incelemesi gerçekleştirilmiştir${ziyaretSonucu ? `; ziyaret sonucu “${ziyaretSonucu}” olarak kaydedilmiştir` : ''}.`)
  } else if (ziyaretSonucu) {
    cumleler.push(`Ziyaret sonucu “${ziyaretSonucu}” olarak kaydedilmiştir.`)
  }
  if (kisiSayisi) {
    const ek: string[] = []
    if (cocuk) ek.push(`${cocuk} çocuk`)
    if (yasli) ek.push(`65 yaş üstü ${yasli} birey`)
    cumleler.push(`Hanede fiilen ${kisiSayisi} kişi yaşamaktadır${ek.length ? ` (${ek.join(', ')})` : ''}.`)
  }
  if (hane.calisabilecek !== null) {
    cumleler.push(hane.calisabilecek > 0
      ? `Hanede çalışabilecek durumda (sağlıklı, 18 yaş ve üzeri) ${hane.calisabilecek} birey bulunmaktadır.`
      : 'Hanede çalışabilecek durumda (sağlıklı, 18 yaş ve üzeri) birey bulunmamaktadır.')
  }
  if (toplamGelir !== null) {
    const uyeden = hane.gelirKaynagi === 'uye'
    let c = toplamGelir === 0
      ? 'Hanenin beyan edilen düzenli bir aylık geliri bulunmamaktadır'
      : `${uyeden ? 'Hane üyelerinin gelirleri toplandığında hanenin' : 'Hanenin'} aylık toplam geliri yaklaşık ${tl(toplamGelir)}${kisiBasi !== null ? ` olup kişi başına düşen gelir yaklaşık ${tl(Math.round(kisiBasi))}'dir` : `'dir`}`
    if (giderVar) c += `; bildirilen aylık zorunlu giderlerin toplamı ${tl(giderToplami)}'dir`
    cumleler.push(`${c}.`)
  } else if (giderVar) {
    cumleler.push(`Bildirilen aylık zorunlu giderlerin toplamı ${tl(giderToplami)}'dir.`)
  }
  const konut = anahtar('konut_durumu')
  if (konut) cumleler.push(`Konut durumu “${konut}” olarak tespit edilmiştir.`)
  const ihtiyac = anahtar('oncelikli_ihtiyac')
  if (ihtiyac || aciliyet) {
    cumleler.push(`${ihtiyac ? `Başvuru sahibinin öncelikli ihtiyacı “${ihtiyac}” olarak belirtilmiş` : 'Başvuru sahibinin ihtiyacı değerlendirilmiş'}${aciliyet ? `, aciliyeti “${aciliyet}” olarak değerlendirilmiştir` : ''}.`)
  }
  // Saha gozlemleri: sabit satirli, sayisal sutunu olmayan tablolar (ör.
  // "Gözlem ve değerlendirme") - ayni degeri alan konular tek cumlede.
  for (const soru of tumSorular) {
    if (soru.tur !== 'tablo' || soru.sabitSatirlar.length === 0 || soru.sutunlar.some((c) => c.tur === 'sayi')) continue
    const gruplar = new Map<string, string[]>()
    for (const satir of (cevaplar[String(soru.id)] as TabloSatiri[] | undefined) ?? []) {
      const deger = soru.sutunlar.slice(1).map((c) => String(satir.hucreler?.[c.id] ?? '').trim()).filter(Boolean).join(' / ')
      if (deger && satir.sabit) gruplar.set(deger, [...(gruplar.get(deger) ?? []), satir.sabit.toLocaleLowerCase('tr-TR')])
    }
    const parcalar = [...gruplar].map(([deger, konular]) => `${konular.length > 1 ? `${konular.slice(0, -1).join(', ')} ve ${konular[konular.length - 1]}` : konular[0]} “${deger}”`)
    if (parcalar.length) cumleler.push(`Saha gözleminde ${parcalar.join('; ')} olarak değerlendirilmiştir.`)
  }
  const onDegSoru = tumSorular.find((s) => s.anahtar === 'on_degerlendirme')
  const onDegMaddeleri = onDegSoru ? secenekMetinleri(onDegSoru, cevaplar[String(onDegSoru.id)]).map((m) => m.replace(/\s*\(.*?\)\s*$/, '').trim()) : []
  if (onDegMaddeleri.length) {
    const ilk = onDegMaddeleri.map((m, i) => (i === 0 ? m : m.charAt(0).toLocaleLowerCase('tr-TR') + m.slice(1)))
    cumleler.push(`Ön değerlendirme sonucunda ${ilk.length > 1 ? `${ilk.slice(0, -1).join('; ')} ve ${ilk[ilk.length - 1]}` : ilk[0]} olarak kayda alınmıştır.`)
  }

  // --- bolum bazli bulgular (otomatik dolan kimlik/iletisim alanlari haric)
  const tekrarEtme: (OtomatikDolum | null)[] = ['basvuru_sahibi', 'tc_kimlik_no', 'telefon', 'adres', 'personel', 'ziyaret_zamani']
  let doluAlan = 0
  let toplamAlan = 0
  const bulgular: OzetBulguBolumu[] = []
  sablon.bolumler.forEach((bolum, index) => {
    const maddeler: { soru: string; cevap: string }[] = []
    for (const soru of bolum.sorular) {
      toplamAlan += 1
      const metin = cevapMetni(soru, cevaplar[String(soru.id)])
      if (!metin) continue
      doluAlan += 1
      if (tekrarEtme.includes(soru.otomatik)) continue
      let cevap = metin
      if (soru.tur === 'tablo' && soru.otomatik === 'hane_uyeleri') {
        // "AD SOYAD (48 yaş, eşi; sağlıklı; ücretli çalışma; aylık geliri ...)" - okunur hane listesi
        cevap = hane.satirlar.map((r) => haneUyesiMetni(r, hane.sutunlar)).filter(Boolean).join('; ') || metin
      } else if (soru.tur === 'tarih' || soru.tur === 'tarih_saat') cevap = tarihGoster(metin) ?? metin
      else if (soru.tur === 'sayi') {
        const n = sayiOku(metin)
        if (n !== null) cevap = `${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}${soru.anahtar === 'toplam_gelir' ? ' TL' : ''}`
      }
      maddeler.push({ soru: soru.soruMetni, cevap })
    }
    if (maddeler.length > 0) bulgular.push({ no: index + 1, baslik: bolum.baslik, maddeler })
  })

  return { gostergeler, paragraf: cumleler.join(' '), bulgular, doluAlan, toplamAlan, cocukSayisi: cocuk }
}

// "Özet Rapor" karti (2026-10-13 kullanici istegi: "form bilgileri bir
// cumlede, personel raporu bir cumlede - genel ozet"). Ilk cumle formun ana
// bilgilerini, ikinci cumle personel raporunu tek cumle olarak verir.
export function ozetRaporCumleleri(sablon: Sablon, cevaplar: Cevaplar, personelRaporu: string, tarihYedek?: string | null): { form: string; personel: string } {
  const tumSorular = sablon.bolumler.flatMap((b) => b.sorular)
  const oto = (o: OtomatikDolum) => {
    const s = tumSorular.find((x) => x.otomatik === o)
    return s ? cevapMetni(s, cevaplar[String(s.id)]) || null : null
  }
  const kucuk = (m: string) => m.toLocaleLowerCase('tr-TR')
  const liste = (m: string) => {
    const p = m.split(/\s*,\s*/).filter(Boolean).map(kucuk)
    return p.length > 1 ? `${p.slice(0, -1).join(', ')} ve ${p[p.length - 1]}` : p[0] ?? ''
  }
  const rapor = ozetRaporuUret(sablon, cevaplar)
  const g = (etiket: string) => {
    const d = rapor.gostergeler.find((x) => x.etiket === etiket)?.deger
    return d && d !== '—' ? d : null
  }

  const kisi = oto('basvuru_sahibi')
  const personel = oto('personel')
  const tarih = tarihGoster(oto('ziyaret_zamani')) || tarihYedek || null
  const giris = [
    tarih ? `${tarih} tarihinde` : '',
    personel ? `${personel} tarafından` : '',
    kisi ? `${kisi} adına` : '',
    'yapılan saha incelemesinde',
  ].filter(Boolean).join(' ')

  const tespitler: string[] = []
  const ziyaret = anahtarliCevap(sablon, cevaplar, 'ziyaret_sonucu')
  if (ziyaret) tespitler.push(`ziyaret sonucunun “${ziyaret}”`)
  const kisiSayisi = g('Hanedeki kişi sayısı')
  const gelir = g('Aylık toplam gelir')
  const kisiBasi = g('Kişi başı aylık gelir')
  const gider = g('Aylık zorunlu gider')
  if (kisiSayisi) tespitler.push(`hanede ${kisiSayisi.replace(/\s*kişi$/, '')} kişinin${rapor.cocukSayisi ? ` (${rapor.cocukSayisi} çocuk)` : ''} yaşadığı`)
  const calisabilecek = g('Çalışabilecek birey')
  if (calisabilecek) {
    const n = calisabilecek.replace(/\s*kişi$/, '')
    tespitler.push(n === '0' ? 'çalışabilecek durumda bireyin bulunmadığı' : `çalışabilecek durumda ${n} bireyin bulunduğu`)
  }
  if (gelir) tespitler.push(`aylık gelirin ${gelir}${kisiBasi ? ` (kişi başı ${kisiBasi})` : ''}`)
  if (gider) tespitler.push(`aylık zorunlu giderin ${gider}`)
  const konut = anahtarliCevap(sablon, cevaplar, 'konut_durumu')
  if (konut) tespitler.push(`konut durumunun “${konut}”`)
  const ihtiyac = anahtarliCevap(sablon, cevaplar, 'oncelikli_ihtiyac')
  if (ihtiyac) tespitler.push(`öncelikli ihtiyacın ${liste(ihtiyac)}`)
  const aciliyet = anahtarliCevap(sablon, cevaplar, 'aciliyet')
  if (aciliyet) tespitler.push(`aciliyetin “${aciliyet}”`)

  let form = ''
  if (tespitler.length) {
    const son = tespitler.length > 1 ? `${tespitler.slice(0, -1).join(', ')} ve ${tespitler[tespitler.length - 1]}` : tespitler[0]
    form = `${giris}; ${son} olduğu tespit edilmiştir.`
  } else if (kisi || tarih) {
    form = `${giris} henüz bilgi girilmemiştir.`
  }
  form = form ? form.charAt(0).toLocaleUpperCase('tr-TR') + form.slice(1) : ''

  // 2026-10-14 kullanici istegi: personel raporu ozetin ICINE "Personel
  // değerlendirmesi: ..." diye gomulmez; ozetin altinda yeni satirda
  // "PERSONEL" basligi altinda, personelin yazdigi satir duzeniyle yer alir.
  // personel: sadece personelin metni (baslik yok) - basligi gosteren taraf ekler.
  const rp = personelRaporu.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const personelMetni = rp ? rp.charAt(0).toLocaleUpperCase('tr-TR') + rp.slice(1) : ''
  return { form, personel: personelMetni }
}

// Ozet + personel raporunun tek metin hali (Ev Ziyareti kaydi / Sonuc Bekleyen):
// ozet paragrafi, bos satir, "PERSONEL:" basligi ve alt satirda personel metni.
export function ozetRaporMetni(cumleler: { form: string; personel: string }): string {
  return [cumleler.form, cumleler.personel ? `PERSONEL:\n${cumleler.personel}` : ''].filter(Boolean).join('\n\n')
}

// Otomatik ozet rapor metni (formun altindaki "Otomatik özet rapor" alani ve
// yazdirma ciktisi). 2026-10-13 (4. tur) kullanici istegi: form bolumlerinin
// soru-cevap dokumu yerine birlesik raporla ayni kurumsal, tekrarsiz konu
// basliklari; kimlik bilgileri (ad, tarih, personel) formda zaten yazili
// oldugu icin burada yalnizca inceleme turu / ziyaret sonucu gibi ek bilgiler.
// 2026-10-13 (5. tur) kullanici istegi: Gecmis formlar kartindaki duzyazi
// genel ozet (ozetRaporuUret paragrafi) burada gosterilsin - numarali
// ayrintili rapor zaten Birlestirilmis raporda, iki panel ayni metni tekrarlamasin.
export function otomatikOzetMetni(sablon: Sablon, cevaplar: Cevaplar): string {
  return ozetRaporuUret(sablon, cevaplar).paragraf
}

// Otomatik ozet + personel raporunun BIRLESTIRILMIS kurumsal tahkikat raporu
// (kullanici istegi 2026-10-13). Duz metin - formda duzenlenebilir alan,
// yazdirmada ve Ev Ziyareti kaydinda aynen kullanilir.
export function birlesikRaporUret(args: {
  sablon: Sablon
  cevaplar: Cevaplar
  personelRaporu: string
  dosyaEtiketi?: string | null
  tarih?: string | null
}): string {
  const p = raporParcalari(args)
  const parcalar: string[] = [p.baslik]
  const kimlik = [...p.kimlikTemel, ...p.kimlikEk]
  if (kimlik.length) parcalar.push(kimlik.join('\n'))
  parcalar.push(...p.bolumler)
  if (args.personelRaporu.trim()) parcalar.push(`${p.bolumler.length + 1}. PERSONEL DEĞERLENDİRMESİ\n${args.personelRaporu.trim()}`)
  parcalar.push('Bu rapor, saha incelemesi sırasında alınan beyan, sunulan belgeler ve yapılan gözlemlere dayanmaktadır; nihai karar yetkili birim tarafından verilir.')
  return parcalar.join('\n\n')
}

function raporParcalari(args: {
  sablon: Sablon
  cevaplar: Cevaplar
  dosyaEtiketi?: string | null
  tarih?: string | null
}): { baslik: string; kimlikTemel: string[]; kimlikEk: string[]; bolumler: string[] } {
  const { sablon, cevaplar } = args
  const tumSorular = sablon.bolumler.flatMap((b) => b.sorular)
  const kullanilan = new Set<number>()
  const oto = (o: OtomatikDolum) => {
    const s = tumSorular.find((x) => x.otomatik === o)
    if (!s) return null
    kullanilan.add(s.id)
    return cevapMetni(s, cevaplar[String(s.id)]) || null
  }
  const anahtar = (a: RaporAnahtari) => {
    const s = tumSorular.find((x) => x.anahtar === a)
    if (s) kullanilan.add(s.id)
    return anahtarliCevap(sablon, cevaplar, a)
  }
  // 2026-10-13 (4. tur) kullanici istegi: "daha kurumsal ve anlasilir olsun,
  // tekrarlar kaldirilsin, profesyonel bir rapor ozeti olsun" - kimlik blogu +
  // numarali konu basliklari (Hane ve Konut / Ekonomik Durum / Saha
  // Gozlemleri / Ihtiyac ve Aciliyet / Sonuc ve Oneri). Anahtarsiz cevaplar
  // bulunduklari form bolumunun basligina gore ilgili konuya yerlestirilir;
  // ayni degeri alan gozlem satirlari tek satirda birlestirilir.
  for (const o of ['telefon', 'adres', 'tc_kimlik_no'] as OtomatikDolum[]) oto(o)

  const buyukBas = (m: string) => (m ? m.charAt(0).toLocaleUpperCase('tr-TR') + m.slice(1) : m)
  const kucukBas = (m: string) => (m && !/^\p{Lu}{2}/u.test(m) ? m.charAt(0).toLocaleLowerCase('tr-TR') + m.slice(1) : m)
  const etiketTemizle = (m: string) => m
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/[?:.]\s*$/, '')
    .replace(/\s+(varsa|gerekiyorsa|ise)$/i, '')
    .trim()
  // "... gerekli (yalnızca gerekli olanlar belirtilecek)" -> "... gereklidir."
  const maddeCumlesi = (m: string) => {
    const t = m.replace(/\s*\(.*?\)\s*$/, '').replace(/[.;,]\s*$/, '').trim()
    return `${buyukBas(/\bgerekli$/i.test(t) ? `${t}dir` : t)}.`
  }

  type Konu = 'kimlik' | 'hane' | 'ekonomi' | 'gozlem' | 'ihtiyac' | 'sonuc'
  const konular: Record<Konu, string[]> = { kimlik: [], hane: [], ekonomi: [], gozlem: [], ihtiyac: [], sonuc: [] }
  const konuBul = (bolumBasligi: string, index: number): Konu => {
    const b = bolumBasligi.toLocaleLowerCase('tr-TR')
    if (index === 0) return 'kimlik'
    if (/öneri|ön değerlendirme|sonuç|görüşme sonu/.test(b)) return 'sonuc'
    if (/gözlem/.test(b)) return 'gozlem'
    if (/gelir|gider|borç|çalışma/.test(b)) return 'ekonomi'
    if (/ihtiyaç|destek|beyan/.test(b)) return 'ihtiyac'
    if (/hane|konut|barınma|yaşam/.test(b)) return 'hane'
    return 'gozlem'
  }

  // --- baslik ve kimlik blogu
  const kisi = oto('basvuru_sahibi')
  const personel = oto('personel')
  const tarih = tarihGoster(oto('ziyaret_zamani')) || args.tarih || ''
  const baslik = `${(sablon.ayarlar.formBasligi || 'HANE ZİYARETİ VE SOSYAL İNCELEME').toLocaleUpperCase('tr-TR').replace(/\s+FORMU\s*$/, '')} RAPORU`
  const ekleKonu = (k: Konu, etiket: string, deger: string | null | undefined) => {
    if (deger && deger.trim()) konular[k].push(`${etiket}: ${buyukBas(deger.trim())}`)
  }
  const kimlikTemel = [
    ['Başvuru sahibi', kisi],
    ['Dosya no', args.dosyaEtiketi ? args.dosyaEtiketi.replace(/^ID\s*/i, '') : null],
    ['İnceleme tarihi', tarih],
    ['İnceleyen personel', personel],
  ].filter(([, d]) => d && d.trim()).map(([e, d]) => `${e}: ${d!.trim()}`)
  ekleKonu('kimlik', 'Ziyaret sonucu', anahtar('ziyaret_sonucu'))

  // --- hane uyeleri (madde listesi)
  // (haneAnalizi - form ekrani ve ozet raporla ayni hesap)
  const hane = haneAnalizi(sablon, cevaplar)
  oto('hane_kisi_sayisi')
  let uyeler: string[] = []
  if (hane.soru) {
    kullanilan.add(hane.soru.id)
    uyeler = hane.satirlar.map((r) => haneUyesiMetni(r, hane.sutunlar)).filter(Boolean)
  }
  if (hane.kisiSayisi) konular.hane.push(`Hanede ${hane.kisiSayisi} kişi yaşamaktadır${uyeler.length ? ':' : '.'}`)
  for (const u of uyeler) konular.hane.push(`  - ${u}`)
  if (hane.calisabilecek !== null) {
    konular.hane.push(`Çalışabilecek durumda birey (sağlıklı, 18 yaş ve üzeri): ${hane.calisabilecek > 0 ? `${hane.calisabilecek} kişi` : 'Bulunmamaktadır'}`)
  }
  ekleKonu('hane', 'Konut durumu', anahtar('konut_durumu'))

  // --- gelir / gider (ozet raporla ayni hesap)
  const rapor = ozetRaporuUret(sablon, cevaplar)
  const g = (etiket: string) => {
    const d = rapor.gostergeler.find((x) => x.etiket === etiket)?.deger
    return d && d !== '—' ? d : null
  }
  anahtar('toplam_gelir')
  // gider tablosu (sabit satirli + sayisal sutunlu) toplam olarak yazilir
  for (const s of tumSorular) if (s.tur === 'tablo' && s.sabitSatirlar.length && s.sutunlar.some((x) => x.tur === 'sayi')) kullanilan.add(s.id)

  // --- oncelikli ihtiyac / aciliyet / on degerlendirme
  const ihtiyac = anahtar('oncelikli_ihtiyac')
  const aciliyet = anahtar('aciliyet')
  const onDegSoru = tumSorular.find((x) => x.anahtar === 'on_degerlendirme')
  if (onDegSoru) kullanilan.add(onDegSoru.id)
  const onDegMaddeleri = onDegSoru ? secenekMetinleri(onDegSoru, cevaplar[String(onDegSoru.id)]) : []

  // --- anahtarsiz diger cevaplar: bulunduklari bolume gore ilgili konuya
  const gelirSatirlari: string[] = []
  sablon.bolumler.forEach((bolum, index) => {
    const konu = konuBul(bolum.baslik, index)
    for (const s of bolum.sorular) {
      if (kullanilan.has(s.id) || s.tur === 'imza' || s.otomatik) continue
      const etiket = etiketTemizle(s.soruMetni)
      const deger = cevaplar[String(s.id)]
      if (s.tur === 'tablo' && s.sabitSatirlar.length && !bosMu(s, deger)) {
        // Sabit satirli tablo (ör. gozlem): ayni degeri alan satirlar tek satirda
        const gruplar = new Map<string, string[]>()
        for (const satir of deger as TabloSatiri[]) {
          const kalan = s.sutunlar.slice(1).map((c) => String(satir.hucreler?.[c.id] ?? '').trim()).filter(Boolean).join(' / ')
          if (!kalan) continue
          const ad = satir.sabit || String(satir.hucreler?.[s.sutunlar[0]?.id] ?? '').trim()
          gruplar.set(kalan, [...(gruplar.get(kalan) ?? []), ad])
        }
        for (const [kalan, adlar] of gruplar) {
          konular[konu].push(`${buyukBas(adlar.map((a, i) => (i === 0 ? a : kucukBas(a))).join(', '))}: ${buyukBas(kalan)}`)
        }
        continue
      }
      const m = cevapMetni(s, deger)
      if (!m) continue
      if (s.tur === 'tek' && m === 'Evet' && !/\?\s*$/.test(s.soruMetni)) {
        konular[konu].push(`${etiket}.`) // "... bilgi verildi" -> dogrudan tespit cumlesi
      } else if (konu === 'ekonomi' && s.tur !== 'tablo') {
        gelirSatirlari.push(`${etiket}: ${buyukBas(m)}`)
      } else {
        konular[konu].push(`${etiket}: ${buyukBas(m)}`)
      }
    }
  })

  const gelir = g('Aylık toplam gelir')
  const kisiBasi = g('Kişi başı aylık gelir')
  const gider = g('Aylık zorunlu gider')
  const fark = g('Gelir - gider farkı')
  konular.ekonomi = [
    ...gelirSatirlari,
    ...(gelir ? [`Aylık toplam gelir: ${gelir}${kisiBasi ? ` (kişi başı ${kisiBasi})` : ''}${hane.gelirKaynagi === 'uye' ? ' - hane üyelerinin gelirleri toplamı' : ''}`] : []),
    ...(gider ? [`Aylık zorunlu gider: ${gider}`] : []),
    ...(fark ? [`Gelir-gider farkı: ${fark}`] : []),
    ...konular.ekonomi,
  ]
  konular.ihtiyac.unshift(
    ...(ihtiyac ? [`Öncelikli ihtiyaçlar: ${buyukBas(ihtiyac)}`] : []),
    ...(aciliyet ? [`Aciliyet derecesi: ${buyukBas(aciliyet)}`] : []),
  )
  konular.sonuc.unshift(...onDegMaddeleri.map((m) => `- ${maddeCumlesi(m)}`))

  const basliklar: [Konu, string][] = [
    ['hane', 'HANE VE KONUT DURUMU'],
    ['ekonomi', 'EKONOMİK DURUM'],
    ['gozlem', 'SAHA GÖZLEMLERİ'],
    ['ihtiyac', 'İHTİYAÇ VE ACİLİYET'],
    ['sonuc', 'SONUÇ VE ÖNERİ'],
  ]
  const bolumler = basliklar
    .filter(([k]) => konular[k].length)
    .map(([k, b], i) => `${i + 1}. ${b}\n${konular[k].join('\n')}`)
  return { baslik, kimlikTemel, kimlikEk: konular.kimlik, bolumler }
}

// Ev Ziyareti kaydina (evziyareti.rapor) ve listelere yazilan kisa ozet -
// ozet raporun degerlendirme paragrafi.
export function ozetMetniUret(sablon: Sablon, cevaplar: Cevaplar): string {
  return ozetRaporuUret(sablon, cevaplar).paragraf
}

// "dd.mm.yyyy" veya "yyyy-mm-dd" dogum tarihinden TAM YAS (kullanici istegi
// 2026-10-13: hane uyeleri tablosunda yas grubu yerine dosyadaki dogum
// tarihine gore gercek yas). Tarih yoksa/gecersizse bos.
export function yasHesapla(dogumTarihi: string | null | undefined, bugun = new Date()): string {
  const metin = String(dogumTarihi ?? '').trim()
  let yil: number, ay: number, gun: number
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(metin)
  if (m) {
    gun = Number(m[1]); ay = Number(m[2]); yil = Number(m[3])
  } else {
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(metin)
    if (!m) return ''
    yil = Number(m[1]); ay = Number(m[2]); gun = Number(m[3])
  }
  let yas = bugun.getFullYear() - yil
  if (bugun.getMonth() + 1 < ay || (bugun.getMonth() + 1 === ay && bugun.getDate() < gun)) yas -= 1
  return Number.isFinite(yas) && yas >= 0 && yas <= 130 ? String(yas) : ''
}

// "dd.mm.yyyy" veya "yyyy-mm-dd" dogum tarihinden yas grubu.
export function yasGrubu(dogumTarihi: string | null | undefined, bugun = new Date()): string {
  const metin = String(dogumTarihi ?? '').trim()
  let yil: number, ay: number, gun: number
  let eslesme = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(metin)
  if (eslesme) {
    gun = Number(eslesme[1]); ay = Number(eslesme[2]); yil = Number(eslesme[3])
  } else {
    eslesme = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(metin)
    if (!eslesme) return ''
    yil = Number(eslesme[1]); ay = Number(eslesme[2]); gun = Number(eslesme[3])
  }
  let yas = bugun.getFullYear() - yil
  if (bugun.getMonth() + 1 < ay || (bugun.getMonth() + 1 === ay && bugun.getDate() < gun)) yas -= 1
  if (!Number.isFinite(yas) || yas < 0 || yas > 130) return ''
  if (yas <= 6) return '0-6'
  if (yas <= 17) return '7-17'
  if (yas <= 64) return '18-64'
  return '65+'
}
