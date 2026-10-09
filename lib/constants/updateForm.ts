// Dosya "Guncelleme Formu" (on inceleme formu) icin ayarlar anahtari ve tipler.
// Bu sablon, Ayarlar > Sistem Ayarlari > "Guncelleme Formu Tasarimi" ekranindan
// duzenlenir ve settingService araciligiyla (sistem_ayarlar tablosunda) tek bir
// JSON deger olarak saklanir - evaluation_form_template ayari ile ayni desen.
//
// Inceleme formundan farkli olarak burada puanlama yok; sadece soru/cevap
// toplanip dosyaya kaydediliyor. Kullanici dosyayi "ON INCELEME YAPILMIS"
// durumuna aldiginda (Dosya Durumu ekraninda) bu form doldurulur, kaydedilir
// ve ardindan dosyanin durumu otomatik olarak "ON INCELEME YAPILMIS" yapilir.
//
// Varsayilan sablon BILEREK BOS birakildi: admin Ayarlar'dan en az bir soru
// eklemedigi surece dosya durumu degistirme akisi ESKISI GIBI (bu formu hic
// acmadan) calismaya devam eder - yani ozellik acikca yapilandirilana kadar
// hicbir davranis degismez.

export const UPDATE_FORM_TEMPLATE_SETTING_KEY = 'update_form_template'

export type UpdateFormOption = {
  id: string
  label: string
}

export type UpdateFormSection = {
  id: string
  title: string
  multiple: boolean
  note: string
  options: UpdateFormOption[]
}

export type UpdateFormTemplate = UpdateFormSection[]

export const DEFAULT_UPDATE_FORM_TEMPLATE: UpdateFormTemplate = []

export function createEmptyUpdateFormOption(): UpdateFormOption {
  return { id: `secenek_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label: '' }
}

export function createEmptyUpdateFormSection(): UpdateFormSection {
  return {
    id: `soru_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    multiple: false,
    note: '',
    options: [createEmptyUpdateFormOption()],
  }
}
