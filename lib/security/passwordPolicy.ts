// Bu dosya `lib/security/password.ts`'in aksine "server-only" DEGIL - hem
// istemci (login/sifre degistirme formunda aninda geri bildirim) hem sunucu
// (asil zorlama) tarafinda AYNI kurali kullanmak icin ortak, saf metin
// dogrulama mantigi burada tutuluyor.
//
// Kural (kullanici istegi, 2026-10-13 - Agustos 2026'daki "en az 8 karakter +
// 1 buyuk harf + 1 rakam" kuralinin yerine): en az 6 karakter, EN AZ bir
// buyuk harf ve EN AZ bir kucuk harf - konumlari onemli degil. Geri kalan
// karakterler serbest (rakam, sembol, vb.). Turkce harfler (Ç, Ğ, İ, Ö, Ş, Ü /
// ç, ğ, ı, ö, ş, ü) da sayilir. Ornek: "Sivas1", "aBcdef", "Yardım".
//
// ONEMLI: Bu kural YALNIZCA yeni sifre belirlenirken uygulanir (kullanici
// ekleme/duzenleme, sifre degistirme). Giris (login/route.ts) sifreyi sadece
// kayitli ozetle karsilastirir; mevcut kullanicilarin sifreleri bu kurala
// uymasa bile girisleri ETKILENMEZ. Gecici sifre sifirlama
// (user.service.ts resetPassword) da bu kurali kullanmaz.
export const MIN_PASSWORD_LENGTH = 6

export const PASSWORD_POLICY_DESCRIPTION =
  'En az 6 karakter olmalı; içinde en az 1 büyük harf ve en az 1 küçük harf bulunmalı (yerleri fark etmez) - geri kalanını istediğiniz gibi belirleyebilirsiniz.'

export function isValidNewPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return false
  return /[A-ZÇĞİÖŞÜ]/.test(password) && /[a-zçğıöşü]/.test(password)
}
