'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  normalizeOnlineApplicationCriteria,
  normalizeOnlineApplicationIntro,
  type OnlineApplication,
  type OnlineFormField,
} from '@/lib/constants/onlineApplicationForms'
import { BirthDateTextInput } from './BirthDateTextInput'

type OnlineGeneralSettings = {
  institutionName?: string
  departmentName?: string
  address?: string
  phone1?: string
  phone2?: string
  email?: string
  website?: string
  logoDataUrl?: string
  onlineApplicationInfoText?: string
  onlineApplicationSuccessMessage?: string
  workingHours?: string
}

const defaultGeneralSettings: Required<OnlineGeneralSettings> = {
  institutionName: 'Sivas Belediyesi',
  departmentName: 'Sosyal Hizmetler Müdürlüğü',
  address: 'Sivas Belediyesi Sosyal Hizmetler Müdürlüğü',
  phone1: '',
  phone2: '',
  email: '',
  website: '',
  logoDataUrl: '/sivas-belediyesi-logo.png',
  onlineApplicationInfoText: 'Başvurunuzun değerlendirilebilmesi için bilgilerinizi eksiksiz doldurun.',
  onlineApplicationSuccessMessage: 'Başvurunuz alınmıştır. Kurum personeli tarafından incelenecektir.',
  workingHours: 'Hafta içi 08:00 - 17:00',
}

const formatExternalUrl = (value?: string) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function normalizeLabel(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Kullanici istegi (2026-09-21): "araç bilgisine evet dediğimizde model
// bilgisinin girileceği alan hemen altında oluşsun onun altında gelir
// bilgisi gelsin onun altındada iban bilgisi gelsin yani istenen tüm
// bilgiler kişisel bilgiler alanında alt alta listelensin" - eski 2 renkli
// grup ayrimi (14 Eylul 2026, 2. tur) KALDIRILDI, tum alanlar artik TEK
// "Kişisel Bilgiler" kutusunda alt alta listeleniyor. Araç bilgisi/Araç
// Modeli/Gelir/IBAN gibi alanlar admin panelinde HANGI SIRADA girilmis
// olursa olsun (bkz. asagidaki reorderSpecialFields) her zaman bu sirada
// (Araç bilgisi -> Araç Modeli -> Gelir -> IBAN) gosterilir.
//
// ONEMLI: bu siralama SADECE gorsel/kozmetik amacli - deger anahtari
// olarak fieldKey()'i DEGIL, kendi ayri (daha genis eslesen) etiket
// kontrolunu kullanir. fieldKey() sunucu tarafinda da (app/api/
// online-applications/route.ts, apply-criteria/route.ts) AYNEN kopyalanmis
// ve basvuru gonderiminde/otomatik-red kriterlerinde degerlerin hangi
// anahtar altinda okunacagini belirliyor - burada genisletirsek o
// dosyalarla senkron bozulur (mevcut basvurularin answers JSON'undaki
// anahtarlarla da uyumsuz olur). Bu yuzden fieldKey tamamen DOKUNULMADAN
// birakildi, siralama icin ayri/izole bir siniflandirici kullanildi.
function getDisplayPriority(field: OnlineFormField): number | null {
  const label = normalizeLabel(field.label)
  if (label.includes('araç model') || label.includes('arac model')) return 1
  if (label.includes('araç') || label.includes('araÃ§') || label.includes('arac')) return 0
  if (label.includes('gelir')) return 2
  if (label.includes('iban')) return 3
  return null
}

function reorderSpecialFields(fields: OnlineFormField[]) {
  const specialIndices: number[] = []
  fields.forEach((field, index) => {
    if (getDisplayPriority(field) !== null) specialIndices.push(index)
  })
  if (specialIndices.length < 2) return fields

  const specialFields = specialIndices
    .map((index) => fields[index])
    .sort((a, b) => (getDisplayPriority(a) ?? 0) - (getDisplayPriority(b) ?? 0))

  const result = [...fields]
  specialIndices.forEach((index, position) => {
    result[index] = specialFields[position]
  })
  return result
}

function fieldKey(field: OnlineFormField) {
  const label = normalizeLabel(field.label)
  if (label.includes('tc') || label.includes('kimlik')) return 'tc'
  if (label.includes('doğum')) return 'birthDate'
  if (label.includes('ad soyad') || label.includes('adı soyadı')) return 'fullName'
  if (label.includes('adres no') || label.includes('adresno')) return 'addressNo'
  if (label.includes('adres')) return 'address'
  if (label.includes('telefon') || label.includes('cep')) return 'phone'
  if (label.includes('gelir')) return 'income'
  // Kullanici istegi (2026-09-22): "başvuru alırken bazı alanları
  // doldurmuyor" - kok neden: bu kontrol "durum" KELIMESININ de gecmesini
  // sart kosuyordu, ama admin bu alani "Araç Bilgisi" (sadece "araç",
  // "durum" kelimesi YOK) olarak adlandirmisti - deger yanlis anahtarda
  // (f_...) saklaniyor, "vehicleStatus" bekleyen raporlar/duzenleme
  // penceresi bos goruyordu. Artik "model" GECMEYEN her "araç/arac" iceren
  // etiket vehicleStatus sayilir; "model" gecen ("Araç Modeli" gibi) ONCE
  // kontrol edilip vehicleModelYear'a ayriliyor. Sunucudaki (route.ts)
  // AYNI fonksiyonla senkron tutulmali.
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

// Kullanici istegi (2026-09-22): "iban bilgisini girdiğinde iban alanının
// altında o ibanın hangi bankaya ait olduğuna dair banka ismini yazabilir
// miyiz" - Turk IBAN yapisinda TR + 2 kontrol hanesinden sonra gelen 5
// haneli alan banka kodudur (ilk hanesi hep '0', banka TCMB'nin resmi
// listesinde kalan 4 haneyle anilir - ör. 0010 Ziraat, 0064 Is Bankasi).
// Bu, IBAN'in KENDI icinde kodlanmis, herkese acik/statik bir bilgi -
// disari hicbir istek atilmadan, tamamen yerel olarak cozumlenebilir (risk
// yok). Liste, TCMB'nin resmi "Odeme Sistemleri Katilimcilari" belgesinden
// (tcmb.gov.tr, 2026 guncel surumu) alinmistir.
const TURKISH_BANK_CODES: Record<string, string> = {
  '0001': 'T.C. Merkez Bankası',
  '0004': 'İller Bankası A.Ş.',
  '0010': 'T.C. Ziraat Bankası A.Ş.',
  '0012': 'Türkiye Halk Bankası A.Ş.',
  '0014': 'Türkiye Sınai Kalkınma Bankası A.Ş.',
  '0015': 'Türkiye Vakıflar Bankası T.A.O.',
  '0016': 'Türkiye İhracat Kredi Bankası (Türk Eximbank)',
  '0017': 'Türkiye Kalkınma Bankası A.Ş.',
  '0029': 'Birleşik Fon Bankası A.Ş.',
  '0032': 'Türkiye Ekonomi Bankası A.Ş.',
  '0046': 'Akbank T.A.Ş.',
  '0059': 'Şekerbank T.A.Ş.',
  '0060': 'Türk Ticaret Bankası A.Ş.',
  '0062': 'Türkiye Garanti Bankası A.Ş.',
  '0064': 'Türkiye İş Bankası A.Ş.',
  '0067': 'Yapı ve Kredi Bankası A.Ş.',
  '0091': 'Arap Türk Bankası A.Ş.',
  '0092': 'Citibank A.Ş.',
  '0096': 'Freedom Bank A.Ş.',
  '0098': 'JPMorgan Chase Bank N.A.',
  '0099': 'ING Bank A.Ş.',
  '0103': 'Fibabanka A.Ş.',
  '0108': 'Turkland Bank A.Ş.',
  '0109': 'ICBC Turkey Bank A.Ş.',
  '0111': 'QNB Finansbank A.Ş.',
  '0115': 'Deutsche Bank A.Ş.',
  '0116': 'Pasha Yatırım Bank A.Ş.',
  '0121': 'Standard Chartered Yatırım Bankası Türk A.Ş.',
  '0122': 'Societe Generale (SA)',
  '0123': 'HSBC Bank A.Ş.',
  '0124': 'Alternatifbank A.Ş.',
  '0125': 'Burgan Bank A.Ş.',
  '0129': 'Bank of America Yatırım Bank A.Ş.',
  '0132': 'İstanbul Takas ve Saklama Bankası A.Ş.',
  '0134': 'Denizbank A.Ş.',
  '0135': 'Anadolubank A.Ş.',
  '0137': 'Hepsi Bank A.Ş.',
  '0138': 'Diler Yatırım Bankası A.Ş.',
  '0139': 'GSD Yatırım Bankası A.Ş.',
  '0141': 'Nurol Yatırım Bankası A.Ş.',
  '0142': 'Bankpozitif Kredi ve Kalkınma Bankası A.Ş.',
  '0143': 'Aktif Yatırım Bankası A.Ş.',
  '0146': 'Odea Bank A.Ş.',
  '0147': 'MUFG Bank Turkey A.Ş.',
  '0148': 'Intesa Sanpaolo S.p.A.',
  '0149': 'Bank of China Turkey A.Ş.',
  '0151': 'D Yatırım Bankası A.Ş.',
  '0152': 'Destek Yatırım Bankası A.Ş.',
  '0153': 'Misyon Yatırım Bankası A.Ş.',
  '0154': 'Tera Yatırım Bankası A.Ş.',
  '0155': 'Q Yatırım Bankası A.Ş.',
  '0156': 'Hedef Yatırım Bankası A.Ş.',
  '0157': 'Enpara Bank A.Ş.',
  '0158': 'Colendi Bank A.Ş.',
  '0159': 'Fups Bank A.Ş.',
  '0160': 'Ziraat Dinamik Banka A.Ş.',
  '0161': 'Aytemiz Yatırım Bankası A.Ş.',
  '0203': 'Albaraka Türk Katılım Bankası A.Ş.',
  '0205': 'Kuveyt Türk Katılım Bankası A.Ş.',
  '0206': 'Türkiye Finans Katılım Bankası A.Ş.',
  '0209': 'Ziraat Katılım Bankası A.Ş.',
  '0210': 'Vakıf Katılım Bankası A.Ş.',
  '0211': 'Türkiye Emlak Katılım Bankası A.Ş.',
  '0212': 'Hayat Finans Katılım Bankası A.Ş.',
  '0213': 'T.O.M. Katılım Bankası A.Ş.',
  '0214': 'Dünya Katılım Bankası A.Ş.',
  '0215': 'Adil Katılım Bankası A.Ş.',
  '0216': 'İktisat Katılım Bankası A.Ş.',
  '0806': 'Merkezi Kayıt Kuruluşu A.Ş.',
  '0807': 'PTT A.Ş.',
}

function getIbanBankName(digitsAfterTR: string) {
  if (digitsAfterTR.length < 7) return null
  const bankCode = digitsAfterTR.slice(3, 7)
  return TURKISH_BANK_CODES[bankCode] || null
}

function formatIbanDigits(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 24)
  const groups = [2, 4, 4, 4, 4, 4, 2]
  const parts: string[] = []
  let offset = 0

  for (const size of groups) {
    const part = digits.slice(offset, offset + size)
    if (!part) break
    parts.push(part)
    offset += size
  }

  return parts.join(' ')
}

// Kullanici istegi (2026-09-22): "araç modeli girildiğinde mutlaka 4 hane
// olmalı ... 2001,1995,2015 şeklinde girilmeli" - model yili her zaman 4
// haneli bir yil olmali; ayrica makul bir araligin (1950 - gelecek yil)
// disinda bir deger de (ör. "9999", "0001") yanlis girilmis sayilir.
function isValidVehicleModelYear(value: string) {
  if (!/^\d{4}$/.test(value)) return false
  const year = Number(value)
  const currentYear = new Date().getFullYear()
  return year >= 1950 && year <= currentYear + 1
}

// Kullanici istegi: "telefon no girilirken özel karekter yada boşluk
// bırakılmasın" - yazarken anlik olarak rakam DISINDAKI her sey (bosluk,
// tire, parantez vb.) elenir; Turkiye'de sabit/cep numaralari en fazla 11
// hane (basinda 0 ile) oldugundan uzunluk da orada sinirlanir.
function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 11)
}

