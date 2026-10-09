import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import {
  DEFAULT_ONLINE_APPLICATION_FORMS,
  isFormCurrentlyPublished,
  normalizeOnlineApplicationCriteria,
  ONLINE_APPLICATION_FORMS_SETTING_KEY,
  type OnlineApplication,
} from '@/lib/constants/onlineApplicationForms'
import { settingService } from '@/lib/services'
import { checkRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { extractVehicleYear, findYardimKriteriValue, parseFreeFormAmount } from '@/lib/nakitCriteria'
import { OTOMATIK_RED_STAGE, INCELENECEK_STAGE } from '@/lib/services/cashAutoReject.service'

export const dynamic = 'force-dynamic'

// Kullanici istegi (2026-09-22): "etiket bilgisi alanına ve tüm
// başvurularda NAKİT YARDIMI yazsın" - yardim TURU (yardim_turu/assistanceType)
// ne olursa olsun (Universite Yardimi, Yakacak Yardimi, vb.) online
// basvuru sisteminden gelen HER kayit ic islem tarafinda "NAKİT YARDIMI"
// etiketiyle isaretlenir - kaydedilir kaydedilmez dolu gelsin diye, personel
// ayrica elle girmek ZORUNDA kalmasin.
const ONLINE_APPLICATION_DEFAULT_ETIKET = 'NAKİT YARDIMI'

type OnlineApplicationPayload = {
  formId?: string
  formTitle?: string
  values?: Record<string, string>
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

// Kullanici istegi (2026-09-28): "aderiste köyü ibaresi var ise ... bu
// yardıma başvuru yapabilmeniz için sivas merkezde ikamet etmeniz
// gerekmektedir diyerek başvuru yapmasına izin vermeyelim" - TUM online
// formlar icin GENEL bir kural (kullanici bunu boyle secti). Istemci
// tarafinda (OnlineApplicationClient.tsx) AYNI kontrol NVI sorgusu
// sonucuna gore aninda uyguluyor; burasi, arayuzu atlayip dogrudan bu uc
// noktaya istek atan biri icin savunma katmani.
function extractVillageName(address: string): string | null {
  const upper = address.toLocaleUpperCase('tr-TR')
  // "\b" burada BILEREK kullanilmiyor - bkz. OnlineApplicationClient.tsx'teki
  // AYNI fonksiyondaki aciklama (JS regex \b, ASCII olmayan "Ü" ile dogru
  // calismiyor, gercek "... KÖYÜ ..." adresleri yakalanamiyordu).
  const match = upper.match(/([^\s,]+)\s+KÖYÜ(?=\s|$)/)
  return match ? match[1] : null
}

function normalizeLabel(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldKey(field: { id: string; label: string }) {
  const label = normalizeLabel(field.label)
  if (label.includes('tc') || label.includes('kimlik')) return 'tc'
  if (label.includes('doÄŸum')) return 'birthDate'
  if (label.includes('ad soyad') || label.includes('adÄ± soyadÄ±')) return 'fullName'
  if (label.includes('adres no') || label.includes('adresno')) return 'addressNo'
  if (label.includes('adres')) return 'address'
  if (label.includes('telefon') || label.includes('cep')) return 'phone'
  if (label.includes('gelir')) return 'income'
  // Kullanici istegi (2026-09-22): "başvuru alırken bazı alanları
  // doldurmuyor" - kok neden: bu kontrol "durum" KELIMESININ de gecmesini
  // sart kosuyordu, ama admin bu alani "Araç Bilgisi" (sadece "araç",
  // "durum" kelimesi YOK) olarak adlandirmisti - eslesme HIC yakalanmiyor,
  // deger canlı formun kendi rastgele alan ID'si (f_...) altinda
  // saklaniyordu, raporlar/duzenleme penceresi ise SADECE 'vehicleStatus'
  // anahtarina bakiyordu - bu yuzden vatandas GERCEKTEN cevap vermis olsa
  // bile bos gorunuyordu. Artik "model" GECMEYEN her "araç/arac" iceren
  // etiket vehicleStatus sayilir (Araç Bilgisi, Araç Durumu, sadece Araç
  // vb. hepsini kapsar); "model" gecen ("Araç Modeli" gibi) ONCE kontrol
  // edilip vehicleModelYear'a ayriliyor.
  const mentionsVehicle = label.includes('araç') || label.includes('araÃ§') || label.includes('arac')
  if (mentionsVehicle && label.includes('model')) return 'vehicleModelYear'
  if (mentionsVehicle) return 'vehicleStatus'
  if (label.includes('iban')) return 'iban'
  return field.id
}

function normalizeIban(value: string) {
  const compactValue = value.replace(/\s+/g, '').toUpperCase()
  const digits = compactValue.startsWith('TR')
    ? compactValue.slice(2).replace(/\D/g, '')
    : compactValue.replace(/\D/g, '')
  return digits ? `TR${digits.slice(0, 24)}` : ''
}

// ISO 13616 MOD-97 saglama kontrolu: ilk 4 karakter (TR + 2 kontrol hanesi)
// sona alinir, harfler sayiya cevrilir (A=10...Z=35, TR icin sadece T=29/
// R=27 gerekir) ve sonuc 97'ye bolununce kalan 1 olmalidir - GERCEK bir
// IBAN'in bankasi ne olursa olsun HER ZAMAN saglayacagi, uluslararasi
// standart bir formul (bu yuzden dogru bir IBAN'i yanlislikla reddetme
// riski yok, sadece yazim hatalarini yakalar).
function isValidTurkishIbanChecksum(iban: string) {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (char) => (char.charCodeAt(0) - 55).toString())
  let remainder = 0
  for (let index = 0; index < numeric.length; index += 1) {
    remainder = (remainder * 10 + Number(numeric[index])) % 97
  }
  return remainder === 1
}

function isValidTurkishIban(value: string) {
  const normalized = normalizeIban(value)
  return /^TR\d{24}$/.test(normalized) && isValidTurkishIbanChecksum(normalized)
}

// Kullanici istegi (2026-09-22): "araç modeli girildiğinde mutlaka 4 hane
// olmalı ... yanlış girilmiş ise uyarı verilmeli" - istemci tarafinda zaten
// engelleniyor (OnlineApplicationClient.tsx) ama savunma katmani olarak
// sunucu da AYNI kurali dogrular (dogrudan API'ye istek atilarak bu
// kontrol atlatilamasin diye).
function isValidVehicleModelYear(value: string) {
  if (!/^\d{4}$/.test(value)) return false
  const year = Number(value)
  const currentYear = new Date().getFullYear()
  return year >= 1950 && year <= currentYear + 1
}

function isValidPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 10 || digits.length === 11
}

function cleanNumber(value: unknown) {
  const text = cleanText(value).replace(/\./g, '').replace(',', '.')
  const match = text.match(/\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

function getFieldValue(values: Record<string, string>, fields: Array<{ id: string; label: string }>, key: string) {
  const field = fields.find((candidate) => fieldKey(candidate) === key)
  return field ? cleanText(values[fieldKey(field)]) : ''
}

function splitFullName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { ad: fullName, soyad: '' }

  return {
    ad: parts.slice(0, -1).join(' '),
    soyad: parts[parts.length - 1],
  }
}

function calculateAge(birthDate: string) {
  const date = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null

  const today = new Date()
  let age = today.getFullYear() - date.getFullYear()
  const monthDiff = today.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1
  }
  return age
}

async function getOnlineForms() {
  try {
    const setting = await settingService.getByKey(ONLINE_APPLICATION_FORMS_SETTING_KEY)
    return Array.isArray(setting?.value)
      ? setting.value as OnlineApplication[]
      : DEFAULT_ONLINE_APPLICATION_FORMS
  } catch {
    return DEFAULT_ONLINE_APPLICATION_FORMS
  }
}

// Kullanici istegi (2026-09-22): "buradaki yardım kriterleri alanını
// kaldıralım bunun yerine ... ayarlar sistem ayarları içindeki yardım
// kriterleri alanında bulunan aynı dönem bilgisine ait yardım kriterlerini
// uygula, böylelikle aynı anda birkaç dönem bilgisi ile yardım başvurusu
// alsak dahi her yardım dönemi için kendine ait olan kriterleri uygulamış
// oluruz" - eskiden TEK/GLOBAL bir online-basvuru-ozel ayar
// (ONLINE_APPLICATION_AUTO_CRITERIA_SETTING_KEY, bkz. kaldirilan
// OnlineAutoCriteriaPanel) TUM formlara AYNI siniri uyguluyordu. Artik
// PAYLASIMLI Hazır Değerler > "Yardım Kriterleri" listesinden (Ayarlar >
// Sistem Ayarları > Yardım Kriterleri - AYNI mekanizma Nakit Yardımı
// muracaatlarinin Otomatik Red kontrolunde de kullanilir, bkz.
// lib/services/cashAutoReject.service.ts), BU BASVURUNUN KENDI dönemine
// (= Form Başlığı, artik "Dönem Bilgisi" hazir deger listesinden secildigi
// icin ikisi AYNI kelime dagarcigini paylasir) ozel tanimlanmis sinirlar
// okunur. Bir dönem icin tanim yoksa "Tüm Dönemler" (dönemsiz) genel deger
// varsa o kullanilir, o da yoksa o kriter kontrol edilmez (sessizce atlanir
// - bkz. findYardimKriteriValue).
async function getDonemCriteriaLimits(donem: string) {
  const { values } = await predefinedValuesService.getAll()
  const criteriaList = values.yardimKriterleri ?? []

  const gelirRaw = findYardimKriteriValue(criteriaList, donem, ['aylik gelir', 'gelir'])
  const yasAltRaw = findYardimKriteriValue(criteriaList, donem, ['yas alt siniri', 'yas alt sinir', 'minimum yas', 'yas alt'])
  const yasUstRaw = findYardimKriteriValue(criteriaList, donem, ['yas ust siniri', 'yas ust sinir', 'maksimum yas', 'yas ust'])
  const aracRaw = findYardimKriteriValue(criteriaList, donem, ['arac modeli', 'arac model yili', 'arac'])
  // Kullanici istegi (2026-09-22, devam): "bu durumu ileride değiştirebiliriz
  // o yüzden bu uygulama otomatik olarak yapmasın, kriterler alanına
  // ekleyelim, kriterlerde VAR ise uygun değil yapsın YOK ise işlem devam
  // etsin" - eskiden kodda SABIT/KOSULSUZ calisan bir kural, artik diger
  // kriterler gibi Ayarlar > Yardım Kriterleri'nde bu dönem icin bir satir
  // ("Yabancı Uyruklu" turunde, HERHANGI bir deger - ör. "Evet"/"1") VAR MI
  // diye kontrol eder. Satir yoksa (donemsiz/"Tüm Dönemler" genel bir satir
  // da yoksa) bu kural HIC calismaz, basvuru normal islem gorur.
  const yabanciUyrukluRaw = findYardimKriteriValue(criteriaList, donem, ['yabanci uyruklu', 'multeci', 'yabanci', 'ykn', '99 ile baslayan'])

  const gelirLimit = gelirRaw !== null ? parseFreeFormAmount(gelirRaw) : null
  const yasAltLimit = yasAltRaw !== null && Number.isFinite(Number(yasAltRaw)) ? Number(yasAltRaw) : null
  const yasUstLimit = yasUstRaw !== null && Number.isFinite(Number(yasUstRaw)) ? Number(yasUstRaw) : null
  const aracYearLimit = aracRaw !== null ? extractVehicleYear(aracRaw) : null
  const yabanciUyrukluRuleActive = yabanciUyrukluRaw !== null

  return { gelirLimit, yasAltLimit, yasUstLimit, aracYearLimit, yabanciUyrukluRuleActive }
}

export async function POST(request: Request) {
  try {
    // Bu uc nokta oturum ACMADAN erisilebilir (bkz. middleware.ts
    // isPublicApiRequest) - vatandaslarin online basvuru formu. Once bu
    // uc nokta HIC rate-limit'siz idi; spam/otomatik toplu basvuru
    // doldurmayi ve gereksiz DB yukunu (her basvuruda benzersizlik
    // kontrolu icin SELECT calisiyor) engellemek icin online-status ve
    // nvi uc noktalarindaki AYNI cift-katmanli desen uygulaniyor: IP bazli
    // sinir tek basina yeterli degil (X-Forwarded-For sahtelenebilir), bu
    // yuzden AYNI TC numarasina karsi da kaynaktan bagimsiz ayri bir sinir var.
    // NOT: ters proxy yokken getRequestClientKey sabit ('no-proxy') doner -
    // bu IP katmani o durumda GLOBAL bir tavan gibi calisir; asil koruma
    // asagidaki TC bazli sinirdir. Bu yuzden limit biraz yuksek tutuluyor.
    const rateLimit = checkRateLimit(`online-application-submit:${getRequestClientKey(request)}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla başvuru denemesi yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }

    const body = await request.json() as OnlineApplicationPayload
    const values = body.values && typeof body.values === 'object' ? body.values : {}
    const tc = cleanText(values.tc).replace(/\D/g, '').slice(0, 11)

    if (tc.length === 11) {
      const tcRateLimit = checkRateLimit(`online-application-submit-tc:${tc}`, {
        limit: 5,
        windowMs: 10 * 60 * 1000,
      })
      if (!tcRateLimit.allowed) {
        return NextResponse.json(
          { success: false, error: 'Çok fazla başvuru denemesi yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
          { status: 429, headers: { 'Retry-After': String(tcRateLimit.retryAfterSeconds) } },
        )
      }
    }
    const fullName = cleanText(values.fullName || values.f_name)
    const birthDate = cleanText(values.birthDate || values.f_birthDate)
    const address = cleanText(values.address || values.f_address)
    const addressNo = cleanText(values.addressNo || values.adresNo || values.adresno || values.f_addressNo || values.f_adresNo)

    const villageName = address ? extractVillageName(address) : null
    if (villageName) {
      return NextResponse.json(
        { success: false, error: `Adresiniz ${villageName} KÖYÜDÜR. Bu yardıma başvuru yapabilmeniz için Sivas merkezde ikamet etmeniz gerekmektedir.` },
        { status: 400 },
      )
    }
    const formId = cleanText(body.formId)
    const assistanceType = cleanText(body.formTitle) || cleanText(body.formId) || 'Online Başvuru'

    const forms = await getOnlineForms()
    const selectedForm = forms.find((form) => form.id === formId)

    // Guvenlik: bu uc nokta oturumsuz/herkese acik oldugu icin "formId"
    // tamamen istemciden (tarayicidan) geliyor - normal akista arayuz her
    // zaman GERCEK/tanimli bir formun id'sini gonderir (bkz.
    // OnlineApplicationClient.tsx), ama biri arayuzu atlayip dogrudan bu
    // uc noktaya rastgele/uydurma bir formId gonderirse, ONCEDEN o formun
    // KENDINE OZGU yas/gelir/arac yili gibi on-eleme kriterleri (asagida)
    // SESSIZCE devre disi kalip basvuru yine de kuyruga giriyordu (genel/
    // sistem capindaki "Otomatik Red" kriterleri ayrica calismaya devam
    // ediyordu, o yuzden gercek bir hak edissiz kisiye otomatik yardim
    // verilmiyordu - ama gereksiz/sahte kayitlar kuyruga girip personelin
    // elle inceleme yukunu artirabiliyordu). Artik taninmayan bir formId
    // ile basvuru tamamen reddediliyor.
    if (!selectedForm) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz başvuru formu. Lütfen sayfayı yenileyip tekrar deneyin.' },
        { status: 400 },
      )
    }

    // Kullanici istegi (2026-09-22): "o tarih ve saat geldiğinde yayına
    // girsin ve zamanı dolunca yayından çıksın" - arayuz (OnlineApplicationClient)
    // zaten "active"i (zamanlama dahil) kontrol edip yayinda olmayan bir
    // formun gonder butonunu gostermez, ama bu SADECE istemci tarafi bir
    // kolaylik - biri arayuzu atlayip suresi dolmus/henuz baslamamis bir
    // formun formId'sine dogrudan POST atarsa, GERCEK/tek guvenlik siniri
    // burasi olmali.
    if (!isFormCurrentlyPublished(selectedForm)) {
      return NextResponse.json(
        { success: false, error: 'Bu başvuru formu şu anda yayında değil.' },
        { status: 403 },
      )
    }

    const criteria = normalizeOnlineApplicationCriteria(selectedForm?.criteria)
    const donemCriteriaLimits = await getDonemCriteriaLimits(assistanceType)
    const visibleFields = selectedForm?.fields.filter((field) => {
      if (!field.showWhen?.fieldId) return true
      const sourceField = selectedForm.fields.find((candidate) => candidate.id === field.showWhen?.fieldId)
      if (!sourceField) return true
      return cleanText(values[fieldKey(sourceField)]) === field.showWhen.value
    }) ?? []

    if (tc.length !== 11) {
      return NextResponse.json(
        { success: false, error: 'TC Kimlik No 11 haneli olmalıdır.' },
        { status: 400 },
      )
    }

    if (!fullName) {
      return NextResponse.json(
        { success: false, error: 'Ad Soyad alanı zorunludur.' },
        { status: 400 },
      )
    }

    // Kullanici istegi (2026-09-22): "18 yaşında küçükler başvuru
    // yapamasın" - bu, form tasarimcisindaki opsiyonel "Yaş alt sınırı"
    // kriterinden (asagida, criteria.minAgeEnabled) FARKLI - o kriter
    // sadece admin ozellikle acarsa calisir; bu ise TUM online basvuru
    // formlari icin KOSULSUZ bir taban kural (18 yasindan kucuk HICBIR
    // form icin basvuru yapamaz, form ne olursa olsun).
    const globalApplicantAge = calculateAge(birthDate)
    if (globalApplicantAge === null || globalApplicantAge < 18) {
      return NextResponse.json(
        { success: false, error: 'Bu yardıma başvuru yapabilmeniz için 18 yaşından büyük olmanız gerekmektedir.' },
        { status: 400 },
      )
    }

    // Kullanici istegi (2026-09-22): "başvuru yapan kişinin mutlaka
    // sivasta ikamet etmesi gerekiyor... adres bilgisine ulaşılamıyor ise"
    // - adres BOŞSA (NVİ'den alinamadiysa) basvuru reddedilir.
    //
    // Kullanici DUZELTMESI (ayni gun, ikinci tur): gercek bir Sivas merkez
    // sakini kendi adina test basvurusu yapinca bu hatayi ALDI ("sivas
    // merkezde oturuyorum ama bu hatayi aldi... bu hata adres bilgisine
    // ulaşılamadığı zaman versin eğer adres bilgisine ulaşılıyorsa bu hata
    // çıkmasın"). Kok neden: asagida ONCEDEN cagirilan
    // geocodeSivasMerkezAddress(address) - ham/serbest adres metnini
    // isSivasMerkezAddressText() ile on-filtreden geciriyordu, bu filtre
    // metnin HEM "sivas" HEM DE harfi harfine "merkez" kelimesini icermesini
    // sartkosuyordu (bkz. geocoding.ts) - ama gercek adresler ("... Mah. ...
    // Sk. No:.. Sivas" gibi) neredeyse HICBIR ZAMAN "merkez" kelimesini
    // LITERAL icermez, bu yuzden GERCEK Sivas merkez sakinleri bile
    // "outside_center" olarak yanlis reddediliyordu. Google API anahtari da
    // tanimli olmadigindan (bkz. lib/services/geocoding.ts) tek alternatif
    // olan Nominatim de site/apartman adli adreslerde guvenilir degil - yani
    // konum bazli otomatik dogrulama bu asamada vatandasi HAKSIZ YERE
    // reddetme riski tasiyor. Bu yuzden konum/geocoding kontrolu TAMAMEN
    // KALDIRILDI - artik SADECE adres bilgisi bos/ulasilamaz ise reddedilir,
    // adres varsa (Sivas disinda gorunse bile) basvuruya IZIN VERILIR.
    if (!address) {
      return NextResponse.json(
        { success: false, error: 'Bu yardıma başvuru yapabilmeniz için Sivas merkezde ikamet etmeniz gerekmektedir.' },
        { status: 400 },
      )
    }

    if (criteria.minAgeEnabled) {
      const age = calculateAge(birthDate)
      if (age === null || age < criteria.minAge) {
        return NextResponse.json(
          { success: false, error: `${criteria.minAge} yasindan kucukler bu forma basvuru yapamaz.` },
          { status: 400 },
        )
      }
    }

    if (criteria.maxAgeEnabled) {
      const age = calculateAge(birthDate)
      if (age === null || age > criteria.maxAge) {
        return NextResponse.json(
          { success: false, error: `${criteria.maxAge} yasindan buyukler bu forma basvuru yapamaz.` },
          { status: 400 },
        )
      }
    }

    if (criteria.maxIncomeEnabled) {
      const income = cleanNumber(getFieldValue(values, visibleFields, 'income'))
      if (income === null || income > criteria.maxIncome) {
        return NextResponse.json(
          { success: false, error: `Aylik hane geliri ${criteria.maxIncome} uzerinde olanlar bu forma basvuru yapamaz.` },
          { status: 400 },
        )
      }
    }

    if (criteria.maxVehicleModelYearEnabled) {
      const vehicleModelYear = cleanNumber(getFieldValue(values, visibleFields, 'vehicleModelYear'))
      if (vehicleModelYear === null || vehicleModelYear > criteria.maxVehicleModelYear) {
        return NextResponse.json(
          { success: false, error: `Arac model yili ${criteria.maxVehicleModelYear} uzerinde olanlar bu forma basvuru yapamaz.` },
          { status: 400 },
        )
      }
    }

    // Kullanici istegi (2026-09-22): "daha önceden yapmış olduğumuz aynı
    // haneden sadece 1 kişi başvuru yapabilsin" - bu kontrol eskiden
    // SADECE admin formda "Adres No Benzersizligi" kriterini ozellikle
    // acarsa calisiyordu (criteria.uniqueAddressNoEnabled); artik TUM
    // formlar icin KOSULSUZ calisir (form-tasarimcisindaki kriter artik
    // bu davranisi DEGISTIRMEZ). addressNo cozumlenemediyse (NVİ'den
    // gelmediyse) bu kontrol sessizce ATLANIR - "adres ulasilamiyor"
    // durumu zaten yukaridaki Sivas-merkez kontrolunde ayrica ele alindi,
    // burada IKINCI bir "adres no yok" reddi ile kullaniciyi
    // karistirmiyoruz.
    if (addressNo) {
      const existingAddressRows = await prisma.$queryRaw<Array<{ id: number; ad: string | null; soyad: string | null }>>`
        SELECT id, ad, soyad
        FROM online_basvurular
        WHERE adresno = ${addressNo}
          AND (answers->>'formId' = ${formId} OR yardim_turu = ${assistanceType})
          AND COALESCE(status, '') NOT IN ('IPTAL', 'İPTAL', 'RED', 'Reddedildi')
        LIMIT 1
      `

      if (existingAddressRows.length > 0) {
        const existingApplicantName = [existingAddressRows[0].ad, existingAddressRows[0].soyad]
          .filter((part) => (part || '').trim())
          .join(' ')
          .trim()
        const nameSuffix = existingApplicantName ? ` Başvuru sahibi: ${existingApplicantName}.` : ''
        return NextResponse.json(
          {
            success: false,
            error: `Aynı haneden daha önceden yapılmış aktif başvurunuz bulunmaktadır. 2. kez başvuru yapamazsınız.${nameSuffix}`,
          },
          { status: 409 },
        )
      }

      // Kullanici istegi (2026-09-29): "yine aynı haneden sadece 1 kişi
      // müracaat edebilsin" - yukaridaki kontrol SADECE online_basvurular
      // icinde arar; bir hane uyesinin basvurusu nakit yardimlari tablosuna
      // (yrd_ayninakti) AKTARILDIGINDA online_basvurular'dan SILINDIGI icin
      // (bkz. transfer-to-cash/route.ts - deleted_online) o hane artik
      // "bos" gibi gorunuyor, ikinci bir uye ayni donem icin rahatca
      // basvurabiliyordu. dosyalar.adresno (NVİ adres no ile ayni deger),
      // o dosyaya bagli GECERLI (iptal edilmemis) bir yrd_ayninakti
      // kaydiyla eslestirilerek bu bosluk kapatilir.
      const existingHouseholdCashRows = await prisma.$queryRaw<Array<{ id: bigint; muracaateden: string | null }>>`
        SELECT y.id, y.muracaateden
        FROM dosyalar d
        JOIN yrd_ayninakti y ON y.dosyaid = d.id
        WHERE d.adresno = ${addressNo}
          AND y.donem = ${assistanceType}
          AND y.durumu IN (0, 6)
        LIMIT 1
      `

      if (existingHouseholdCashRows.length > 0) {
        const nameSuffix = existingHouseholdCashRows[0].muracaateden
          ? ` Başvuru sahibi: ${existingHouseholdCashRows[0].muracaateden}.`
          : ''
        return NextResponse.json(
          {
            success: false,
            error: `Aynı haneden bu dönem için daha önce yapılmış bir nakit yardımı müracaatı bulunmaktadır. 2. kez başvuru yapamazsınız.${nameSuffix}`,
          },
          { status: 409 },
        )
      }
    }

    if (criteria.uniqueIdentityEnabled) {
      const existingIdentityRows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM online_basvurular
        WHERE tckimlikno = ${tc}
          AND (answers->>'formId' = ${formId} OR yardim_turu = ${assistanceType})
          AND COALESCE(status, '') NOT IN ('IPTAL', 'İPTAL', 'RED', 'Reddedildi')
        LIMIT 1
      `

      if (existingIdentityRows.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Bu forma daha önce sizin TC kimlik numaranızla başvuru yapılmış. Aynı kişi bu forma ikinci kez başvuru yapamaz.' },
          { status: 409 },
        )
      }
    }

    // Kullanici istegi (2026-09-29): "başvuru yapan kişinin TC kimlik
    // numarası ve aynı dönem bilgisi ile hem nakit yardımları tablosunda
    // da kişinin kaydı var ise 2. kez müracaat edemesin" - yukaridaki
    // uniqueIdentityEnabled kontrolunun aksine bu kontrol KOSULSUZDUR (form
    // ayarindan bagimsiz, her zaman calisir) ve online_basvurular DEGIL,
    // dogrudan yrd_ayninakti'yi kontrol eder - boylece basvuru nakit
    // yardimlari tablosuna aktarilip online_basvurular'dan silindikten
    // SONRA bile ayni TC + ayni donem icin tekrar basvuru engellenir.
    // durumu=1 (Iptal Edildi) kayitlar HARIC tutulur - iptal edilmis bir
    // basvurudan sonra kisinin tekrar basvurabilmesi beklenen davranistir.
    const existingCashRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM yrd_ayninakti
      WHERE tckimlikno = ${tc}
        AND donem = ${assistanceType}
        AND durumu IN (0, 6)
      LIMIT 1
    `

    if (existingCashRows.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Bu dönem için TC kimlik numaranızla daha önce yapılmış bir nakit yardımı müracaatınız bulunmaktadır. Aynı kişi bu döneme ikinci kez başvuru yapamaz.',
        },
        { status: 409 },
      )
    }

    const invalidIbanField = visibleFields.find((field) => {
      if (fieldKey(field) !== 'iban') return false
      const value = cleanText(values[fieldKey(field)])
      return value !== '' && !isValidTurkishIban(value)
    })

    if (invalidIbanField) {
      return NextResponse.json(
        { success: false, error: `${invalidIbanField.label} alani TR ile baslayan, TR dahil 26 karakter olmalidir.` },
        { status: 400 },
      )
    }

    const invalidVehicleModelYearField = visibleFields.find((field) => {
      if (fieldKey(field) !== 'vehicleModelYear') return false
      const value = cleanText(values[fieldKey(field)])
      return value !== '' && !isValidVehicleModelYear(value)
    })

    if (invalidVehicleModelYearField) {
      return NextResponse.json(
        { success: false, error: `${invalidVehicleModelYearField.label} 4 haneli bir yil olarak girilmelidir. Ornek: 2015` },
        { status: 400 },
      )
    }

    const invalidPhoneField = visibleFields.find((field) => {
      if (fieldKey(field) !== 'phone') return false
      const value = cleanText(values[fieldKey(field)])
      return value !== '' && !isValidPhoneDigits(value)
    })

    if (invalidPhoneField) {
      return NextResponse.json(
        { success: false, error: `${invalidPhoneField.label} 10 veya 11 haneli olmalidir. Ornek: 05XXXXXXXXX` },
        { status: 400 },
      )
    }

    for (const field of visibleFields) {
      if (fieldKey(field) === 'iban') {
        const key = fieldKey(field)
        const value = cleanText(values[key])
        if (value) values[key] = normalizeIban(value)
      }
    }

    const autoRejectReasons: string[] = []
    const applicantAge = calculateAge(birthDate)
    const income = cleanNumber(getFieldValue(values, visibleFields, 'income'))
    const vehicleModelYear = cleanNumber(getFieldValue(values, visibleFields, 'vehicleModelYear'))

    // Kullanici istegi (2026-09-22): dönem'e (assistanceType) ozel
    // kriterler - bkz. getDonemCriteriaLimits yukarisindaki aciklama.
    if (donemCriteriaLimits.yasAltLimit !== null && applicantAge !== null && applicantAge < donemCriteriaLimits.yasAltLimit) {
      autoRejectReasons.push(`Yas ${donemCriteriaLimits.yasAltLimit} altinda.`)
    }

    if (donemCriteriaLimits.gelirLimit !== null && income !== null && income > donemCriteriaLimits.gelirLimit) {
      autoRejectReasons.push(`Aylik hane geliri ${donemCriteriaLimits.gelirLimit} uzerinde.`)
    }

    if (donemCriteriaLimits.aracYearLimit !== null && vehicleModelYear !== null && vehicleModelYear > donemCriteriaLimits.aracYearLimit) {
      autoRejectReasons.push(`Arac model yili ${donemCriteriaLimits.aracYearLimit} uzerinde.`)
    }

    if (donemCriteriaLimits.yasUstLimit !== null && applicantAge !== null && applicantAge > donemCriteriaLimits.yasUstLimit) {
      autoRejectReasons.push(`Yas ${donemCriteriaLimits.yasUstLimit} uzerinde.`)
    }

    // Kullanici istegi (2026-09-22, devam): yabanci uyruklu (Yabancı
    // Kimlik No / YKN) sahiplerinin TC alaninin İLK İKİ HANESİ HER ZAMAN
    // "99"dır (T.C. vatandaslarina verilen TC Kimlik No'larin ilk hanesi
    // hicbir zaman 0 veya 9 olamaz). Basvuru REDDEDILMEZ (vatandas formu
    // doldurup gonderebilir), sadece bu dönem icin Ayarlar > Yardım
    // Kriterleri'nde "Yabancı Uyruklu" satiri TANIMLIYSA otomatik "UYGUN
    // DEĞİL" durumuna dusurulur (bkz. getDonemCriteriaLimits) - tanimli
    // degilse bu kural hic calismaz.
    if (donemCriteriaLimits.yabanciUyrukluRuleActive && tc.startsWith('99')) {
      autoRejectReasons.push('Yabanci uyruklu basvuru sahibi (TC/YKN 99 ile basliyor) - bu donem icin kriterlerde tanimli.')
    }

    // Kullanici istegi (2026-09-22): "kriter uygulanan başvuruların aşama
    // değerine UYGUN DEĞİL yerine Otomatik Red yazsın böylece hangi
    // yardımlar otomatik red oldu onu görelim" - "Otomatik Red", Nakit
    // Yardımı muracaatlarinin OTOMATIK RED sisteminde de kullanilan AYNI
    // sabit (bkz. lib/services/cashAutoReject.service.ts -
    // OTOMATIK_RED_STAGE) - boylece personel bu ASAMA degerini gorunce
    // "bunu SISTEM mi elediyi yoksa bir personel mi elle 'Uygun Değil'
    // yaptı" ayrimini net olarak yapabilir. "durum" (status) alani ise
    // AYNEN "UYGUN DEGIL" kalir - raporlama/filtreleme mantigi (ör.
    // ManagedReportTablePage'in "durum" bazli filtreleri) buna gore
    // KURULMUS, degistirilmedi.
    const isAutoRejected = autoRejectReasons.length > 0
    const applicationStatus = isAutoRejected ? 'UYGUN DEGIL' : 'YENI'
    // Kullanici istegi (2026-09-22): "otomatik elenmeyen başvuruların aşama
    // bilgisinede İNCELENECEK yazsın" - INCELENECEK_STAGE de OTOMATIK_RED_STAGE
    // gibi cashAutoReject.service.ts'deki AYNI sabit (Hazir Degerler > NAKIT
    // ASAMA listesindeki "İncelenecek" secenegiyle BIREBIR ayni yazilmali).
    const applicationStage = isAutoRejected ? OTOMATIK_RED_STAGE : INCELENECEK_STAGE
    const applicationNote = isAutoRejected ? `Otomatik kriter elemesi: ${autoRejectReasons.join(' ')}` : null

    const { ad, soyad } = splitFullName(fullName)
    const answersJson = JSON.stringify({
      ...values,
      tc,
      fullName,
      birthDate,
      address,
      addressNo,
      formId,
      formTitle: assistanceType,
      autoEvaluation: {
        rejected: isAutoRejected,
        reasons: autoRejectReasons,
      },
    })

    // Kullanici istegi (2026-09-22, devam): "dönem bilgisine de aktif
    // olan yardımın form başlığındaki bilgiyi yazsın" - "donem" sutunu
    // (asagida) yardim_turu ile AYNI degeri (assistanceType/form basligi,
    // ör. "2026-2027 ÜNİVERSİTE YARDIMI") alir - kayit olusur olusmaz
    // "Seçin" bos birakilmis gorunmesin diye. Personel isterse (Kayıt
    // İşlemleri > Donem, etiket, asama ve miktar bilgilerini guncelle)
    // sonradan farkli bir degere degistirebilir.
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO online_basvurular (
        tckimlikno,
        ad,
        soyad,
        dogumtarihi,
        yardim_turu,
        adres,
        adresno,
        answers,
        status,
        asama,
        aciklama,
        basvuru_yili,
        etiket,
        donem
      )
      VALUES (
        ${tc},
        ${ad},
        ${soyad},
        ${birthDate || null},
        ${assistanceType},
        ${address || null},
        ${addressNo || null},
        ${answersJson}::jsonb,
        ${applicationStatus},
        ${applicationStage},
        ${applicationNote},
        ${new Date().getFullYear()},
        ${ONLINE_APPLICATION_DEFAULT_ETIKET},
        ${assistanceType}
      )
      RETURNING id
    `

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
  } catch (error) {
    // Guvenlik: bu uc nokta oturumsuz/herkese acik oldugu icin (bkz.
    // middleware.ts isPublicApiRequest) ham/teknik hata mesaji (ör.
    // veritabani hata detayi, sutun/tablo adlari) istemciye DONMEZ -
    // sadece sunucu loguna yazilir, disariya genel bir mesaj verilir
    // (login/route.ts ve online-applications/status/route.ts ile AYNI ilke).
    console.error('Online basvuru kaydi hatasi:', error)
    return NextResponse.json(
      { success: false, error: 'Başvuru kaydedilemedi. Lütfen tekrar deneyin.' },
      { status: 400 },
    )
  }
}
