// "On Inceleme Formu" icin ayarlar anahtari ve tipler.
// Bu form, Inceleme Formu (coktan secmeli + puanlama) ve Guncelleme Formu (coktan
// secmeli, puansiz) formlarindan farkli olarak SERBEST METIN cevaplidir: admin
// burada sadece bir "bilgi" (soru/alan adi) listesi tanimlar - ornegin
// "Arac Bilgisi" veya "Aylik Gelir" - her satirin karsisina da doldurulacak
// cevap icin bir ornek/ipucu metni yazabilir (ornegin "1 adet arac var",
// "25000 TL"). Gercek cevap, bu formun kullanildigi ekranda (henuz baglanmadi)
// serbest metin olarak girilir; onceden tanimlanmis secenekler yoktur.
//
// Ayarlar > Sistem Ayarlari > "On Inceleme Formu Tasarimi" ekranindan duzenlenir
// ve settingService araciligiyla (sistem_ayarlar tablosunda) tek bir JSON deger
// olarak saklanir - evaluation_form_template / update_form_template ayarlariyla
// ayni desen.

export const PRELIMINARY_REVIEW_FORM_TEMPLATE_SETTING_KEY = 'preliminary_review_form_template'

// Kullanici istegi (13 Eylul 2026): "vergi mükellefiyeti var yada yok diye
// eklenebilsin" - bazi bilgiler serbest metin yerine sabit "Var / Yok"
// secenekleriyle doldurulabilsin diye alana opsiyonel bir tur eklendi.
// Eski kayitlarda fieldType alani YOK - bu yuzden okunurken 'metin' varsayilir
// (geriye donuk uyumluluk, asagidaki normalizePreliminaryReviewFieldType).
export type PreliminaryReviewFieldType = 'metin' | 'var_yok'

export type PreliminaryReviewField = {
  id: string
  label: string
  example: string
  fieldType?: PreliminaryReviewFieldType
}

export type PreliminaryReviewFormTemplate = PreliminaryReviewField[]

export const DEFAULT_PRELIMINARY_REVIEW_FORM_TEMPLATE: PreliminaryReviewFormTemplate = []

export function createEmptyPreliminaryReviewField(): PreliminaryReviewField {
  return {
    id: `bilgi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: '',
    example: '',
    fieldType: 'metin',
  }
}

export function normalizePreliminaryReviewFieldType(field: PreliminaryReviewField): PreliminaryReviewFieldType {
  return field.fieldType === 'var_yok' ? 'var_yok' : 'metin'
}
