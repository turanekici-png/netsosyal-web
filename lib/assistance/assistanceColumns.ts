// 2026-10-15 kullanici istegi: "Yardımlar altindaki tum yardim raporlari ve
// sekmeleri de Dosyalar/Bireyler gibi olsun" - yrd_* tablolarinin TUM
// alanlari listede (az kullanilanlar gizli baslar, Sütun Görünürlüğü'nden
// acilir), Turkce basliklar ve panel gruplari TEK yerden.
// Kullanan: AssistanceListPage, AssistanceRequestListPage, ekmek/page.tsx.

// Kullanici adi (kaydi acan / son islem yapan) - "t" takma adli her sorguda
// calisan skaler alt sorgu; JOIN gerektirmedigi icin sayim/filtre/deger
// listesi sorgularina da guvenle eklenir. Kullanici silinmisse id gorunur.
const kullaniciAdiSql = (idSutunu: string) => `(
  SELECT COALESCE(NULLIF(BTRIM(ku.kullanicitamadi), ''), NULLIF(BTRIM(ku.kullaniciadi), ''))
  FROM kullanicilar ku WHERE ku.id = ${idSutunu}
)`
export const ASSISTANCE_USER_COLUMN_SQL: Record<string, string> = {
  kaydi_acan: `COALESCE(${kullaniciAdiSql('t.ilkkullaniciid')}, NULLIF(t.ilkkullaniciid, 0)::text)`,
  son_islem_yapan: `COALESCE(${kullaniciAdiSql('t.kullaniciid')}, NULLIF(t.kullaniciid, 0)::text)`,
}

export const ASSISTANCE_USER_COLUMNS_SELECT = Object.entries(ASSISTANCE_USER_COLUMN_SQL)
  .map(([anahtar, ifade]) => `${ifade} AS ${anahtar}`)
  .join(',\n        ')

type ColumnDef = { label: string; group: string }

const DOSYA = 'Dosya'
const KISI = 'Kişi'
const YARDIM = 'Yardım / Müracaat'
const DONEM = 'Dönem ve Ödeme'
const NAKIT = 'Nakit Değerlendirme'
const MESAJ = 'Son Mesaj'
const KAYIT = 'Kayıt Bilgisi'

