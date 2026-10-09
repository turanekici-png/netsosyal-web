// Kullanici istegi (Eylul 2026): "tum telefon numaralari 0 ile baslasin,
// aralarinda bosluk / ozel karakter olmasin". Dosya, birey ve muracaat
// kayitlarina telefon yazilirken bu standarda cevrilir; mevcut kayitlar da
// tek seferlik migration ile duzeltilir (scripts/fix-phone-format.mjs).
//
// Kural:
//  - SADECE rakam kalir (bosluk, +, -, (), / vb. atilir)
//  - +90 / 90XXXXXXXXXX (12+ hane) / 0090... ulke kodu atilir
//  - sonuc HER ZAMAN tek bir "0" ile baslar (05XXXXXXXXX cep, 0XXXXXXXXXX sabit)
//  - bos / rakamsiz girdi -> bos string

export function normalizeTrPhone(raw: string | null | undefined): string {
  let digits = String(raw ?? '').replace(/\D+/g, '')
  if (!digits) return ''

  if (digits.startsWith('0090')) {
    digits = digits.slice(4)
  } else if (digits.startsWith('90') && digits.length >= 12) {
    digits = digits.slice(2)
  } else {
    // Bastaki tum sifirlari at - asagida tek bir "0" eklenecek.
    digits = digits.replace(/^0+/, '')
  }

  if (!digits) return ''
  return `0${digits}`
}

export function normalizeTrPhoneOrNull(raw: string | null | undefined): string | null {
  const normalized = normalizeTrPhone(raw)
  return normalized || null
}