function isValidPhoneDigits(value: string) {
  return value.length === 10 || value.length === 11
}

// Kullanici istegi (2026-09-28): "adres bilgisinde köyü ibaresi var ise
// ... sivas merkezde ikamet etmeniz gerekmektedir" - sunucudaki (route.ts)
// AYNI fonksiyonla senkron tutulmali.
function extractVillageName(address: string): string | null {
  const upper = address.toLocaleUpperCase('tr-TR')
  // Kullanici istegi (2026-09-28): "\b" (kelime siniri) burada BILEREK
  // KULLANILMIYOR - JS regex'te \b sadece ASCII \w karakterlerini taniyor,
  // "Ü" bunun disinda kaldigi icin "KÖYÜ" metninden hemen sonraki \b HER
  // ZAMAN yanlis pozisyonda eslesiyordu ve gercek "... KÖYÜ ..." adresleri
  // bile YAKALANMIYORDU (dogrulandi). Bunun yerine bosluk/metin sonu
  // ileriye-bakan kontrolu kullaniliyor.
  const match = upper.match(/([^\s,]+)\s+KÖYÜ(?=\s|$)/)
  return match ? match[1] : null
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

function OnlineInput({
  field,
  value,
  onChange,
  locked,
}: {
  field: OnlineFormField
  value: string
  onChange: (value: string) => void
  locked?: boolean
}) {
  // Kullanici istegi (2026-09-22): "veri alanlarını ve yazı puntolarını
  // mobil tarafında biraz daha küçültelim" - mobilde (sm: alti) alanlar
  // daha kompakt (py-2, 12px), sm: ve uzeri ONCEKI (py-2.5, 14px) boyutta
  // KALIYOR - masaustu HICBIR SEKILDE etkilenmiyor.
  const baseClass = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-900 outline-none transition focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100 sm:px-3 sm:py-2.5 sm:text-sm'
  const isIbanField = fieldKey(field) === 'iban'
  const ibanDigits = isIbanField ? normalizeIban(value).slice(2) : ''
  const formattedIbanDigits = isIbanField ? formatIbanDigits(ibanDigits) : ''
  // Kullanici istegi (2026-09-22): "ibandan bir rakam sildiğimde o banka
  // ismi hala orada kalıyor... iban eksik yada yanlış ise o banka bilgisi
  // gitsin" - banka adi artik SADECE iban TAM (24 hane) VE saglama
  // kontrolunu (MOD-97) GECERSE gosterilir; eksik/hatali girişte hemen
  // kaybolur.
  const ibanValid = isIbanField && isValidTurkishIban(value)
  const ibanBankName = ibanValid ? getIbanBankName(ibanDigits) : null
  // Kullanici istegi (ayni gun, devam): "iban hatalı ise ... kırmızı renkte
  // ve büyük harfle... uyarısı çıksın düzelince yeşil ve büyük harfle banka
  // ismi çıksın" - uyari SADECE kullanici 24 haneyi TAMAMEN girdiginde ve
  // saglama basarisiz olduğunda gosterilir (hala yaziyorken/eksikken
  // erken/rahatsiz edici bir uyari cikmasin diye).
  const ibanInvalid = isIbanField && ibanDigits.length === 24 && !ibanValid

  if (field.type === 'textarea') {
    return <textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} className={baseClass} />
  }

  if (field.type === 'select') {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} className={baseClass}>
        <option value="">Seçiniz</option>
        {(field.options ?? []).filter(Boolean).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    )
  }

  if (field.type === 'file') {
    return (
      <input
        type="file"
        className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-[#0076b6] file:px-3 file:py-1.5 file:text-xs file:font-black file:text-white"
      />
    )
  }

  // Kullanici istegi (2026-09-22): "mobil tarafında adres alanını biraz
  // aşağı doğru genişletelim burada adres uzun olduğunda tamamı ekranda
  // görünmüyor" - adres tek satirlik bir input'ta yazildiginda uzun
  // adresler kirpiliyordu (yatay kaydirma gerekiyordu). Artik metni
  // asagi dogru saran (wrap eden), coklu satirli bir textarea.
  if (fieldKey(field) === 'address') {
    // Kullanici istegi (2026-09-28): "adres bilgisi manuel olarak
    // girilemesin aynı isim ve soyisim bilgisi gibi kilitli olsun" - adres
    // ARTIK HER ZAMAN salt-okunur (locked prop'undan BAGIMSIZ olarak) -
    // eskiden sadece NVİ basarili VE deger dolu ise kilitleniyordu, bu da
    // NVİ adres BOS donduğunde (tam da "adrese ulasilamadi" senaryosunda)
    // alanin acik/yazilabilir kalmasina, vatandasin kendi uydurdugu bir
    // "Sivas merkez" adresi yazmasina izin veriyordu.
    return (
      <div>
        <textarea
          rows={3}
          value={value}
          onChange={() => {}}
          readOnly
          placeholder="T.C. Kimlik No ve Doğum Tarihi girildiğinde nüfustan otomatik doldurulur."
          className={`${baseClass} resize-y cursor-not-allowed bg-slate-100 text-slate-600`}
        />
        {value.trim() !== '' && <LockedFieldNote />}
      </div>
    )
  }

  if (isIbanField) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-black text-red-600 sm:text-base">
          İBAN MUTLAKA BAŞVURU YAPAN KİŞİYE AİT OLMALIDIR
        </p>
        <div className="flex w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-[10px] font-semibold text-slate-900 transition focus-within:border-[#0076b6] focus-within:ring-2 focus-within:ring-sky-100 sm:text-sm">
          <span className="flex items-center border-r border-slate-200 bg-slate-50 px-2 font-black text-slate-600 sm:px-3">TR</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={formattedIbanDigits}
            onChange={(event) => onChange(normalizeIban(event.target.value))}
            maxLength={30}
            placeholder="24 haneli IBAN numarası"
            className="min-w-0 flex-1 bg-white px-2 py-1 outline-none sm:px-3 sm:py-2.5"
          />
        </div>
        {ibanBankName && (
          <p className="mt-1.5 text-sm font-black text-emerald-600">
            {`BANKA: ${ibanBankName}`.toLocaleUpperCase('tr-TR')}
          </p>
        )}
        {ibanInvalid && (
          <p className="mt-1.5 text-sm font-black text-red-600">İBAN BİLGİSİ HATALIDIR</p>
        )}
      </div>
    )
  }

  if (fieldKey(field) === 'vehicleModelYear') {
    const modelYearInvalid = value.trim() !== '' && !isValidVehicleModelYear(value)
    return (
      <div>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
          maxLength={4}
          placeholder="Örn: 2015"
          className={baseClass}
        />
        {modelYearInvalid && (
          <p className="mt-1.5 text-sm font-black text-red-600">
            ARAÇ MODELİ 4 HANELİ BİR YIL OLMALIDIR (ÖRN: 2015)
          </p>
        )}
      </div>
    )
  }

  // Kullanici istegi: "gelir durumunuda yazarken özel karekter nokta
  // virgül gibi girilmesin ... vatandaş gelirini yanlışlıkla girdiğinde
  // (ör. 30000 yerine 300000 ya da 30 yazmış ise) bunu ... göster" - nokta/
  // virgul/bosluk gibi karakterler yazarken zaten ENGELLENIYOR (sadece
  // rakam kabul edilir), ayrica kaydedilecek TUTAR HER ZAMAN (biçimlendirilmiş
  // halde) alanin hemen altinda koyu/kirmizi yazi ile gosterilir - boylece
  // vatandaş fazladan/eksik sıfır gibi bir yazim hatasini gonderme
  // yapmadan ONCE gozle fark edebilir.
  if (fieldKey(field) === 'income') {
    const incomeDigits = value.replace(/\D/g, '')
    const formattedIncome = incomeDigits ? Number(incomeDigits).toLocaleString('tr-TR') : ''
    return (
      <div>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 9))}
          placeholder="Örn: 30000"
          className={baseClass}
        />
        {formattedIncome && (
          <p className="mt-1.5 text-sm font-black text-red-600">
            AYLIK GELİR OLARAK {formattedIncome} TL KAYDEDİLECEKTİR.
          </p>
        )}
      </div>
    )
  }

  if (fieldKey(field) === 'phone') {
    const phoneInvalid = value.trim() !== '' && !isValidPhoneDigits(value)
    return (
      <div>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => onChange(normalizePhoneDigits(event.target.value))}
          placeholder="Örn: 05XXXXXXXXX"
          className={baseClass}
        />
        {phoneInvalid && (
          <p className="mt-1.5 text-sm font-black text-red-600">
            TELEFON NUMARASI 10 VEYA 11 HANELİ OLMALIDIR (ÖRN: 05XXXXXXXXX)
          </p>
        )}
      </div>
    )
  }

  if (fieldKey(field) === 'fullName' && locked) {
    return (
      <div>
        <input
          type="text"
          value={value}
          readOnly
          className={`${baseClass} cursor-not-allowed bg-slate-100 text-slate-600`}
        />
        <LockedFieldNote />
      </div>
    )
  }

  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={baseClass}
    />
  )
}

