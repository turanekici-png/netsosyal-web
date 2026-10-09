// Inceleme Formu v2 (eleme kriterli + otomatik puanlamali) sistemin ortak
// tipleri. Mevcut "eski" inceleme formu sistemiyle (app/api/documents/
// inceleme-formu/route.ts, lib/constants/evaluationForm.ts) KARISTIRILMASIN -
// bu, kullanicinin ayrica istedigi, tamamen paralel yeni bir sistemdir.

export type SoruBolum = 'bilgi' | 'kriter' | 'degerlendirme' | 'gozlem'
export type SecimTuru = 'tek' | 'coklu' | 'metin' | 'sayi'
export type OnayDurumu = 'beklemede' | 'onaylandi' | 'reddedildi' | 'onay_gerekmiyor'
export type EliminasyonSonucu = 'KABUL' | 'RED'
export type Karar = 'Kritik' | 'Yuksek' | 'Orta' | 'Dusuk' | 'Yardim Gerekmiyor'

// "Hanenin Aylik Gelir Durumu" sorusu gibi standart "secilen secenegin
// puanini topla" mantigina uymayan ozel puanlama kurallari icin. Yeni bir
// kural gerektiginde scoring.ts'teki registry'e eklenir, semaya dokunulmaz.
export type PuanlamaKurali = 'gelir_kademeli'

export type SecenekRow = {
  id: number
  soruId: number
  sira: number
  secenekMetni: string
  puan: number
  redTetikler: boolean
  yoneticiOnayi: boolean
  aktif: boolean
}

export type SoruRow = {
  id: number
  bolum: SoruBolum
  sira: number
  soruMetni: string
  secimTuru: SecimTuru
  zorunlu: boolean
  aktif: boolean
  redKriteri: boolean
  redSecenegi: string | null
  sistemSorusu: boolean
  puanlamaKurali: PuanlamaKurali | null
  secenekler: SecenekRow[]
}

// Bir soruya verilen cevap (POST /api/documents/inceleme-degerlendirme
// istek govdesindeki her eleman).
export type CevapPayload = {
  soruId: number
  secilenSecenekler?: number[]
  metinCevap?: string | null
  sayiCevap?: number | null
}

export type CevapSonucu = CevapPayload & {
  toplamPuan: number | null
}

export type DigerKurumYardimi = {
  kurum: string
  yardimTuru?: string
  tutar?: number | null
}

export type IncelemeDegerlendirmeFormPayload = {
  dosyaid: string
  tarih?: string | null
  personel?: string | null
  tcKimlikNo?: string | null
  adSoyad?: string | null
  telefon?: string | null
  adres?: string | null
  il?: string | null
  ilce?: string | null
  koy?: string | null
  muhtarAdi?: string | null
  digerKurumYardimlari?: DigerKurumYardimi[]
  yardimTuruOnerisi?: string | null
  // Kisi basi gelir hesabi icin (SORU 1 "gelir_kademeli" kurali) - ayri,
  // acik bir sayisal alan. Degerlendirme bolumundeki bantli "Hane Kisi
  // Sayisi" sorusundan (puanlama amacli) KASITLI OLARAK BAGIMSIZDIR.
  haneKisiSayisi?: number | null
  // Kullanici istegi (13 Eylul 2026): "tahkikat gorevlisinin doldurmus
  // oldugu rapor ozetini ilgili dosyanin Tahkikat ve Raporlar alanindaki
  // Ev Ziyareti alanina tarih/konu/rapor seklinde yazsin (evziyareti
  // tablosu)" - formda istemci tarafinda uretilen kisa, kurumsal ozet
  // paragrafi (ozetParagrafi) burada tasinir; backend bunu oldugu gibi
  // evziyareti.rapor'a yazar (bkz. route.ts POST handler).
  raporOzeti?: string | null
  cevaplar: CevapPayload[]
}

export type EvaluationResult = {
  eliminasyonSonucu: EliminasyonSonucu
  eliminasyonRedNedeni: string | null
  toplamPuan: number | null
  maksimumPuan: number
  karar: Karar | null
  // Karar araligina gore onerilen varsayilan yardim turu metni (spesifikasyon
  // "karar tablosu"ndaki onerileri) - personel bunu formda degistirebilir.
  yardimTuruOnerisiOnerilen: string | null
  onayDurumu: OnayDurumu
  cevapSonuclari: CevapSonucu[]
}

// PDF/Excel uretimi ve form detay ekrani icin - cevabi soru metni/bolumu ve
// secilen secenek metinleriyle birlikte "duz" (insan tarafindan okunabilir)
// haliyle tasir.
export type CevapDetay = {
  soruId: number
  soruMetni: string
  bolum: SoruBolum
  secimTuru: SecimTuru
  secilenSecenekMetinleri: string[]
  metinCevap: string | null
  sayiCevap: number | null
  toplamPuan: number | null
}

export type IncelemeDegerlendirmeFormDetay = IncelemeDegerlendirmeFormRow & {
  cevaplar: CevapDetay[]
}

export type IncelemeDegerlendirmeFormRow = {
  id: string
  dosyaid: string
  tarih: string
  personel: string | null
  tcKimlikNo: string | null
  adSoyad: string | null
  telefon: string | null
  adres: string | null
  il: string | null
  ilce: string | null
  koy: string | null
  muhtarAdi: string | null
  haneKisiSayisi: number | null
  digerKurumYardimlari: DigerKurumYardimi[]
  toplamPuan: number | null
  maksimumPuan: number
  karar: Karar | null
  yardimTuruOnerisi: string | null
  eliminasyonSonucu: EliminasyonSonucu | null
  eliminasyonRedNedeni: string | null
  onayDurumu: OnayDurumu
  onayNotu: string | null
  kullaniciid: number | null
  olusturmaTarihi: string
  guncellemeTarihi: string
}
