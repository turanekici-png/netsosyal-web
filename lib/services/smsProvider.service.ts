// Kurumun Ayarlar > Sistem Ayarları > SMS Entegrasyonu bölümünde tanımladığı
// AKTİF SMS firması (Mutlucell / İleti Bilgi Teknolojileri / NetGSM)
// üzerinden GERÇEK SMS gönderimi yapar - bkz. app/api/sms/send/route.ts.
//
// Üç firmanın da API sözleşmesi resmi/topluluk kaynaklarından teyit edilerek
// uygulanmıştır:
//  - NetGSM: JSON REST v2 (api.netgsm.com.tr/sms/rest/v2/send), Basic Auth.
//    Kaynak: NetGSM'in resmi Python/Node SDK'ları (github.com/netgsm).
//  - Mutlucell: XML POST (smsgw.mutlucell.com/smsgw-ws/sndblkex). Kaynak:
//    topluluk kütüphaneleri + bu uygulamanın kendi sms_gonderim_log
//    tablosundaki GEÇMİŞ harici gönderim kayıtlarıyla (ör. "Mutlucell
//    hata/uyarı kodu: 23") DOĞRULANDI.
//  - İleti Bilgi Teknolojileri (iletibilgi.com.tr): JSON POST
//    (v1/send-sms/json), key+HMAC-SHA256(key, secret) imzası. Bu firmanın
//    KENDİ dokümantasyonuna ulaşılamadı - aynı ürün ailesini kullanan
//    iletiMerkezi/eMarka'nın RESMİ dokümantasyonu ve PHP SDK'sı baz alınarak
//    uygulandı (yaygın "aynı altyapı, farklı marka" beyaz etiket modeli).
//    Gerçek API farklı çıkarsa, ilk canlı denemedeki hata mesajı üzerinden
//    düzeltilebilir.
//
// Not: whatsapp-web.js entegrasyonunda olduğu gibi (bkz.
// lib/services/whatsappWeb.service.ts), üçüncü taraf API'lerin gerçek
// davranışı zamanla değişebilir - canlı bir gönderim hata verirse, dönen
// "cevap" (ham yanıt) sms_gonderim_log'a kaydedilir ve tanı için kullanılabilir.
import crypto from 'crypto'
import { settingService } from './settings.service'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'

const SMS_INTEGRATION_SETTINGS_KEY = 'sms_integration_settings'

type SmsProviderId = 'mutlucell' | 'ileti' | 'netgsm'

interface SmsProviderSettings {
  enabled: boolean
  senderTitle: string
  apiUrl: string
  username: string
  password: string
  apiKey: string
  apiSecret: string
  customerCode: string
  testPhone: string
  notes: string
}

interface SmsIntegrationSettings {
  activeProvider: SmsProviderId
  providers: Partial<Record<SmsProviderId, SmsProviderSettings>>
}

export interface SendSmsResult {
  ok: boolean
  error?: string
  raw?: string
}

async function getActiveSmsProvider(): Promise<{ id: SmsProviderId; settings: SmsProviderSettings } | null> {
  const setting = await settingService.getByKey(SMS_INTEGRATION_SETTINGS_KEY)
  const value = setting?.value as SmsIntegrationSettings | undefined
  if (!value?.activeProvider) return null

  const providerSettings = value.providers?.[value.activeProvider]
  if (!providerSettings?.enabled) return null

  return { id: value.activeProvider, settings: providerSettings }
}

// Kullanici istegi: nakit yardımları listesinden (ve digerlerinden) toplu
// SMS gönderilirken, gönderilen HER mesajın bir kopyası AYNI ZAMANDA
// Ayarlar > SMS Entegrasyonu'ndaki AKTİF firmanın "Test Telefon Numarası"na
// da gitsin - boylece mesajin GERCEKTEN gidip gitmedigi ve tam olarak ne
// icerikle gittigi (kisisellestirme dahil) dogrudan telefonda goruntulenip
// dogrulanabilir. Test numarasi tanimli DEGILSE null doner, cagiran taraf
// (smsBulk.service.ts) bu durumda kopya gondermeyi SESSIZCE atlar.
export async function getActiveSmsProviderTestPhone(): Promise<string | null> {
  const active = await getActiveSmsProvider()
  const phone = active?.settings.testPhone?.trim()
  return phone || null
}

