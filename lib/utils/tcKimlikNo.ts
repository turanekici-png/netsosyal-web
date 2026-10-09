// TC Kimlik No dogrulama - resmi algoritma (Nufus ve Vatandaslik Isleri
// Genel Mudurlugu'nun yayimladigi kontrol basamagi formulu). Sadece 11 haneli
// olmasi YETERLI DEGIL - bu dosya, rastgele/hatali yazilmis 11 haneli bir
// sayinin GERCEK bir TC kimlik no OLMADIGINI da yakalar (kontrol basamaklari
// tutmuyorsa gecersiz sayilir). Prisma/Node'a ozel hicbir sey icermez - hem
// client (documents/page.tsx - "Yardım Kişileri (TC)" alani) hem de server
// (app/api/documents/applications/route.ts) tarafindan kullanilir.
//
// Algoritma:
// - 11 hane, ilk hane 0 olamaz.
// - Tek sirali (1,3,5,7,9.) hanelerin toplami * 7, cift sirali (2,4,6,8.)
//   hanelerin toplami cikarilip mod 10 alinir -> 10. hane bu olmalidir.
// - Ilk 10 hanenin toplaminin mod 10'u -> 11. hane bu olmalidir.
export function isValidTcKimlikNo(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false
  const digits = value.split('').map(Number)
  if (digits[0] === 0) return false

  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8]
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7]
  const expectedTenth = (((oddSum * 7 - evenSum) % 10) + 10) % 10
  if (expectedTenth !== digits[9]) return false

  const firstTenSum = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0)
  const expectedEleventh = firstTenSum % 10
  if (expectedEleventh !== digits[10]) return false

  return true
}
