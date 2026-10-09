// Dosya inceleme formu (puanlama anketi) icin ayarlar anahtari ve tipler.
// Bu sablon, Ayarlar > Sistem Ayarlari > "Inceleme Formu Tasarimi" ekranindan
// duzenlenir ve settingService araciligiyla (sistem_ayarlar tablosunda) tek bir
// JSON deger olarak saklanir - form_design_templates ayari ile ayni desen.
//
// NOT: Bu dosya su an sadece tasarim/duzenleme ekranini besliyor. Dosya
// inceleme ekranindaki (app/(modules)/documents/page.tsx) puanlama, henuz bu
// ayari OKUMUYOR - o ekran kendi sabit soru listesini kullanmaya devam ediyor.
// Asagidaki varsayilan sablon, bilerek o sabit listenin bir kopyasidir; boylece
// tasarim ekranini ilk acan kullanici bos bir formla degil, halihazirda
// kullanilan gercek form ile karsilasir ve onun uzerinden duzenleme yapabilir.

export const EVALUATION_FORM_TEMPLATE_SETTING_KEY = 'evaluation_form_template'

export type EvaluationFormOption = {
  id: string
  label: string
  score: number
}

export type EvaluationFormSection = {
  id: string
  title: string
  maxScore: number
  multiple: boolean
  note: string
  options: EvaluationFormOption[]
}

export type EvaluationFormTemplate = EvaluationFormSection[]