const COLUMNS: Record<string, ColumnDef> = {
  // --- dosya (dosyalar d / bireyler) kaynakli sanal sutunlar
  id: { label: 'Kayıt ID', group: KAYIT },
  dosyaid: { label: 'Dosya ID', group: DOSYA },
  dosyano: { label: 'Dosya No', group: DOSYA },
  dosya_durumu: { label: 'Dosya Durumu', group: DOSYA },
  inceleme_puani: { label: 'İnceleme Puanı', group: DOSYA },
  mahalle: { label: 'Mahalle', group: DOSYA },
  dosya_adresi: { label: 'Dosya Adresi', group: DOSYA },
  dosya_telefonu: { label: 'Dosya Telefonu', group: DOSYA },
  ceptel: { label: 'Cep Telefonu', group: DOSYA },
  gulkart: { label: 'Gülkart', group: DOSYA },
  // --- kisi
  muracaateden: { label: 'Müracaat Eden', group: KISI },
  adisoyadi: { label: 'Adı Soyadı', group: KISI },
  tckimlikno: { label: 'TC Kimlik No', group: KISI },
  dogumtarihi: { label: 'Doğum Tarihi', group: KISI },
  dogumyeri: { label: 'Doğum Yeri', group: KISI },
  babaadi: { label: 'Baba Adı', group: KISI },
  anaadi: { label: 'Ana Adı', group: KISI },
  uyrugu: { label: 'Uyruğu', group: KISI },
  cinsiyeti: { label: 'Cinsiyet', group: KISI },
  medenihali: { label: 'Medeni Hali', group: KISI },
  medenihal: { label: 'Medeni Hal', group: KISI },
  saglikdurumu: { label: 'Sağlık Durumu', group: KISI },
  hastalikadi: { label: 'Hastalık Adı', group: KISI },
  nufuskytili: { label: 'Nüfus Kayıt İli', group: KISI },
  topbirey: { label: 'Toplam Birey', group: KISI },
  adres: { label: 'Başvuru Adresi', group: KISI },
  // --- yardim / muracaat
  muracaattarihi: { label: 'Müracaat Tarihi', group: YARDIM },
  durumu: { label: 'Müracaat Durumu', group: YARDIM },
  durumutarih: { label: 'Durum Tarihi', group: YARDIM },
  durumuaciklama: { label: 'Durum Açıklaması', group: YARDIM },
  etiket: { label: 'Etiket', group: YARDIM },
  miktar: { label: 'Miktar', group: YARDIM },
  alisverismiktari: { label: 'Alışveriş Miktarı', group: YARDIM },
  ekmekmiktari: { label: 'Ekmek Miktarı', group: YARDIM },
  kahvaltimiktari: { label: 'Kahvaltı Miktarı', group: YARDIM },
  kisisayisi: { label: 'Kişi Sayısı', group: YARDIM },
  yardimkisisayisi: { label: 'Yardım Kişi Sayısı', group: YARDIM },
  yardimkisitc: { label: 'Yardım Kişileri (TC)', group: YARDIM },
  tutar: { label: 'Tutar', group: YARDIM },
  tarih: { label: 'Tarih', group: YARDIM },
  nedeni: { label: 'Nedeni', group: YARDIM },
  gidecegiyer: { label: 'Gideceği Yer', group: YARDIM },
  aciklama: { label: 'Açıklama', group: YARDIM },
  muracaataciklama: { label: 'Müracaat Açıklaması', group: YARDIM },
  muracaatnotu: { label: 'Müracaat Notu', group: YARDIM },
  muracaatozelkod: { label: 'Müracaat Özel Kodu', group: YARDIM },
  yetkili: { label: 'Yetkili', group: YARDIM },
  yetkiliadi: { label: 'Yetkili Adı', group: YARDIM },
  kartno: { label: 'Kart No', group: YARDIM },
  karttarih: { label: 'Kart Tarihi', group: YARDIM },
  kartaciklama: { label: 'Kart Açıklaması', group: YARDIM },
  durakadi: { label: 'Durak Adı', group: YARDIM },
  sureturu: { label: 'Süre Türü', group: YARDIM },
  // --- donem ve odeme
  donem: { label: 'Dönem', group: DONEM },
  donemadi: { label: 'Dönem Adı', group: DONEM },
  donemint: { label: 'Dönem Kodu', group: DONEM },
  donemstr: { label: 'Dönem (Metin)', group: DONEM },
  ensondonem: { label: 'En Son Dönem', group: DONEM },
  bastarih: { label: 'Başlangıç Tarihi', group: DONEM },
  bittarih: { label: 'Bitiş Tarihi', group: DONEM },
  dnm_durumu: { label: 'Dönem Durumu', group: DONEM },
  dnm_bastarih: { label: 'Dönem Başlangıç Tarihi', group: DONEM },
  dnm_durumuaciklama: { label: 'Dönem Durum Açıklaması', group: DONEM },
  dnm_durumutarih: { label: 'Dönem Durum Tarihi', group: DONEM },
  odemegunu: { label: 'Ödeme Günü', group: DONEM },
  odeme_baslangic: { label: 'Alışveriş Başlangıcı', group: DONEM },
  odeme_bitis: { label: 'Alışveriş Bitişi', group: DONEM },
  // --- nakit degerlendirme
  asama: { label: 'Aşama', group: NAKIT },
  asamanotu: { label: 'Aşama Notu', group: NAKIT },
  asamaozelkod: { label: 'Aşama Özel Kodu', group: NAKIT },
  tahkikatpers: { label: 'Tahkikat Personeli', group: NAKIT },
  aylikgelir: { label: 'Aylık Gelir', group: NAKIT },
  iban: { label: 'IBAN', group: NAKIT },
  mulkiyetbilgisi: { label: 'Mülkiyet Bilgisi', group: NAKIT },
  aracbilgisi: { label: 'Araç Bilgisi', group: NAKIT },
  otomatikrediptal: { label: 'Otomatik Red İptal', group: NAKIT },
  // --- son mesaj
  son_mesaj_tarihi: { label: 'Son Mesaj Tarihi', group: MESAJ },
  son_mesaj_kanali: { label: 'Son Mesaj Kanalı', group: MESAJ },
  son_mesaj_durumu: { label: 'Son Mesaj Durumu', group: MESAJ },
  son_mesaj_alici: { label: 'Son Mesaj Alıcısı', group: MESAJ },
  // --- kayit bilgisi
  kaydi_acan: { label: 'Kaydı Açan', group: KAYIT },
  son_islem_yapan: { label: 'Son İşlem Yapan', group: KAYIT },
  kullaniciid: { label: 'Kullanıcı ID', group: KAYIT },
  ilkkullaniciid: { label: 'İlk Kullanıcı ID', group: KAYIT },
  islemtarihi: { label: 'İşlem Tarihi', group: KAYIT },
  ilkislemtarihi: { label: 'İlk İşlem Tarihi', group: KAYIT },
}

export const ASSISTANCE_COLUMN_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMNS).map(([key, def]) => [key, def.label]),
)

// Sozlukte olmayan (tabloya sonradan eklenmis) bir alan panelde "Diğer"
// grubunda gorunur - AdvancedTable bu varsayilani kendisi uygular.
export const ASSISTANCE_COLUMN_GROUPS: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMNS).map(([key, def]) => [key, def.group]),
)

// Ham/teknik oldugu icin listede HIC gosterilmeyen yardimci alanlar
// (yalniz hesaplama icin secilir).
export const ASSISTANCE_ALWAYS_EXCLUDED = ['mahalle_odeme_gunu', 'mahalle_odeme_gunu_bitis']

// Her sayfada varsayilan olarak gizli baslayan (ama acilabilen) alanlar.
// Sayfa config'lerindeki eski "excludedColumns" listesi de bunlara eklenir -
// onceden TAMAMEN gizlenen alanlar artik Sütun Görünürlüğü'nden acilabilir.
export const ASSISTANCE_DEFAULT_HIDDEN = [
  'kullaniciid', 'ilkkullaniciid', 'kaydi_acan', 'son_islem_yapan', 'dosyaid',
]

export function assistanceHiddenColumns(configExcluded: string[]) {
  return Array.from(new Set([...ASSISTANCE_DEFAULT_HIDDEN, ...configExcluded]))
    .filter((key) => !ASSISTANCE_ALWAYS_EXCLUDED.includes(key))
}
