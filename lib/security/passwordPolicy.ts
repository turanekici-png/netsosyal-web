// Bu dosya `lib/security/password.ts`'in aksine "server-only" DEGIL - hem
// istemci (login/sifre degistirme formunda aninda geri bildirim) hem sunucu
// (asil zorlama) tarafinda AYNI kurali kullanmak icin ortak, saf metin
// dogrulama mantigi burada tutuluyor.
//
// Kural (guvenlik guncellemesi, Agustos 2026 - eskiden 6 karakterdi):
// en az 8 karakter, EN AZ bir buyuk harf ve EN AZ bir rakam - konumlari
// onemli degil. Geri kalan karakterler serbest (kucuk harf, sembol, vb.).
// Ornek: "Sivas2026", "aB3xxxxx", "Yardim-01".
export const MIN_PASSWORD_LENGTH = 8

export const PASSWORD_POLICY_DESCRIPTION =
  'En az 8 karakter olmalı; içinde en az 1 büyük harf ve en az 1 rakam bulunmalı (yerleri fark etmez) - geri kalanını istediğiniz gibi belirleyebilirsiniz.'

export function isValidNewPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return false
  return /[A-Z]/.test(password) && /[0-9]/.test(password)
}
