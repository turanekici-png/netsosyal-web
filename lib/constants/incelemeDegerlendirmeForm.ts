// Inceleme Formu v2 (eleme kriterli + otomatik puanlamali) - istemci
// tarafinda kullanilan tipler. Sunucu tarafindaki karsiligi
// app/api/documents/inceleme-degerlendirme/_lib/types.ts'de tanimlidir;
// JSON uzerinden konustuklarindan burada BAGIMSIZ ama AYNI SEKILDE
// tutuluyor (client bundle'ina sunucuya-ozel kod/pg baglantisi sizmasin
// diye ayri dosya).
//
// Mevcut "eski" sistemle (lib/constants/evaluationForm.ts) KARISTIRILMASIN -
// bu, kullanicinin ayrica istedigi, tamamen paralel yeni bir sistemdir.

export type SoruBolum = 'bilgi' | 'kriter' | 'degerlendirme' | 'gozlem'
export type SecimTuru = 'tek' | 'coklu' | 'metin' | 'sayi'
export type OnayDurumu = 'beklemede' | 'onaylandi' | 'reddedildi' | 'onay_gerekmiyor'
export type EliminasyonSonucu = 'KABUL' | 'RED'
export type Karar = 'Kritik' | 'Yuksek' | 'Orta' | 'Dusuk' | 'Yardim Gerekmiyor'
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

export type DigerKurumYardimi = {
  kurum: string
  yardimTuru?: string
  tutar?: number | null
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

export const BOLUM_BASLIKLARI: Record<SoruBolum, string> = {
  bilgi: 'Bilgi',
  kriter: 'Eleme Kriterleri',
  degerlendirme: 'Değerlendirme',
  gozlem: 'Gözlem',
}

export function getKararRenk(puan: number | null): 'yesil' | 'sari' | 'turuncu' | 'kirmizi' | 'gri' {
  if (puan === null) return 'gri'
  if (puan >= 80) return 'yesil'
  if (puan >= 60) return 'sari'
  if (puan >= 40) return 'turuncu'
  return 'kirmizi'
}

export const KARAR_RENK_SINIFLARI: Record<ReturnType<typeof getKararRenk>, string> = {
  yesil: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sari: 'border-amber-200 bg-amber-50 text-amber-700',
  turuncu: 'border-orange-200 bg-orange-50 text-orange-700',
  kirmizi: 'border-rose-200 bg-rose-50 text-rose-700',
  gri: 'border-slate-200 bg-slate-50 text-slate-700',
}
