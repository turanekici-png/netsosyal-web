// Kullanicidan gelen tutar girdisini (ör. "1.500,50", "1500.5", " 250 TL")
// PostgreSQL `numeric` kolonuna yazilmaya hazir bir string'e cevirir.
//  - Rakam disi karakterler ayiklanir (para birimi, bosluk vb.)
//  - Hem "," hem "." ondalik ayirici olarak kabul edilir; birden fazla
//    ayirici varsa SONUNCUSU ondalik, oncekiler binlik ayirici sayilir.
//  - Bos / gecersiz / negatif -> '' (yani NULL saklanir).
export function normalizeAmount(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value).trim()
  if (!text) return ''

  // Rakam, virgul, nokta ve bastaki eksi disindaki her seyi at.
  text = text.replace(/[^0-9.,-]/g, '')
  const negative = text.startsWith('-')
  text = text.replace(/-/g, '')
  if (!text) return ''

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  const decimalPos = Math.max(lastComma, lastDot)

  let normalized: string
  if (decimalPos === -1) {
    normalized = text.replace(/[.,]/g, '')
  } else {
    const intPart = text.slice(0, decimalPos).replace(/[.,]/g, '')
    const fracPart = text.slice(decimalPos + 1).replace(/[.,]/g, '')
    normalized = `${intPart || '0'}.${fracPart}`
  }

  const num = Number(normalized)
  if (!Number.isFinite(num) || num < 0 || negative) return ''
  // 2 ondalik basamakla sinirla (numeric(18,2)).
  return num.toFixed(2)
}
