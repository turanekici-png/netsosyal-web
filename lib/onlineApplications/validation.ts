// Personel düzenleme penceresi için doğrulamalar - vatandaş formundaki
// (app/api/online-applications/route.ts) kurallarla aynı.
function isValidTurkishIbanChecksum(iban: string) {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (char) => (char.charCodeAt(0) - 55).toString())
  let remainder = 0
  for (let index = 0; index < numeric.length; index += 1) {
    remainder = (remainder * 10 + Number(numeric[index])) % 97
  }
  return remainder === 1
}

export function normalizeIbanInput(value: string) {
  return value.replace(/\s+/g, '').toUpperCase()
}

export function validateOnlineApplicationEdit(input: { iban?: string | null; phone?: string | null; vehicleModelYear?: string | null }): string | null {
  const iban = normalizeIbanInput(input.iban || '')
  if (iban && !(/^TR\d{24}$/.test(iban) && isValidTurkishIbanChecksum(iban))) {
    return 'İBAN geçersiz: TR ile başlamalı, 26 karakter olmalı ve doğrulama hanesi tutmalı.'
  }
  const phoneDigits = (input.phone || '').replace(/\D/g, '')
  if (input.phone?.trim() && phoneDigits.length !== 10 && phoneDigits.length !== 11) {
    return 'Telefon 10 veya 11 haneli olmalıdır. Örnek: 05XXXXXXXXX'
  }
  const year = (input.vehicleModelYear || '').trim()
  if (year) {
    const numericYear = Number(year)
    if (!/^\d{4}$/.test(year) || numericYear < 1950 || numericYear > new Date().getFullYear() + 1) {
      return 'Araç model yılı 4 haneli geçerli bir yıl olmalıdır. Örnek: 2015'
    }
  }
  return null
}
