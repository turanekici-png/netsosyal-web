// Nakit Yardımı / Online Başvuru otomatik red açıklamalarının ve iptal
// nedenlerinin ORTAK metin kuralları (istemci + sunucu).
//
// Kullanici istegi (2026-10-14): "otomatik red açıklamasını daha kurumsal
// ve anlaşılır şekilde hazırlasın" - eskiden kısa ve 100 karakterde kesilen
// parçalar ("Araç modeli (2018) tanımlı sınırın (2006) üzerinde") ya da
// Yardım Kriterleri'nde girilmiş bir not (ör. "EAÜE") açıklamanın YERİNE
// yazılıyordu. Artık tam cümleli, numaralı gerekçeli bir metin üretilir.

// yrd_ayninakti.durumuaciklama 100'den 500 karaktere genişletildi
// (bkz. lib/services/cashReasonColumn.ts).
export const CASH_REASON_MAX_LENGTH = 500

// İptal nedeninde otomatik red açıklaması ile kullanıcının yazdığı neden
// arasına konan ayraç (kullanıcı isteği: "aralarında ------- işareti").
export const CANCEL_REASON_SEPARATOR = ' ------- '

const AUTO_REJECT_INTRO = 'Başvuru, yardım kriterlerini karşılamadığından sistem tarafından otomatik olarak reddedilmiştir.'

export function formatAutoRejectExplanation(reasons: string[]): string {
  const clean = reasons
    .map((reason) => String(reason || '').trim().replace(/[.;\s]+$/, ''))
    .filter(Boolean)
  if (clean.length === 0) return ''

  const body = clean.length === 1
    ? `${clean[0]}.`
    : clean.map((reason, index) => `${index + 1}) ${reason}.`).join(' ')

  return `${AUTO_REJECT_INTRO} Gerekçe: ${body}`.slice(0, CASH_REASON_MAX_LENGTH)
}

export function formatTurkishLira(value: number): string {
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`
}

// İptal nedeni = [otomatik red açıklaması] ------- [kullanıcının yazdığı]
// (hangisi varsa). İkisi de boşsa boş döner.
export function buildCancelReason(autoReason: string | null | undefined, manualReason: string | null | undefined): string {
  return [autoReason, manualReason]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(CANCEL_REASON_SEPARATOR)
    .slice(0, CASH_REASON_MAX_LENGTH)
}