function LockedFieldNote() {
  return (
    <p className="mt-1.5 text-[10px] font-bold text-slate-500 sm:text-xs">
      Nüfus kayıtlarından otomatik alındı, değiştirilemez.
    </p>
  )
}

export function OnlineApplicationClient({
  selectedForm,
  activeForms,
  generalSettings,
}: {
  selectedForm: OnlineApplication | undefined
  activeForms: OnlineApplication[]
  generalSettings?: OnlineGeneralSettings
}) {
  const settings = { ...defaultGeneralSettings, ...generalSettings }
  const contactItems = [
    { label: 'Adres', value: settings.address },
    { label: 'Telefon', value: [settings.phone1, settings.phone2].filter(Boolean).join(' / ') },
    { label: 'E-posta', value: settings.email },
    { label: 'Web', value: settings.website, href: formatExternalUrl(settings.website) },
  ].filter(item => item.value)
  const [values, setValues] = useState<Record<string, string>>({})
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [lookupMessage, setLookupMessage] = useState('')
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [submitMessage, setSubmitMessage] = useState('')
  const [submitDialog, setSubmitDialog] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // Kullanici istegi (2026-09-28): "tc kimlik no ve doğum tarihini
  // girdiğinde nufustan adres bilgisi alınamıyor ise ... sivas merkezde
  // kayıtlı adres bilgisine ulaşılamadı diyerek ... başvuru yapmasına izin
  // vermeyelim. ... adres bilgisinde köyü ibaresi var ise ... sivas
  // merkezde ikamet etmeniz gerekmektedir diyerek başvuru yapmasına izin
  // vermeyelim" - TUM online formlar icin GENEL bir kural (kullanicinin
  // secimi). "residencyIssue" set oldugu surece (modal kapatilsa bile)
  // Basvuruyu Gonder butonu devre disi kalir - bkz. asagidaki render ve
  // submitApplication icindeki tekrar kontrol.
  const [residencyIssue, setResidencyIssue] = useState<{ type: 'no-address' } | { type: 'village'; villageName: string } | null>(null)
  const [residencyDialogOpen, setResidencyDialogOpen] = useState(false)
  const [isIntroAccepted, setIsIntroAccepted] = useState(false)
  const [isIntroConsentChecked, setIsIntroConsentChecked] = useState(false)
  const [idleWarningVisible, setIdleWarningVisible] = useState(false)
  const lastLookupKeyRef = useRef('')
  const selectedCriteria = normalizeOnlineApplicationCriteria(selectedForm?.criteria)
  const selectedIntro = normalizeOnlineApplicationIntro(selectedForm?.intro)
  const introStorageKey = selectedForm?.id ? `online-intro-accepted:${selectedForm.id}` : ''
  const introTitle = selectedIntro.title || selectedForm?.title || 'Online Başvuru'
  const introDescription = selectedIntro.description || 'Başvuruya devam etmeden önce aşağıdaki kriterleri okuyup onaylamanız gerekir.'
  const introImageUrl = selectedIntro.imageUrl || settings.logoDataUrl
  const criteriaItems = useMemo(() => {
    const items: string[] = []
    if (selectedCriteria.minAgeEnabled) {
      items.push(`${selectedCriteria.minAge} yaşından küçükler bu başvuru formunu kullanamaz.`)
    }
    if (selectedCriteria.maxAgeEnabled) {
      items.push(`${selectedCriteria.maxAge} yasindan buyukler bu basvuru formunu kullanamaz.`)
    }
    if (selectedCriteria.maxIncomeEnabled) {
      items.push(`Aylik hane geliri ${selectedCriteria.maxIncome} uzerinde olanlar bu basvuru formunu kullanamaz.`)
    }
    if (selectedCriteria.maxVehicleModelYearEnabled) {
      items.push(`Arac model yili ${selectedCriteria.maxVehicleModelYear} uzerinde olanlar bu basvuru formunu kullanamaz.`)
    }
    // Kullanici istegi (2026-09-22): "İŞARETLİ ALANDAKİ AÇIKLAMALAR DAHA
    // ANLAŞILIR OLSUN ÖRNEĞİN 1. AYNI HANEDEN SADECE BİR KİŞİ BAŞVURU
    // YAPABİLİR, 2. AYNI KİŞİ 2. KEZ BAŞVURU YAPAMAZ GİBİ" - eski metinler
    // ("Aynı adres no ile...", "Aynı TC kimlik no ile...") teknik/dolayli
    // ifadelerdi, vatandas icin daha dogrudan/gunluk dile cevrildi.
    if (selectedCriteria.uniqueAddressNoEnabled) {
      items.push('Aynı haneden (aynı adresten) sadece bir kişi bu forma başvuru yapabilir.')
    }
    if (selectedCriteria.uniqueIdentityEnabled) {
      items.push('Aynı kişi bu forma ikinci kez başvuru yapamaz.')
    }
    selectedCriteria.manualInfoCriteria.forEach((criterion) => {
      const text = criterion.trim()
      if (text) items.push(text)
    })
    return items
  }, [
    selectedCriteria.minAgeEnabled,
    selectedCriteria.minAge,
    selectedCriteria.maxAgeEnabled,
    selectedCriteria.maxAge,
    selectedCriteria.maxIncomeEnabled,
    selectedCriteria.maxIncome,
    selectedCriteria.maxVehicleModelYearEnabled,
    selectedCriteria.maxVehicleModelYear,
    selectedCriteria.uniqueAddressNoEnabled,
    selectedCriteria.uniqueIdentityEnabled,
    selectedCriteria.manualInfoCriteria,
  ])

  const tcField = selectedForm?.fields.find((field) => fieldKey(field) === 'tc')
  const visibleFields = useMemo(() => {
    const filtered = selectedForm?.fields.filter((field) => {
      if (fieldKey(field) === 'tc' || fieldKey(field) === 'birthDate') return false
      if (!field.showWhen?.fieldId) return true
      const sourceField = selectedForm.fields.find((candidate) => candidate.id === field.showWhen?.fieldId)
      if (!sourceField) return true
      return (values[fieldKey(sourceField)] || '') === field.showWhen.value
    }) ?? []
    return reorderSpecialFields(filtered)
  }, [selectedForm, values])

  const setValue = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  // Kullanici istegi (2026-09-22): "bir kez hata verdiğinde hata
  // düzeltilse bile başvuru gönder dediğimizde işlem yapmıyor" - kok neden,
  // submitDialog'un bir useEffect ile submitStatus/submitMessage'dan turetilmesiydi;
  // bir sonraki deneme AYNI status+mesaj ciftini uretince React'in bagimlilik
  // karsilastirmasi degisiklik gormuyor, efekt yeniden tetiklenmiyor, pencere
  // tekrar acilmiyordu. Cozum: durumu AYNI ANDA hem state'e yaz hem de
  // dogrudan/emperatif olarak diyalogu ac - boylece her deneme, bir onceki
  // denemeyle ayni mesaji uretse bile guvenilir sekilde gosterilir.
  const showResult = (type: 'success' | 'error', message: string) => {
    setSubmitStatus(type)
    setSubmitMessage(message)
    setSubmitDialog({ type, message })
  }

  const submitApplication = async () => {
    if (!selectedForm) return

    const tc = (values.tc || '').replace(/\D/g, '')
    if (tc.length !== 11) {
      showResult('error', 'TC Kimlik No 11 haneli olmalıdır.')
      return
    }

    if (!values.birthDate) {
      showResult('error', 'Doğum tarihi zorunludur.')
      return
    }

    if (residencyIssue) {
      setResidencyDialogOpen(true)
      showResult(
        'error',
        residencyIssue.type === 'village'
          ? `Adresiniz ${residencyIssue.villageName} KÖYÜDÜR. Bu yardıma başvuru yapabilmeniz için Sivas merkezde ikamet etmeniz gerekmektedir.`
          : 'Sivas merkezde kayıtlı adres bilgisine ulaşılamadı.',
      )
      return
    }

    if (selectedCriteria.minAgeEnabled) {
      const age = calculateAge(values.birthDate)
      if (age === null || age < selectedCriteria.minAge) {
        showResult('error', `${selectedCriteria.minAge} yasindan kucukler bu forma basvuru yapamaz.`)
        return
      }
    }

    if (selectedCriteria.uniqueAddressNoEnabled && !(values.addressNo || '').trim()) {
      showResult('error', 'Adres no bilgisi dogrulanamadigi icin basvuru alinamaz.')
      return
    }

    const missingField = visibleFields.find((field) => {
      if (!field.required || field.type === 'file') return false
      return !(values[fieldKey(field)] || '').trim()
    })

    if (missingField) {
      showResult('error', `${missingField.label} alanı zorunludur.`)
      return
    }

    const invalidIbanField = visibleFields.find((field) => {
      if (fieldKey(field) !== 'iban') return false
      const value = values[fieldKey(field)] || ''
      return value.trim() !== '' && !isValidTurkishIban(value)
    })

    if (invalidIbanField) {
      showResult('error', `${invalidIbanField.label} alani TR ile baslayan, TR dahil 26 karakter olmalidir.`)
      return
    }

    const invalidVehicleModelYearField = visibleFields.find((field) => {
      if (fieldKey(field) !== 'vehicleModelYear') return false
      const value = values[fieldKey(field)] || ''
      return value.trim() !== '' && !isValidVehicleModelYear(value)
    })

    if (invalidVehicleModelYearField) {
      showResult('error', `${invalidVehicleModelYearField.label} 4 haneli bir yil olarak girilmelidir. Ornek: 2015`)
      return
    }

    const invalidPhoneField = visibleFields.find((field) => {
      if (fieldKey(field) !== 'phone') return false
      const value = values[fieldKey(field)] || ''
      return value.trim() !== '' && !isValidPhoneDigits(value)
    })

    if (invalidPhoneField) {
      showResult('error', `${invalidPhoneField.label} 10 veya 11 haneli olmalidir. Ornek: 05XXXXXXXXX`)
      return
    }

    setSubmitStatus('loading')
    setSubmitMessage('Başvuru kaydediliyor...')
    setSubmitDialog(null)

    try {
      const visibleKeys = new Set(visibleFields.map((field) => fieldKey(field)))
      const visibleValues = Object.fromEntries(
        Object.entries(values).filter(([key]) => visibleKeys.has(key) || ['tc', 'birthDate', 'fullName', 'address', 'addressNo'].includes(key)),
      )
      const response = await fetch('/api/online-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId: selectedForm.id,
          formTitle: selectedForm.title,
          values: { ...visibleValues, tc },
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Başvuru kaydedilemedi.')
      }

      setValues({})
      setLookupStatus('idle')
      setLookupMessage('')
      showResult('success', settings.onlineApplicationSuccessMessage)
    } catch (error) {
      showResult('error', error instanceof Error ? error.message : 'Başvuru kaydedilemedi.')
    }
  }

  const lookupNvi = async () => {
    const tc = (values.tc || '').replace(/\D/g, '')
    const birthDate = values.birthDate || ''

    if (tc.length !== 11 || !birthDate) return

    const lookupKey = `${tc}:${birthDate}`
    if (lastLookupKeyRef.current === lookupKey && lookupStatus === 'success') return

    lastLookupKeyRef.current = lookupKey
    setLookupStatus('loading')
    setLookupMessage('Nüfus bilgileri sorgulanıyor...')

    try {
      const birthYear = birthDate.slice(0, 4)
      const response = await fetch('/api/nvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tcNo: tc,
          dogumYili: birthYear,
          dogumTarihi: birthDate,
          serviceId: 'tcKimlik',
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Nüfus bilgileri alınamadı.')
      }

      const data = payload.data
      const nviAddress = String(data.adres || '').trim()
      setValues((current) => ({
        ...current,
        tc,
        birthDate,
        fullName: [data.ad, data.soyad].filter(Boolean).join(' '),
        address: nviAddress || current.address || '',
        addressNo: data.adresNo || data.adresno || current.addressNo || '',
      }))
      setLookupStatus('success')
      setLookupMessage('Kişi ve adres bilgileri nüfustan alındı.')

      if (!nviAddress) {
        setResidencyIssue({ type: 'no-address' })
        setResidencyDialogOpen(true)
      } else {
        const villageName = extractVillageName(nviAddress)
        if (villageName) {
          setResidencyIssue({ type: 'village', villageName })
          setResidencyDialogOpen(true)
        } else {
          setResidencyIssue(null)
          setResidencyDialogOpen(false)
        }
      }
    } catch (error) {
      setLookupStatus('error')
      setLookupMessage(error instanceof Error ? error.message : 'Nüfus bilgileri alınamadı.')
      setResidencyIssue({ type: 'no-address' })
      setResidencyDialogOpen(true)
    }
  }

  // Kullanici istegi (2026-09-28): "sayfanın üzerinde yeni başvuru
  // butonuda ekleyelim bu buton sayfada kayıtlı bilgileri temizleyerek
  // yeni başvuru sayfası açsın" + "adres bilgisine ulaşılamadı diyorsa
  // sayfayı temizleyip yeni başvuru yapmasını istesin" - sayfayi
  // yenilemek (idle-timeout'ta zaten kullanilan AYNI yontem, bkz. asagidaki
  // useEffect), TUM form state'ini (values/lookupStatus/residencyIssue/
  // onay kutulari vb.) tek tek sifirlamaktan daha guvenilir - hicbir alan
  // unutulmaz.
  const startNewApplication = () => {
    window.location.reload()
  }

  useEffect(() => {
    if ((values.tc || '').replace(/\D/g, '').length !== 11 || !values.birthDate) return
    const timer = window.setTimeout(() => {
      void lookupNvi()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [values.tc, values.birthDate])

  useEffect(() => {
    setIsIntroAccepted(false)
    setIsIntroConsentChecked(false)
  }, [introStorageKey])

  // Kullanici istegi (2026-09-22): "bu zaman aşımı süresini 5 dakika olarak
  // ayarlasak kim olursa olsun bu süre içinde başvurusunu yapabilir bu süre
  // dolunce otomatik uyarı versin ve sayfayı yenilesin" - vatandas bu
  // SPESIFIK basvuru formu sayfasina girdikten sonra 5 dakika boyunca HICBIR
  // etkilesim (tiklama/tus/dokunma/kaydirma) olmazsa otomatik uyari
  // gosterilip kisa bir sure sonra sayfa yenilenir. SUREKLI aktif/form
  // dolduran bir vatandas (her etkilesimde sayac sifirlanir) BU SURE
  // ICINDE HICBIR ZAMAN bu uyariyla karsilasmaz - sadece gercekten TERK
  // EDILMIS/unutulmus oturumlar (ör. ortak bir kiosk bilgisayarda TC/adres
  // gibi kisisel bilgiler sonsuza kadar ekranda acik kalmasin diye) kapatilir.
  useEffect(() => {
    if (!selectedForm?.active) return

    const IDLE_LIMIT_MS = 5 * 60 * 1000
    const WARNING_DISPLAY_MS = 5000
    let idleTimer: number
    let reloadTimer: number

    const resetIdleTimer = () => {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        setIdleWarningVisible(true)
        reloadTimer = window.setTimeout(() => {
          window.location.reload()
        }, WARNING_DISPLAY_MS)
      }, IDLE_LIMIT_MS)
    }

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer))
    resetIdleTimer()

    return () => {
      window.clearTimeout(idleTimer)
      window.clearTimeout(reloadTimer)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer))
    }
  }, [selectedForm?.active, selectedForm?.id])

  const acceptIntro = () => {
    setIsIntroAccepted(true)
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef5fb_46%,#f8fafc_100%)] text-slate-950">
      {selectedForm?.active && !isIntroAccepted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-3 py-4 sm:px-4 sm:py-6">
          {/* Kullanici istegi (14 Eylul 2026, 6. tur): "mobilde popup hala
              kapatilamiyor" - kok neden: bu dugme onceden modal KARTININ
              (asagidaki "overflow-y-auto" olan div) ICINDE, "absolute"
              konumlandirilmisti. Mobilde kriter listesi uzun oldugunda
              kart kaydirildiginda dugme de kartla BIRLIKTE yukari kayip
              gorunmez oluyordu. Simdi bu dugme kartin DISINDA, hicbir
              zaman kaymayan DIS katmanin (bu "fixed inset-0" sarmalayici)
              dogrudan cocugu - "fixed" konumlandirma ile ekranin/viewport'un
              kosesine sabitlenir, kart ne kadar kaydirilirsa kaydirilsin
              HER ZAMAN erisilebilir kalir. "Vazgeç" ile AYNI guvenli hedefe
              (/onlinebasvuru) gider - asla ic yonetim ekranina gecmez. */}
          <a
            href="/onlinebasvuru"
            aria-label="Kapat"
            className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-base font-black text-white shadow-lg transition hover:bg-black/60 active:bg-black/70 sm:right-6 sm:top-6 sm:h-10 sm:w-10"
          >
            ✕
          </a>
          {/* Kullanici istegi (2026-09-22): kaydirma cubugunun gercekten
              calismasi icin sadece "min-h-0" (asagida) yetmiyordu - CSS
              Grid'de varsayilan satir boyutu ("auto") icerik kadar
              BUYUYEBILIYOR, "max-height" TEK BASINA satiri sikistirmiyor.
              "md:grid-rows-[minmax(0,1fr)]" ile tek satir ACIKCA "en fazla
              kapsayicinin (max-h ile sinirli) yuksekligi kadar" olarak
              sinirlanir - boylece alt ogedeki min-h-0 + overflow-y-auto
              GERCEKTEN devreye girer. */}
          <div className="relative grid max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/20 bg-white shadow-2xl sm:max-h-[92vh] md:grid-cols-[245px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
            <div className="bg-[#003f82] p-4 text-white sm:p-6">
              <div className="flex h-full min-h-0 flex-col justify-between gap-4 sm:gap-5 md:min-h-64 md:gap-6">
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2.5 shadow-lg sm:h-24 sm:w-24 sm:p-3">
                    <img src={introImageUrl} alt={`${introTitle} görseli`} className="h-full w-full object-contain" />
                  </div>
                  <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-white/65 sm:mt-5 sm:text-xs">{settings.institutionName}</p>
                  <h2 className="mt-1 text-xs font-black leading-tight sm:text-2xl">{introTitle}</h2>
                </div>
                <div className="hidden">
                  Kriterleri okuyup onayladıktan sonra başvuru formuna geçebilirsiniz.
                </div>
                <div className="rounded-xl border border-white/15 bg-white/10 p-3 text-[11px] font-bold leading-relaxed text-white/85 sm:p-4 sm:text-sm">
                  Onay verdiginizde basvuru formu acilir. Kriterleri saglamayan basvurular sistem tarafindan kabul edilmez.
                </div>
              </div>
            </div>

            {/* Kullanici istegi (2026-09-22): "kriter penceresindeki veriler
                bazı ekranlarda alanı sığmadığı için alttaki butonlar
                görünmüyor... yanda kaydırma çubuğu çıksın" - kok neden: bu
                div zaten "overflow-y-auto" idi ama CSS Grid'in varsayilan
                davranisi geregi (grid ogeleri varsayilan "min-height: auto"
                ile icerigi kadar BUYUYEBILIR) bu overflow HICBIR ZAMAN
                devreye girmiyordu - ust grid kapsayicisi md: ve uzerinde
                "overflow-hidden" oldugu icin tasan icerik (ve alttaki
                butonlar) sessizce KIRPILIYORDU, hicbir kaydirma cubugu
                cikmiyordu. "min-h-0" ile bu div'in ust grid satirinin
                (max-h-[90vh] ile sinirli) yuksekligine SIKISMASINA izin
                verilir - boylece kendi "overflow-y-auto"su GERCEKTEN
                calisir ve icerik uzun oldugunda sag tarafta bir kaydirma
                cubugu belirir, en alttaki butonlara kaydirarak erisilebilir. */}
            <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
              <p className="text-[10px] font-black uppercase tracking-wide text-[#0076b6] sm:text-xs">Başvuru Ön Bilgilendirme</p>
              <h3 className="mt-1 text-xs font-black text-slate-950 sm:text-2xl">Kriterler ve Onay</h3>
              {/* Kullanici istegi (2026-09-22): "BU ŞEKİLDE GERÜNMESİNİ
                  İSTİYORUM AMA PUPAP EKRANINDA GÖRSELDEKİ GİBİ GÖRÜNÜYOR" -
                  madde isaretli/satir satir yazilan bir aciklama metni,
                  duz bir <p> icinde TEK satir halinde (satir sonlari
                  yutuluyordu) goruntuleniyordu. "whitespace-pre-line"
                  satir sonlarini (\n) KORUYUP goruntuler, boylece admin'in
                  yazdigi madde/satir yapisi popup'ta da aynen gorunur.
                  Fazla bosluk dizileri yine tek bosluga indirgenir (normal
                  HTML davranisi), sadece satir sonlari korunur. */}
              <p className="mt-2 whitespace-pre-line text-xs font-bold leading-relaxed text-slate-800 sm:text-base">
                {introDescription}
              </p>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:mt-5 sm:p-4">
                <p className="text-[10px] font-black uppercase text-slate-500 sm:text-xs">Uygulanacak Kriterler</p>
                <ul className="mt-3 space-y-2">
                  {criteriaItems.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 sm:text-sm">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0076b6] text-[11px] font-black text-white">{index + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                  {/* Kullanici istegi (2026-09-22, devam): "bilgi 3. madde
                      olarak ... kırmızı yazı ile olsun okudum onaylıyorum
                      tiki atınca yeşile dönsün ve bu bilgi tüm pupap
                      formlarında sabit olsun" - form kriterlerinden BAGIMSIZ,
                      HER formda HER ZAMAN gorunen sabit bir madde. Onay
                      kutucugu isaretlenmeden KIRMIZI, isaretlenince YESILE
                      doner (gorsel geri bildirim).
                  */}
                  <li className={`flex gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold sm:text-sm ${
                    isIntroConsentChecked
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${
                      isIntroConsentChecked ? 'bg-emerald-600' : 'bg-rose-600'
                    }`}>{criteriaItems.length + 1}</span>
                    <span>Gelir tespiti için yapılacak tüm araştırmalara izin veriyorum.</span>
                  </li>
                </ul>
                {criteriaItems.length === 0 && (
                  <p className="mt-3 text-[10px] font-semibold text-slate-500 sm:text-xs">
                    Bu form için ek bir engelleyici kriter tanımlanmamış. Başvurunun değerlendirilebilmesi için bilgilerin doğru ve eksiksiz girilmesi gerekir.
                  </p>
                )}
              </div>

              <div className="hidden">
                Onay verdiğinizde başvuru formu açılır. Kriterleri sağlamayan başvurular sistem tarafından kabul edilmez.
              </div>

              {/* Kullanici istegi (2026-09-22): "kriter ve onay penceresinde
                  ... butonu yanında bir okudum onaylıyorum kutucuğu olsun
                  vatandaş bu kutucuğa tik attıktan sonra devam et butonuna
                  basarak başvuruya devam etsin" - buton artik SADECE bu
                  kutucuk isaretliyken tiklanabilir. */}
              <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:mt-6">
                <input
                  type="checkbox"
                  checked={isIntroConsentChecked}
                  onChange={(event) => setIsIntroConsentChecked(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#0076b6]"
                />
                <span className="text-[11px] font-bold text-slate-700 sm:text-sm">Okudum, onaylıyorum</span>
              </label>

              <div className="mt-3 flex flex-col gap-2.5 sm:mt-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                {/* GUVENLIK DUZELTMESI (14 Eylul 2026, 2. tur): bu link
                    eskiden "/online" (parametresiz) adresine gidiyordu -
                    O adres oturum GEREKTIREN ic yonetim ekranidir
                    ("Vatandaş Başvuru Listesi", bkz. app/online/page.tsx +
                    proxy.ts). Zaten oturum acik olan bir personel bu
                    vatandas-yuzlu sayfayi test ederken "Vazgeç"e basinca
                    doğrudan ic yonetim paneline dusuyordu - vatandasa acik
                    bir sayfadan uygulamanin icine ASLA gecis olmamali.
                    "/onlinebasvuru" ise TAMAMEN kamuya acik (oturum
                    gerektirmez) ve zaten kurumun tum basvuru turlerinin
                    listelendigi dogru "iptal" hedefi. */}
                <a
                  href="/onlinebasvuru"
                  className="w-full rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-center text-xs font-black text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-3 sm:text-sm"
                >
                  Vazgeç
                </a>
                <button
                  type="button"
                  onClick={acceptIntro}
                  disabled={!isIntroConsentChecked}
                  className="w-full rounded-lg bg-[#6fb744] px-6 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-[#5aa333] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:hover:bg-slate-300 sm:w-auto sm:py-3 sm:text-sm"
                >
                  Başvuruya Devam Et
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {idleWarningVisible && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
            <div className="bg-gradient-to-r from-amber-50 via-white to-orange-50 px-6 py-5">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-xl font-black text-amber-700 shadow-sm">
                  !
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-amber-600">Zaman Aşımı</p>
                  <h2 className="mt-1 text-xl font-black leading-tight text-slate-950">Süre doldu</h2>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm font-bold leading-relaxed text-slate-700">
                5 dakika boyunca işlem yapılmadığı için güvenlik amacıyla sayfa yenileniyor. Girdiğiniz bilgiler için lütfen başvuruyu yeniden başlatın.
              </p>
            </div>
          </div>
        </div>
      )}
      {submitDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
            <div className={`px-6 py-5 ${
              submitDialog.type === 'error'
                ? 'bg-gradient-to-r from-rose-50 via-white to-orange-50'
                : 'bg-gradient-to-r from-emerald-50 via-white to-sky-50'
            }`}>
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl font-black shadow-sm ${
                  submitDialog.type === 'error'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {submitDialog.type === 'error' ? '!' : '✓'}
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-black uppercase tracking-wide ${
                    submitDialog.type === 'error' ? 'text-rose-600' : 'text-emerald-700'
                  }`}>
                    {submitDialog.type === 'error' ? 'Bilgilendirme' : 'Başvuru Alındı'}
                  </p>
                  <h2 className="mt-1 text-xl font-black leading-tight text-slate-950">
                    {submitDialog.type === 'error' ? 'Başvuru tamamlanamadı' : 'İşlem başarılı'}
                  </h2>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm font-bold leading-relaxed text-slate-700">
                {submitDialog.message}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubmitDialog(null)
                  setSubmitStatus('idle')
                  setSubmitMessage('')
                }}
                className={`mt-6 w-full rounded-xl px-5 py-3 text-sm font-black text-white shadow-sm transition ${
                  submitDialog.type === 'error'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-[#6fb744] hover:bg-[#5aa333]'
                }`}
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
      {residencyDialogOpen && residencyIssue && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border-4 border-rose-600 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)]">
            <div className="bg-rose-600 px-6 py-4">
              <p className="text-center text-sm font-black uppercase tracking-wide text-white">Başvuru Yapılamıyor</p>
            </div>
            <div className="px-6 py-6 text-center">
              <p className="text-base font-black leading-relaxed text-rose-700">
                {residencyIssue.type === 'village'
                  ? `ADRESİNİZ ${residencyIssue.villageName} KÖYÜDÜR. BU YARDIMA BAŞVURU YAPABİLMENİZ İÇİN SİVAS MERKEZDE İKAMET ETMENİZ GEREKMEKTEDİR.`
                  : 'SİVAS MERKEZDE KAYITLI ADRES BİLGİSİNE ULAŞILAMADI.'}
              </p>
              {/* Kullanici istegi (2026-09-28): "adres bilgisine
                  ulaşılamadı diyorsa sayfayı temizleyip yeni başvuru
                  yapmasını istesin" - vatandas adresini kendisi yazarak bu
                  engeli atlatamasin diye (adres alani artik HER ZAMAN
                  salt-okunur), tek anlamli cikis yolu sayfayi tamamen
                  temizleyip bastan baslamak. */}
              <p className="mt-3 text-sm font-bold text-slate-600">
                Lütfen T.C. Kimlik No ve Doğum Tarihinizi kontrol ederek yeni bir başvuru başlatın.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={startNewApplication}
                  className="w-full rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-rose-700"
                >
                  Yeni Başvuru
                </button>
                <button
                  type="button"
                  onClick={() => setResidencyDialogOpen(false)}
                  className="w-full rounded-xl border-2 border-rose-600 bg-white px-5 py-2.5 text-sm font-black text-rose-700 shadow-sm transition hover:bg-rose-50"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <section className="bg-gradient-to-br from-[#003f82] via-[#075b9f] to-[#0f8fb8] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 sm:px-5 sm:py-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white p-1.5 shadow-lg sm:h-24 sm:w-24 sm:p-2">
              <img src={settings.logoDataUrl} alt={`${settings.institutionName} logosu`} className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-white/70">{settings.institutionName}</p>
              <h1 className="text-2xl font-black leading-tight sm:text-3xl md:text-4xl">{settings.departmentName}</h1>
              {false && contactItems.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {contactItems.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm">
                      <span className="block text-[10px] font-black uppercase tracking-wide text-white/55">{item.label}</span>
                      {item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 block text-xs font-black leading-snug text-white underline-offset-2 hover:underline"
                        >
                          {item.value}
                        </a>
                      ) : (
                        <span className="mt-0.5 block text-xs font-bold leading-snug text-white/90">{item.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Kullanici istegi (2026-09-28): "sayfanın üzerinde yeni
              başvuru butonuda ekleyelim bu buton sayfada kayıtlı
              bilgileri temizleyerek yeni başvuru sayfası açsın" - onceden
              bu konumda hicbir zaman gorunmeyen ("hidden") bir kutu
              vardi, onun yerine HER ZAMAN gorunur bu buton koyuldu. */}
          <div className="flex justify-center md:justify-end">
            <button
              type="button"
              onClick={startNewApplication}
              className="inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-black text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
            >
              Yeni Başvuru
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-none flex-col gap-5 px-3 py-5 sm:px-5 md:px-8 xl:flex-row xl:items-start 2xl:px-[2cm]">
        {/* Kullanici istegi (2026-09-22): "mobil tarafta... ön
            bilgilendirme alanı görünmesin bu alan sadece web tarafında
            görünsün" - artik xl (masaustu) alti tamamen gizli, sadece
            masaustu/genis ekranda gorunur. */}
        <aside className="hidden space-y-4 xl:order-1 xl:block xl:w-[460px] xl:shrink-0 2xl:w-[540px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
            <div className="p-5">
              <p className="text-xs font-black uppercase tracking-wide text-[#0076b6]">Başvuru Ön Bilgilendirme</p>
              <h2 className="mt-1 text-2xl font-black leading-tight text-[#003f82]">{introTitle}</h2>
              <h3 className="mt-4 text-lg font-black text-[#0076b6]">Kriterler ve Onay</h3>
              <p className="mt-2 whitespace-pre-line text-base font-bold leading-relaxed text-slate-800">
                {introDescription}
              </p>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black uppercase text-[#005f95]">Uygulanacak Kriterler</p>
                <ul className="mt-3 space-y-2">
                  {criteriaItems.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0076b6] text-[11px] font-black text-white">{index + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                  {/* Kullanici istegi (2026-09-22, devam): tum formlarda
                      sabit gorunen gelir tespiti onay maddesi - bu (masaustu
                      sabit) panelde onay kutucugu olmadigi icin renk
                      degismez, sabit kirmizi gosterilir. */}
                  <li className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[11px] font-black text-white">{criteriaItems.length + 1}</span>
                    <span>Gelir tespiti için yapılacak tüm araştırmalara izin veriyorum.</span>
                  </li>
                </ul>
                {criteriaItems.length === 0 && (
                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Bu form için ek bir engelleyici kriter tanımlanmamış. Başvurunun değerlendirilebilmesi için bilgilerin doğru ve eksiksiz girilmesi gerekir.
                  </p>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-relaxed text-amber-900">
                Başvuru bilgilerinin doğru girilmesi gerekir. Kriterleri sağlamayan başvurular sistem tarafından kabul edilmez.
              </div>
            </div>
          </div>

          <div className="hidden">
            <h2 className="text-sm font-black uppercase text-slate-500">Aktif Başvurular</h2>
            <div className="mt-3 space-y-2">
              {activeForms.length > 0 ? activeForms.map((form) => (
                <a
                  key={form.id}
                  href={`/online?form=${encodeURIComponent(form.id)}`}
                  className={`block rounded-lg border px-3 py-2.5 text-sm font-black transition ${selectedForm?.id === form.id ? 'border-[#0076b6] bg-sky-50 text-[#005f95]' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  {form.title}
                </a>
              )) : (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm font-bold text-slate-500">
                  Yayında başvuru formu bulunmuyor.
                </p>
              )}
            </div>
          </div>
        </aside>

        <div className="order-1 min-w-0 overflow-hidden rounded-2xl border border-white bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)] ring-1 ring-slate-200/70 sm:rounded-3xl xl:order-2 xl:max-w-[820px] xl:flex-1">
          {selectedForm?.active ? (
            <>
              <div className="border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-4 py-5 sm:px-6 sm:py-6">
                <p className="text-[11px] font-black uppercase tracking-wide text-[#0076b6] sm:text-xs">Online Başvuru</p>
                <h2 className="mt-1 text-base font-black leading-tight text-[#003f82] sm:text-2xl">{selectedForm.title}</h2>
                <p className="mt-2 max-w-2xl text-xs font-semibold leading-relaxed text-slate-600 sm:text-sm">
                  {settings.onlineApplicationInfoText}
                </p>
              </div>
              <div className="p-4 sm:p-6">
              <form className="space-y-5">
                <div className="rounded-2xl border-2 border-sky-200 bg-sky-50 p-3 sm:p-4">
                  {/* Kullanici istegi (14 Eylul 2026, 2. tur): "tc ve doğum
                      tarihi aynı renk tonu ile... guplansın" - bu kutu
                      zaten mavi/sky tonundaydi, sadece belirgin baslik
                      eklendi ve kenarlik kalinlastirildi (digerleriyle
                      tutarli olsun diye). */}
                  <p className="mb-3 text-[10px] font-black uppercase tracking-wide text-[#005f95] sm:text-[11px]">Kimlik Bilgileri</p>
                  {/* Kullanici istegi (14 Eylul 2026): "veriler alt alta
                      listelensin" - bu alan artik iki sutuna degil, tek
                      sutuna (dikey) diziliyor. */}
                  <div className="grid grid-cols-1 gap-3 sm:gap-4">
                    <label className="flex flex-col gap-1 sm:gap-1.5">
                      <span className="text-[10px] font-black uppercase text-slate-500 sm:text-xs">{tcField?.label || 'T.C. Kimlik No'} <span className="text-rose-500">*</span></span>
                      <input
                        value={values.tc || ''}
                        onChange={(event) => setValue('tc', event.target.value.replace(/\D/g, '').slice(0, 11))}
                        inputMode="numeric"
                        maxLength={11}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-900 outline-none transition focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100 sm:px-3 sm:py-2.5 sm:text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 sm:gap-1.5">
                      <span className="text-[10px] font-black uppercase text-slate-500 sm:text-xs">Doğum Tarihi <span className="text-rose-500">*</span></span>
                      <BirthDateTextInput
                        value={values.birthDate || ''}
                        onChange={(iso) => setValue('birthDate', iso)}
                        ariaLabel="Doğum Tarihi"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-900 outline-none transition focus:border-[#0076b6] focus:ring-2 focus:ring-sky-100 sm:px-3 sm:py-2.5 sm:text-sm"
                      />
                    </label>
                  </div>
                  {/* Kullanici istegi (14 Eylul 2026): "tc ve dogum tarihini
                      girince bilgiler nufustan otomatik ceksin" - bu ozellik
                      zaten mevcuttu (asagidaki lookupNvi/useEffect, /api/nvi
                      oturumsuz erisime acik) ve dogrulandi (canli sunucuya
                      karsi test edildi) - sadece kullaniciya bunun
                      olacagini aciklayan bir ipucu metni eklendi, MEVCUT
                      mantiga (diger alanlarin bozulmamasi icin) DOKUNULMADI. */}
                  <p className="mt-2 text-[10px] font-semibold text-slate-500 sm:text-[11px]">
                    T.C. Kimlik No ve Doğum Tarihinizi girdiğinizde ad soyad ve adres bilgileriniz nüfus kayıtlarından otomatik doldurulur.
                  </p>
                  {lookupMessage && (
                    <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold sm:text-xs ${
                      lookupStatus === 'error'
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : lookupStatus === 'success'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-sky-200 bg-white text-[#005f95]'
                    }`}>
                      {lookupStatus === 'loading' && (
                        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-300 border-t-[#0076b6]" />
                      )}
                      {lookupMessage}
                    </div>
                  )}
                </div>

                {/* Kullanici istegi (2026-09-21): tum alanlar TEK "Kişisel
                    Bilgiler" kutusunda, alt alta, form tasarimcisindaki
                    (yeniden siralanmis) sirayla listeleniyor - eski iki
                    renkli grup ayrimi kaldirildi. */}
                {visibleFields.length > 0 && (
                  <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-3 sm:p-4">
                    <p className="mb-3 text-[10px] font-black uppercase tracking-wide text-indigo-800 sm:text-[11px]">Kişisel Bilgiler</p>
                    <div className="grid grid-cols-1 gap-3 sm:gap-4">
                      {visibleFields.map((field) => {
                        const key = fieldKey(field)
                        return (
                          <label key={field.id} className="flex min-w-0 flex-col gap-1 sm:gap-1.5">
                            <span className="text-[10px] font-black uppercase text-indigo-700 sm:text-xs">
                              {field.label} {field.required && <span className="text-rose-500">*</span>}
                            </span>
                            <OnlineInput
                              field={field}
                              value={values[key] || ''}
                              onChange={(value) => setValue(key, value)}
                              locked={
                                (key === 'fullName' || key === 'address') &&
                                lookupStatus === 'success' &&
                                lastLookupKeyRef.current === `${(values.tc || '').replace(/\D/g, '')}:${values.birthDate || ''}` &&
                                (values[key] || '').trim() !== ''
                              }
                            />
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
                {residencyIssue && (
                  <div className="flex flex-col gap-2 rounded-lg border-2 border-rose-300 bg-rose-50 px-3 py-2.5 text-sm font-black text-rose-700 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {residencyIssue.type === 'village'
                        ? `ADRESİNİZ ${residencyIssue.villageName} KÖYÜDÜR. BU YARDIMA BAŞVURU YAPABİLMENİZ İÇİN SİVAS MERKEZDE İKAMET ETMENİZ GEREKMEKTEDİR.`
                        : 'SİVAS MERKEZDE KAYITLI ADRES BİLGİSİNE ULAŞILAMADI.'}
                    </span>
                    <button
                      type="button"
                      onClick={startNewApplication}
                      className="shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-rose-700"
                    >
                      Yeni Başvuru
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
                  <p className="text-[11px] font-semibold text-slate-500 sm:text-xs">Başvuruyu gönderdikten sonra kurum personeli tarafından incelenecektir.</p>
                  <button
                    type="button"
                    onClick={() => void submitApplication()}
                    disabled={submitStatus === 'loading' || Boolean(residencyIssue)}
                    className="w-full rounded-lg bg-[#6fb744] px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-[#5aa333] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                  >
                    Başvuruyu Gönder
                  </button>
                </div>
                {submitStatus === 'loading' && submitMessage && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-[#005f95]">
                    {submitMessage}
                  </div>
                )}
              </form>
              </div>
            </>
          ) : (
            <div className="p-10 text-center">
              <h2 className="text-2xl font-black text-slate-900">Bu başvuru formu yayında değil</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">Lütfen aktif başvuru formlarından birini seçin.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