function escapeXml(value: string): string {
  return (value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

// Mutlucell'in kendi hata/uyarı kod tablosu - dönen yanıt sayısal bir kodsa
// bu tabloya göre okunabilir bir mesaja çevrilir (bkz. servisin kendi
// sndblkex uç noktasının davranışı - HTTP her zaman 200 döner, gerçek
// sonuç gövdedeki koddadır).
const MUTLUCELL_ERROR_CODES: Record<number, string> = {
  20: 'XML formatı hatalı',
  21: 'Başlık sahibi değilsiniz',
  22: 'Yetersiz kredi',
  23: 'Yanlış kimlik bilgileri (kullanıcı adı/şifre)',
  24: 'Aktif başka bir işlem var',
  25: 'Sistem durduruldu, tekrar deneyin',
  30: 'Hesap aktive edilmemiş',
}

// Mutlucell'in GERCEK gonderim uc noktasi HER ZAMAN budur - dokumantasyon/
// tanitim sayfasi (www.mutlucell.com.tr/api/) YANLISLIKLA buraya
// girilebiliyor (canlida bir kez oldu, ayarlar formundan tekrar tekrar
// yanlislikla kaydedildi) ve bu durumda gonderim SESSIZCE (HTTP 200 donup
// XML yerine HTML sayfasi donerek) basarisiz oluyordu. Bu yuzden ayarlarda
// kayitli apiUrl, GERCEK gonderim uc noktasina (host adinda "smsgw" gecen)
// benzemiyorsa YOK SAYILIR ve dogru varsayilan kullanilir - kullanici bu
// alani yanlislikla eski/yanlis bir degerle tekrar kaydetse bile gonderim
// calismaya devam eder.
const MUTLUCELL_SEND_ENDPOINT = 'https://smsgw.mutlucell.com/smsgw-ws/sndblkex'

async function postMutlucellSmspack(endpoint: string, ka: string, pwd: string, org: string, phone10: string, message: string): Promise<{ response: Response; text: string }> {
  const xml = '<?xml version="1.0" encoding="utf-8"?>'
    + `<smspack ka="${escapeXml(ka)}" pwd="${escapeXml(pwd)}" org="${escapeXml(org)}">`
    + `<mesaj><metin>${escapeXml(message)}</metin><nums>${phone10}</nums></mesaj>`
    + '</smspack>'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: xml,
  })
  const text = (await response.text()).trim()
  return { response, text }
}

async function sendViaMutlucell(settings: SmsProviderSettings, phone10: string, message: string): Promise<SendSmsResult> {
  const endpoint = settings.apiUrl && settings.apiUrl.includes('smsgw.mutlucell.com')
    ? settings.apiUrl
    : MUTLUCELL_SEND_ENDPOINT

  let { response, text } = await postMutlucellSmspack(endpoint, settings.username, settings.password, settings.senderTitle, phone10, message)
  let numericCode = /^\d+$/.test(text) ? Number(text) : null

  // Bu hesap icin (canlida dogrulandi - bkz. Mutlucell'in kendi resmi
  // dokumani: "pwd=parolam, eğer oluşturulmuşsa Apikey") "sifre" alaninin
  // API'nin bekledigi GERCEK deger Apikey - kullanicinin panel giris sifresi
  // DEGIL. Ayarlar formundaki "Şifre" kutusu (kullanicinin elle
  // duzenleyebildigi, dolayisiyla yanlislikla panel sifresiyle tekrar
  // kaydedilebilen bir alan) yanlis kimlik bilgisi (kod 23) ile reddedilirse,
  // sistem BURADA KULLANICIYA HATA GOSTERMEDEN, Apikey'i sifre yerine
  // kullanarak OTOMATIK olarak BIR KEZ daha dener - boylece formdaki alan
  // hangi degeri tutarsa tutsun gonderim calismaya devam eder.
  if (numericCode === 23 && settings.apiKey && settings.apiKey !== settings.password) {
    ;({ response, text } = await postMutlucellSmspack(endpoint, settings.username, settings.apiKey, settings.senderTitle, phone10, message))
    numericCode = /^\d+$/.test(text) ? Number(text) : null
  }

  if (numericCode !== null && MUTLUCELL_ERROR_CODES[numericCode]) {
    return { ok: false, error: `Mutlucell hata/uyarı kodu: ${numericCode} - ${MUTLUCELL_ERROR_CODES[numericCode]}`, raw: text }
  }
  if (!response.ok) {
    return { ok: false, error: `Mutlucell HTTP ${response.status}`, raw: text }
  }
  return { ok: true, raw: text }
}