export const DEFAULT_EVALUATION_FORM_TEMPLATE: EvaluationFormTemplate = [
  {
    id: 'workAbility',
    title: '1. Calisabilir Birey Durumu',
    maxScore: 20,
    multiple: false,
    note: 'Yalnizca en uygun bir secenek secilir.',
    options: [
      { id: 'none', label: 'Hanede calisabilecek yasta birey yok', score: 20 },
      { id: 'disabled', label: 'Var; engel veya agir saglik nedeniyle calisamiyor', score: 20 },
      { id: 'military', label: 'Askerlik gorevinde', score: 18 },
      { id: 'student', label: 'Orgun egitim ogrencisi', score: 18 },
      { id: 'prison', label: 'Cezaevinde / hukumlu', score: 18 },
      { id: 'caregiver', label: 'Tam bagimli kisiye veya kucuk cocuga surekli bakim veriyor', score: 15 },
      { id: 'unemployed', label: 'Is ariyor / issiz', score: 10 },
      { id: 'noExcuse', label: 'Hanede gecerli mazereti olmayan veya duzenli calisan yetiskin birey var', score: 0 },
    ],
  },
  {
    id: 'health',
    title: '2. Saglik Durumu',
    maxScore: 15,
    multiple: false,
    note: 'Ayni kisi icin puanlar toplanmaz; en yuksek secenek uygulanir.',
    options: [
      { id: 'dependent', label: 'Tam bagimli / yatalak / surekli bakima muhtac', score: 15 },
      { id: 'disabled70', label: '%70 ve uzeri engelli', score: 13 },
      { id: 'disabled40', label: '%40 - %69 engelli', score: 10 },
      { id: 'severeIllness', label: 'Surekli tedavi gerektiren agir hastalik', score: 10 },
      { id: 'chronic', label: 'Kronik hastalik / duzenli ilac gideri', score: 7 },
      { id: 'none', label: 'Hanede yardim ihtiyacini artiran ozel saglik yuku bulunmuyor', score: 0 },
    ],
  },
  {
    id: 'children',
    title: '3. Cocuk Durumu',
    maxScore: 10,
    multiple: true,
    note: 'Birden fazla kutu secilebilir; bolum toplami 10u gecmez.',
    options: [
      { id: 'age0_6', label: '0-6 yas cocuk var', score: 7 },
      { id: 'schoolAge', label: 'Okul caginda cocuk var', score: 7 },
      { id: 'university', label: 'Universite ogrencisi var', score: 6 },
      { id: 'specialNeeds', label: 'Engelli / ozel gereksinimli cocuk var', score: 10 },
      { id: 'orphan', label: 'Yetim / oksuz cocuk var', score: 10 },
    ],
  },
  {
    id: 'marital',
    title: '4. Es / Medeni Durum',
    maxScore: 10,
    multiple: false,
    note: 'Medeni hal degil, olusan gecim ve bakim yuku olculur.',
    options: [
      { id: 'widowed', label: 'Esi vefat etmis; gecimi tek basina yurutuyor', score: 10 },
      { id: 'spousePrison', label: 'Esi cezaevinde', score: 10 },
      { id: 'spouseDependent', label: 'Esi agir engelli / tam bagimli', score: 10 },
      { id: 'singleParent', label: 'Bosanmis / ayri ve cocuk bakimini tek basina ustleniyor', score: 10 },
      { id: 'aloneUnable', label: 'Yalniz yasiyor; yas / saglik nedeniyle calisamiyor', score: 8 },
      { id: 'none', label: 'Es / medeni durum kaynakli ozel bakim ve gecim riski bulunmuyor', score: 0 },
    ],
  },
  {
    id: 'housing',
    title: '5. Barinma Durumu',
    maxScore: 10,
    multiple: false,
    note: '',
    options: [
      { id: 'rent', label: 'Hane kiraci olarak ikamet ediyor', score: 10 },
      { id: 'temporary', label: 'Gecici barinma / barinma guvencesi yok', score: 10 },
      { id: 'relative', label: 'Akraba / baskasi yaninda bagimli ikamet', score: 9 },
      { id: 'repair', label: 'Kendi evi; ciddi onarim ihtiyaci var', score: 5 },
      { id: 'ownGood', label: 'Kendi evi; oturulabilir durumda', score: 0 },
    ],
  },
  {
    id: 'property',
    title: '6. Mulkiyet Durumu',
    maxScore: 7,
    multiple: false,
    note: '',
    options: [
      { id: 'none', label: 'Gelir getirici / kullanilabilir mal varligi yok', score: 7 },
      { id: 'lowValueLand', label: 'Dusuk degerli, gelir getirmeyen kucuk tarla / arsa', score: 5 },
      { id: 'oldVehicle', label: 'Zorunlu kullanilan eski / dusuk degerli tek arac', score: 3 },
      { id: 'valuable', label: 'Ikinci konut, is yeri, gelir getirici arazi veya degerli arac', score: 0 },
    ],
  },
  {
    id: 'food',
    title: '7. Gida Durumu',
    maxScore: 5,
    multiple: false,
    note: '',
    options: [
      { id: 'cannotProvide', label: 'Temel gidayi duzenli temin edemiyor / ogun atliyor', score: 5 },
      { id: 'aidBased', label: 'Agirlikli olarak yardimla gida temin ediyor', score: 3 },
      { id: 'regular', label: 'Hanenin temel gidaya duzenli erisimi var', score: 0 },
    ],
  },
  {
    id: 'homeStatus',
    title: '8. Evin Genel Durumu',
    maxScore: 3,
    multiple: false,
    note: '',
    options: [
      { id: 'bad', label: 'Cok kotu / sagliksiz / guvensiz / temel donanim yetersiz', score: 3 },
      { id: 'medium', label: 'Evin genel durumu orta seviyede; eksikleri var ancak oturulabilir durumda', score: 3 },
      { id: 'good', label: 'Evin genel durumu iyi ve temel yasam kosullari yeterli', score: 0 },
    ],
  },
  {
    id: 'socialRisk',
    title: '9. Sosyal Risk / Acil Durum',
    maxScore: 3,
    multiple: false,
    note: '',
    options: [
      { id: 'urgent', label: 'Yangin, sel, afet, tahliye, siddet veya ani agir kriz', score: 3 },
      { id: 'none', label: 'Hanede acil sosyal risk veya kriz durumu bulunmuyor', score: 0 },
    ],
  },
  {
    id: 'dependencyBurden',
    title: '10. Hane Bakim ve Bagimlilik Yuku',
    maxScore: 10,
    multiple: true,
    note: 'Birden fazla kutu secilebilir; bolum toplami 10u gecmez.',
    options: [
      { id: 'elderly', label: 'Hanede 65 yas ustu bakim destegi gerektiren birey var', score: 7 },
      { id: 'dependentCare', label: 'Hanede surekli bakim gerektiren bagimli birey var', score: 9 },
      { id: 'manyChildren', label: 'Hanede uc veya daha fazla cocuk bulunuyor', score: 8 },
      { id: 'singleCaregiver', label: 'Hanenin bakim ve gecim yuku tek kisi uzerinde toplanmis', score: 9 },
      { id: 'none', label: 'Hanede ek bakim veya bagimlilik yuku bulunmuyor', score: 0 },
    ],
  },
  {
    id: 'expenseBurden',
    title: '11. Zorunlu Gider ve Borc Yuku',
    maxScore: 10,
    multiple: true,
    note: 'Birden fazla kutu secilebilir; bolum toplami 8i gecmez.',
    options: [
      { id: 'rentDebt', label: 'Kira, fatura veya temel gider borcu nedeniyle gecim guclugu yasiyor', score: 7 },
      { id: 'medicalExpense', label: 'Duzenli ilac, tedavi, ulasim veya medikal gider yuku var', score: 7 },
      { id: 'educationExpense', label: 'Cocuklarin egitim, servis, kiyafet veya kirtasiye gider yuku var', score: 6 },
      { id: 'foodExpense', label: 'Temel gida ve mutfak giderlerini karsilamakta zorlaniyor', score: 7 },
      { id: 'none', label: 'Hanenin yardim ihtiyacini artiran zorunlu gider veya borc yuku yok', score: 0 },
    ],
  },
  {
    id: 'aidPriority',
    title: '12. Yardim Onceligi ve Sureklilik Ihtiyaci',
    maxScore: 9,
    multiple: false,
    note: 'Hanenin yardima ne kadar acil ve surekli ihtiyac duydugu degerlendirilir.',
    options: [
      { id: 'urgentContinuous', label: 'Yardim acil ve surekli nitelikte gereklidir', score: 9 },
      { id: 'temporaryStrong', label: 'Gecici ancak guclu yardim ihtiyaci bulunuyor', score: 8 },
      { id: 'limited', label: 'Sinirli veya tek seferlik destek ihtiyaci bulunuyor', score: 6 },
      { id: 'monitoring', label: 'Sosyal takip onerilir ancak acil yardim ihtiyaci dusuk', score: 3 },
      { id: 'none', label: 'Yardim onceligi dusuk olarak degerlendiriliyor', score: 0 },
    ],
  },
]

export function createEmptyEvaluationOption(): EvaluationFormOption {
  return { id: `secenek_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label: '', score: 0 }
}

export function createEmptyEvaluationSection(): EvaluationFormSection {
  return {
    id: `soru_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    maxScore: 10,
    multiple: false,
    note: '',
    options: [createEmptyEvaluationOption()],
  }
}
