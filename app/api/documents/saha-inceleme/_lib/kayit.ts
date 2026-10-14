import type { Cevaplar, Sablon, SahaIncelemeDetay, SahaIncelemeKaydi } from '@/lib/constants/sahaIncelemeForm'

export type FormSatiri = {
  id: string | number
  dosyaid: string | number
  dosya_no: string | null
  tarih: Date | string
  personel: string | null
  ad_soyad: string | null
  tc_kimlik_no: string | null
  telefon: string | null
  adres: string | null
  ziyaret_sonucu: string | null
  aciliyet: string | null
  oncelikli_ihtiyac: string | null
  on_degerlendirme: string | null
  ozet: string | null
  personel_aciklamasi?: string | null
  personel_raporu?: string | null
  cevaplar: Cevaplar | null
  sablon: Sablon | null
  kullaniciid: number | null
  olusturma_tarihi: Date | string
  evziyareti_id?: string | null
}

function tarihMetni(value: Date | string): string {
  if (value instanceof Date) {
    // DATE kolonu - pg yerel gece yarisi Date'i dondurur; yerel parcalari kullan.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

export function kayitOzetiniEsle(row: FormSatiri): SahaIncelemeKaydi {
  return {
    id: String(row.id),
    dosyaid: String(row.dosyaid),
    dosyaNo: row.dosya_no,
    tarih: tarihMetni(row.tarih),
    personel: row.personel,
    adSoyad: row.ad_soyad,
    ziyaretSonucu: row.ziyaret_sonucu,
    aciliyet: row.aciliyet,
    oncelikliIhtiyac: row.oncelikli_ihtiyac,
    onDegerlendirme: row.on_degerlendirme,
    ozet: row.ozet,
    personelAciklamasi: row.personel_aciklamasi ?? null,
    personelRaporu: row.personel_raporu ?? null,
    kullaniciid: row.kullaniciid,
    olusturmaTarihi: row.olusturma_tarihi instanceof Date ? row.olusturma_tarihi.toISOString() : String(row.olusturma_tarihi),
    evziyaretiId: row.evziyareti_id ?? null,
  }
}

export function kayitDetayiniEsle(row: FormSatiri): SahaIncelemeDetay {
  return {
    ...kayitOzetiniEsle(row),
    tcKimlikNo: row.tc_kimlik_no,
    telefon: row.telefon,
    adres: row.adres,
    cevaplar: row.cevaplar ?? {},
    sablon: row.sablon ?? { ayarlar: {} as Sablon['ayarlar'], bolumler: [] },
  }
}

export function normalizeBigInt(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? text : null
}