async function sendViaNetgsm(settings: SmsProviderSettings, phone10: string, message: string): Promise<SendSmsResult> {
  const baseUrl = (settings.apiUrl || 'https://api.netgsm.com.tr').replace(/\/+$/, '')
  const endpoint = `${baseUrl}/sms/rest/v2/send`
  const authHeader = 'Basic ' + Buffer.from(`${settings.username}:${settings.password}`).toString('base64')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({
      msgheader: settings.senderTitle,
      encoding: 'TR',
      messages: [{ msg: message, no: phone10 }],
    }),
  })
  const text = await response.text()

  if (!response.ok) {
    let code: unknown
    try { code = (JSON.parse(text) as { code?: unknown })?.code } catch { /* JSON degil */ }
    return { ok: false, error: code ? `NetGSM hata kodu: ${code}` : `NetGSM HTTP ${response.status} - ${text.slice(0, 200)}`, raw: text }
  }
  return { ok: true, raw: text }
}

function computeIletiHash(apiKey: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(apiKey).digest('hex')
}

async function sendViaIleti(settings: SmsProviderSettings, phone12: string, message: string): Promise<SendSmsResult> {
  const baseUrl = (settings.apiUrl || 'https://api.iletibilgi.com.tr').replace(/\/+$/, '')
  const endpoint = `${baseUrl}/v1/send-sms/json`
  const hash = computeIletiHash(settings.apiKey, settings.apiSecret)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: {
        authentication: { key: settings.apiKey, hash },
        order: {
          sender: settings.senderTitle,
          iys: '0',
          message: {
            text: message,
            receipents: { number: [phone12] },
          },
        },
      },
    }),
  })
  const text = await response.text()
  let parsed: { response?: { status?: { code?: number | string; message?: string } } } | null = null
  try { parsed = JSON.parse(text) } catch { /* JSON degil */ }

  const statusCode = parsed?.response?.status?.code
  const statusMessage = parsed?.response?.status?.message
  const isSuccess = response.ok && (statusCode === undefined || Number(statusCode) === 200)

  if (!isSuccess) {
    return {
      ok: false,
      error: statusMessage ? `İleti Bilgi Teknolojileri: ${statusCode} - ${statusMessage}` : `İleti Bilgi Teknolojileri HTTP ${response.status} - ${text.slice(0, 200)}`,
      raw: text,
    }
  }
  return { ok: true, raw: text }
}

// rawPhone herhangi bir formatta (05xx..., +905xx..., 5xx... vb.) gelebilir -
// bkz. app/(modules)/documents/page.tsx "SMS Gönder" formu.
export async function sendSmsMessage(rawPhone: string, message: string): Promise<SendSmsResult> {
  const active = await getActiveSmsProvider()
  if (!active) {
    return {
      ok: false,
      error: 'Aktif bir SMS firması tanımlı değil ya da devre dışı. Ayarlar > Sistem Ayarları > SMS Entegrasyonu bölümünden tanımlayıp etkinleştirin.',
    }
  }
  if (!active.settings.senderTitle.trim()) {
    return { ok: false, error: 'Gönderici başlığı (sender title) tanımlı değil.' }
  }

  // "90XXXXXXXXXX" (ulke kodlu, basinda + olmadan) - normalizeWhatsappPhoneNumber
  // genel bir TR cep telefonu normalizasyonu yapar, WhatsApp'a ozgu degildir.
  const withCountryCode = normalizeWhatsappPhoneNumber(rawPhone)
  if (!withCountryCode) {
    return { ok: false, error: 'Telefon numarası geçersiz.' }
  }
  const phone10 = withCountryCode.replace(/^90/, '')

  try {
    switch (active.id) {
      case 'mutlucell':
        return await sendViaMutlucell(active.settings, phone10, message)
      case 'netgsm':
        return await sendViaNetgsm(active.settings, phone10, message)
      case 'ileti':
        return await sendViaIleti(active.settings, withCountryCode, message)
      default:
        return { ok: false, error: 'Tanımsız SMS firması.' }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'SMS gönderilirken beklenmeyen bir hata oluştu.' }
  }
}
