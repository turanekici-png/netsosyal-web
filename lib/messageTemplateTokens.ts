// SMS/WhatsApp mesajlarında kullanılabilecek "(kısayol)" parantezli
// tokenlar - hem TEK kişiye gönderimde (documents/page.tsx - SMS Gönder
// penceresi) hem TOPLU gönderimde (BulkWhatsappSendButton) AYNI kelime
// dağarcığı kullanılır. Kullanıcı serbest metin içinde bu parantezli
// tokenları yazdığında, gönderim ANINDA o alıcının GERÇEK verisiyle
// değiştirilir - veri o alıcı için mevcut değilse "-" ile değiştirilir
// (token OLDUĞU GİBİ kalmaz, kullanıcı yanlışlıkla ham "(isim)" metnini
// göndermiş olmaz).
export interface MessageTemplateTokenValues {
  isim?: string | null
  telefon?: string | null
  dosyano?: string | null
  iban?: string | null
  // Ekmek Yardımı başlangıç/bitiş - tek kişi gönderiminde dosyanın Ekmek
  // Yardımı kaydından (yrd_ekmek), toplu gönderimde seçili satırın kendi
  // bastarih/bittarih alanından gelir.
  ebaslangic?: string | null
  ebitis?: string | null
  ebaslangicbitis?: string | null
  // Gıda Bankası / Destek Paketi "alışveriş günleri" başlangıç/bitiş -
  // dosyanın Gıda Bankası (yoksa Destek Paketi) kaydındaki, kişinin
  // MAHALLESİNE atanmış "Ödeme Günü"nden hesaplanan gerçek alışveriş
  // penceresinden (paymentStartDate/paymentEndDate) gelir - dönemin
  // (bastarih/bittarih, genelde tüm ay) KENDİSİ DEĞİLDİR.
  abaslangic?: string | null
  abitis?: string | null
  abaslangicbitis?: string | null
}

export const MESSAGE_TEMPLATE_TOKEN_DEFINITIONS: { token: string; key: keyof MessageTemplateTokenValues; description: string }[] = [
  { token: '(isim)', key: 'isim', description: 'Alıcının adı soyadı' },
  { token: '(telefon)', key: 'telefon', description: 'Alıcının telefon numarası' },
  { token: '(dosyano)', key: 'dosyano', description: 'Dosya numarası' },
  { token: '(iban)', key: 'iban', description: 'Nakit yardım IBAN numarası' },
  { token: '(ebaşlangıç)', key: 'ebaslangic', description: 'Ekmek yardımı başlangıç tarihi' },
  { token: '(ebitiş)', key: 'ebitis', description: 'Ekmek yardımı bitiş tarihi' },
  { token: '(ebaşlangıçbitiş)', key: 'ebaslangicbitis', description: 'Ekmek yardımı başlangıç-bitiş tarih aralığı (ör. gıda alışveriş dönemi gibi tek parça bildirmek için)' },
  { token: '(abaşlangıç)', key: 'abaslangic', description: 'Gıda Bankası / Destek Paketi alışveriş başlangıç günü' },
  { token: '(abitiş)', key: 'abitis', description: 'Gıda Bankası / Destek Paketi alışveriş bitiş günü' },
  { token: '(abaşlangıçbitiş)', key: 'abaslangicbitis', description: 'Gıda Bankası / Destek Paketi alışveriş gün aralığı (ör. "ayın şu günleri alışveriş yapabilirsiniz")' },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Iki tarihi (varsa) "DD.MM.YYYY - DD.MM.YYYY" seklinde tek bir metne
// birlestirir - sadece biri doluysa onu tek basina, ikisi de bossa null
// doner.
export function combineDateRange(start: string | null | undefined, end: string | null | undefined): string | null {
  const cleanStart = start && start !== '-' ? start.trim() : ''
  const cleanEnd = end && end !== '-' ? end.trim() : ''
  if (cleanStart && cleanEnd) return `${cleanStart} - ${cleanEnd}`
  return cleanStart || cleanEnd || null
}

// Mesaj metni icindeki TUM taninan "(token)"lari, verilen degerlerle
// degistirir. Bir token metinde hic gecmiyorsa dokunulmaz (performans icin
// onceden kisa devre) - gecen ama o alici icin degeri olmayan tokenlar "-"
// ile degistirilir.
export function applyMessageTemplateTokens(template: string, values: MessageTemplateTokenValues): string {
  let result = template
  for (const def of MESSAGE_TEMPLATE_TOKEN_DEFINITIONS) {
    if (!result.toLocaleLowerCase('tr-TR').includes(def.token.toLocaleLowerCase('tr-TR'))) continue
    const pattern = new RegExp(escapeRegExp(def.token), 'gi')
    const value = values[def.key]
    result = result.replace(pattern, value && value.trim() ? value.trim() : '-')
  }
  return result
}
