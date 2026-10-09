import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/prisma'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { requireApiAccess } from '@/lib/apiAuth'
import { checkRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'

export const dynamic = 'force-dynamic'

type NviService = {
  id: string
  url?: string
  enabled?: boolean
  serviceName?: string
}

type NviCredentials = {
  user?: string
  pass?: string
  useBridge?: boolean
  bridgeUrl?: string
  bridgeToken?: string
}

type SettingRow = {
  key: string
  value: unknown
}

async function ensureNviSettingsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sistem_ayarlar (
      key text PRIMARY KEY,
      value text,
      updated_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP
    )
  `
}

const defaultServiceUrl = 'https://kps.nvi.gov.tr/Services/KpsServices.svc'
// KPSV2 C# koprusu (bkz. kpsv2/ + scripts/start-kpsv2.ps1) IIS Express ile
// AYNI makinede (uygulama sunucusu) localhost:3500'de calisir. Eski
// yapilandirma 10.0.0.183:3500'e isaret ediyordu - o adres erisilemez
// oldugunda her sorgu 4+ sn TCP zaman asimiyla bekliyordu ("cok yavas").
// Artik NVI_BRIDGE_URL env yoksa localhost varsayilir.
const defaultBridgeUrl = process.env.NVI_BRIDGE_URL?.trim() || 'http://localhost:3500/master.asmx'
// Bagli kalinan tum bridge fetch cagrilarina ust sinir - kopru cevap
// vermezse istek sonsuza kadar asili kalmasin.
const BRIDGE_FETCH_TIMEOUT_MS = 18_000
const legacyDefaultBridgeUrlPattern = /^http:\/\/(?:(?:localhost|127\.0\.0\.1):51331\/master\.asmx|(?:localhost|127\.0\.0\.1):3500(?:\/master\.asmx)?|10\.0\.0\.183:3500(?:\/master\.asmx)?)\/?$/i
const defaultMethodByServiceId: Record<string, string> = {
  tcKimlik: 'TCKimlikNoIleKisiBilgisiSorgula',
  adres: 'KimlikNoIleAdresSorgula',
  maviKart: 'MaviKartSorgulaTCKimlikNoServis',
  nufusKayit: 'TCKimlikNoIleKisiBilgisiSorgula',
}

function parseSettingValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

function escapeXml(value: string | number) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function resolveBridgeUrl(configuredBridgeUrl?: string) {
  const trimmed = configuredBridgeUrl?.trim()
  if (!trimmed || legacyDefaultBridgeUrlPattern.test(trimmed)) {
    return defaultBridgeUrl
  }

  if (/^https?:\/\/[^/]+\/?$/i.test(trimmed)) {
    return `${trimmed.replace(/\/+$/, '')}/master.asmx`
  }

  return trimmed
}

function getTagValue(xml: string, tags: string[]) {
  for (const tag of tags) {
    const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i'))
    if (match?.[1]) return decodeXml(match[1].trim())
  }

  return ''
}

function normalizeServiceConfig(service: NviService) {
  let rawUrl = service.url?.trim() || defaultServiceUrl
  const rawServiceName = service.serviceName?.trim() || ''
  const source = rawServiceName || rawUrl
  
  // AKILLI AYIKLAMA: Eğer serviceName bir URL ise ve rawUrl varsayılan ise, serviceName içindeki URL'yi kullan
  if (rawServiceName.includes('https://') || rawServiceName.includes('http://')) {
    const urlMatch = rawServiceName.match(/(https?:\/\/[^?]+)/)
    if (urlMatch && (rawUrl.includes('kps.nvi.gov.tr') || !rawUrl)) {
      rawUrl = urlMatch[1]
    }
  }

  const serviceMatch = source.match(/[?&]Service=([^&]+)/i)
  const versionMatch = source.match(/[?&]Version=([^&]+)/i)
  const extractedService = serviceMatch ? decodeURIComponent(serviceMatch[1]) : ''
  const extractedVersion = versionMatch ? decodeURIComponent(versionMatch[1]) : ''

  const rawMethod = rawServiceName && !/https?:\/\//i.test(rawServiceName) && !/[?&]Service=/i.test(rawServiceName)
    ? rawServiceName
    : ''
  const isWsdlService = Boolean(extractedService)
  const method = isWsdlService ? 'Sorgula' : rawMethod || defaultMethodByServiceId[service.id] || defaultMethodByServiceId.tcKimlik
  
  // URL Redirection KALDIRILDI - Sadece kullanıcının girdiği (veya ayıklanan) URL kullanılacak
  const serviceUrl = rawUrl

  const namespace = extractedVersion
    ? `http://kps.nvi.gov.tr/${extractedVersion}`
    : 'http://kps.nvi.gov.tr/2011/01/01'

  return {
    method,
    serviceUrl,
    soapAction: extractedService
      ? `${namespace}/${extractedService}/${method}`
      : `http://kps.nvi.gov.tr/2011/01/01/KpsServices/${method}`,
    namespace,
    serviceName: extractedService || '',
    isWsdlService,
  }
}

function buildSoapEnvelope({
  username,
  password,
  method,
  tcNo,
  dogumYili,
  namespace = 'http://kps.nvi.gov.tr/2011/01/01',
  isWsdlService = false,
  serviceName = '',
}: {
  username: string
  password: string
  method: string
  tcNo: string
  dogumYili: string | number
  namespace?: string
  isWsdlService?: boolean
  serviceName?: string
}) {
  if (isWsdlService) {
    const actionServiceName = serviceName || 'BilesikKutukSorgulaKimlikNoServis'
    return `
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:kps="${namespace}">
  <s:Header>
    <a:Action s:mustUnderstand="1">${namespace}/${actionServiceName}/${method}</a:Action>
    <a:To s:mustUnderstand="1">https://kpsv2.nvi.gov.tr/Services/RoutingService.svc</a:To>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password>${escapeXml(password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>
  <s:Body>
    <kps:${method}>
      <kps:kriterListesi>
        <kps:BilesikKutukSorgulaKimlikNoSorguKriteri>
          <kps:DogumYil>${escapeXml(dogumYili)}</kps:DogumYil>
          <kps:KimlikNo>${escapeXml(tcNo)}</kps:KimlikNo>
        </kps:BilesikKutukSorgulaKimlikNoSorguKriteri>
      </kps:kriterListesi>
    </kps:${method}>
  </s:Body>
</s:Envelope>`.trim()
  }

  return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:kps="http://kps.nvi.gov.tr/2011/01/01">
  <soapenv:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password>${escapeXml(password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <kps:${method}>
      <kps:TCKimlikNo>${escapeXml(tcNo)}</kps:TCKimlikNo>
      <kps:DogumYili>${escapeXml(dogumYili)}</kps:DogumYili>
    </kps:${method}>
  </soapenv:Body>
</soapenv:Envelope>`.trim()
}

function mapNviPerson(xmlText: string, tcNo: string, dogumYili: string | number) {
  const gender = getTagValue(xmlText, ['Cinsiyet', 'Cinsiyeti'])

  return {
    tcKimlikNo: tcNo,
    ad: getTagValue(xmlText, ['Ad', 'Adi']),
    soyad: getTagValue(xmlText, ['Soyad', 'Soyadi']),
    dogumTarihi: getTagValue(xmlText, ['DogumTarihi']) || `01.01.${dogumYili}`,
    anneAdi: getTagValue(xmlText, ['AnneAd', 'AnneAdi']),
    babaAdi: getTagValue(xmlText, ['BabaAd', 'BabaAdi']),
    dogumYeri: getTagValue(xmlText, ['DogumYer', 'DogumYeri']),
    olumTarihi: getTagValue(xmlText, ['OlumTarih', 'OlumTarihi', 'VefatTarihi']),
    cinsiyet: gender === '1' || gender.toLocaleUpperCase('tr-TR') === 'ERKEK' ? 'ERKEK' : 'KADIN',
    medeniHal: getTagValue(xmlText, ['MedeniHal', 'MedeniHali']),
    adres: getTagValue(xmlText, ['AcikAdres', 'YerlesimYeriAdres']) || 'Adres bilgisi sistemden alınamadı.',
  }
}

function toFriendlyNviError(message: string) {
  if (/verifying security|InvalidSecurity|security/i.test(message)) {
    return 'NVİ güvenlik doğrulaması başarısız. Servis isteği aldı ancak WS-Security/STS token bilgisini kabul etmedi. Bu servis basit kullanıcı adı/şifre yerine NVİ Kimlik Doğrulama (STS) token akışı gerektiriyor olabilir.'
  }

  return message
}

function splitBirthDate(dogumYili: string | number, dogumTarihi?: string) {
  if (dogumTarihi) {
    const isoMatch = dogumTarihi.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) return { year: isoMatch[1], month: String(Number(isoMatch[2])), day: String(Number(isoMatch[3])) }

    const trMatch = dogumTarihi.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
    if (trMatch) return { year: trMatch[3], month: trMatch[2], day: trMatch[1] }
  }

  return { year: String(dogumYili), month: '1', day: '1' }
}

function parseBridgeJson(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (!match) return null
    return JSON.parse(match[0])
  }
}

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim()
    }
  }

  return ''
}

function unwrapBridgePayload(value: any, keys: string[]) {
  if (Array.isArray(value)) return value[0] || {}

  let current = value
  for (const key of keys) {
    if (current?.[key]) current = current[key]
  }

  if (Array.isArray(current)) return current[0] || {}
  return current || {}
}

function mapBridgePerson(rawValue: any, tcNo: string, dogumYili: string | number) {
  const value = unwrapBridgePayload(rawValue, ['data', 'kimlik'])
  const explanation = firstValue(value?.Aciklama, value?.aciklama, value?.error, rawValue?.message)
  const firstName = firstValue(value?.Adi, value?.adi, value?.ad, value?.Ad, value?.firstName)
  const lastName = firstValue(value?.Soyadi, value?.soyadi, value?.soyad, value?.Soyad, value?.lastName)

  if (!firstName && explanation) {
    return { error: String(explanation) }
  }

  if (!firstName && !lastName) {
    return { error: 'KPSV2 cevap verdi ancak kimlik bilgileri boş geldi. TC kimlik no ve doğum tarihini kontrol edin.' }
  }

  return {
    data: {
      tcKimlikNo: firstValue(value?.TcKimlikNO, value?.TCKimlikNo, value?.tcKimlikNo, value?.kimlikNo, tcNo),
      ad: firstName,
      soyad: lastName,
      dogumTarihi: firstValue(value?.DogumTarihi, value?.dogumTarihi, `01.01.${dogumYili}`),
      anneAdi: firstValue(value?.AnneAdi, value?.anneAdi, value?.AnneAd),
      babaAdi: firstValue(value?.BabaAdi, value?.babaAdi, value?.BabaAd),
      dogumYeri: firstValue(value?.Dogumyeri, value?.DogumYeri, value?.dogumYeri),
      olumTarihi: firstValue(value?.OlumTarihi, value?.olumTarihi, value?.OlumTarih, value?.VefatTarihi),
      cinsiyet: firstValue(value?.Cinsiyet, value?.cinsiyet).toLocaleUpperCase('tr-TR'),
      medeniHal: firstValue(value?.MedeniHal, value?.medeniHal),
      adres: firstValue(value?.adres, value?.acikAdres),
    },
  }
}

function mapBridgeAddress(rawValue: any) {
  const value = unwrapBridgePayload(rawValue, ['data', 'adres'])
  const streetText = firstValue(value?.csbm, value?.cadde, value?.sokak)

  return {
    adres: firstValue(value?.acikAdres, value?.adres),
    il: firstValue(value?.il),
    ilce: firstValue(value?.ilce),
    mahalle: firstValue(value?.mahalle),
    cadde: firstValue(value?.cadde, streetText),
    sokak: firstValue(value?.sokak, streetText),
    caddeSokak: streetText,
    binaNo: firstValue(value?.diskapino, value?.binano, value?.binaNo),
    daireNo: firstValue(value?.ickapino, value?.daireno, value?.daireNo),
    adresNo: firstValue(value?.adresno, value?.adresNo),
  }
}

async function callNviBridge({
  bridgeUrl,
  bridgeToken,
  tcNo,
  dogumYili,
  dogumTarihi,
  serviceId,
}: {
  bridgeUrl: string
  bridgeToken: string
  tcNo: string
  dogumYili: string | number
  dogumTarihi?: string
  serviceId: string
}) {
  const baseUrl = bridgeUrl.replace(/\/+$/, '')
  const { year, month, day } = splitBirthDate(dogumYili, dogumTarihi)
  const method = serviceId === 'adres' ? 'AdresBilgisiGetir' : serviceId === 'nufusKayit' ? 'AileNufusKayitOrnegiGetir' : 'KimlikBilgisiGetirTurkV2'
  const body = new URLSearchParams({
    Token: bridgeToken,
    Tc: tcNo,
  })

  body.set('Year', year)
  body.set('Month', month)
  body.set('Day', day)

  const response = await fetch(`${baseUrl}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body,
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`C# NVİ köprüsü ${response.status} hatası döndürdü: ${text.substring(0, 200)}`)
  }

  if (/token failed/i.test(text)) {
    throw new Error('C# NVİ köprü token bilgisi hatalı.')
  }

  const parsed = parseBridgeJson(text)
  if (!parsed) {
    throw new Error('C# NVİ köprüsünden okunabilir JSON yanıtı alınamadı.')
  }

  if (method === 'AileNufusKayitOrnegiGetir') {
    return {
      success: true,
      data: parsed,
      meta: { bridgeUrl: baseUrl, method },
      message: 'NVİ aile bilgileri C# köprüsü üzerinden çekildi.',
    }
  }

  if (method === 'AdresBilgisiGetir') {
    const error = parsed?.Aciklama || parsed?.aciklama
    if (error && !parsed?.acikAdres) {
      return { success: false, error: String(error), meta: { bridgeUrl: baseUrl, method } }
    }

    return {
      success: true,
      data: {
        tcKimlikNo: tcNo,
        dogumTarihi: `01.01.${dogumYili}`,
        ...mapBridgeAddress(parsed),
      },
      meta: { bridgeUrl: baseUrl, method },
      message: 'NVİ adres bilgileri C# köprüsü üzerinden çekildi.',
    }
  }

  const mapped = mapBridgePerson(parsed, tcNo, dogumYili)
  if ('error' in mapped) {
    return { success: false, error: mapped.error, meta: { bridgeUrl: baseUrl, method } }
  }

  try {
    const addressBody = new URLSearchParams({
      Token: bridgeToken,
      Tc: tcNo,
      Year: year,
      Month: month,
      Day: day,
    })
    const addressResponse = await fetch(`${baseUrl}/AdresBilgisiGetir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: addressBody,
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
    })
    const addressText = await addressResponse.text()
    const addressParsed = addressResponse.ok ? parseBridgeJson(addressText) : null
    const addressError = addressParsed?.Aciklama || addressParsed?.aciklama
    const address = mapBridgeAddress(addressParsed || {})

    if (address.adres && !addressError) {
      Object.assign(mapped.data, address)
    }
  } catch {
    // Kimlik bilgisi başarılıysa adres hatası form doldurmayı engellemesin.
  }

  return {
    success: true,
    data: mapped.data,
    meta: { bridgeUrl: baseUrl, method },
    message: 'NVİ verileri C# köprüsü üzerinden çekildi.',
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    // [DIS-YUZ INSTANCE] NVİ sorgu yetkisi bu makinenin IP'sine verilmemisse
    // (ör. 88.247.62.145'te / 10.20.1.100'de yayinlanan kopya), istek YETKILI
    // makinedeki nvi-relay servisine iletilir ve cevabi OLDUGU GIBI dondurulur.
    //   NVI_RELAY_URL BOS  -> bu blok hic calismaz, davranis eskisi gibi
    //                         (ana/yetkili sunucuda oyle birakilir).
    //   NVI_RELAY_URL DOLU -> tum NVİ isi karsi tarafta yapilir; burada
    //                         ayrica oturum/hiz siniri/DB'ye bakilmaz.
    const relayUrl = process.env.NVI_RELAY_URL?.trim()
    if (relayUrl) {
      try {
        const relayResponse = await fetch(relayUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-relay-key': process.env.NVI_RELAY_KEY || '',
          },
          body: rawBody || '{}',
          signal: AbortSignal.timeout(30_000),
        })
        const relayText = await relayResponse.text()
        return new NextResponse(relayText, {
          status: relayResponse.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      } catch (relayError) {
        return NextResponse.json(
          {
            success: false,
            error: 'NVİ relay servisine ulaşılamadı.',
            technical: relayError instanceof Error ? relayError.message : String(relayError),
          },
          { status: 502 },
        )
      }
    }

    const { tcNo, dogumYili, dogumTarihi, serviceId } = JSON.parse(rawBody || '{}')
    const selectedServiceId = serviceId || 'tcKimlik'
    const cookieStore = await cookies()
    const sessionUserId = parseSessionValue(readSessionCookie(cookieStore))

    if (sessionUserId) {
      const accessDenied = await requireApiAccess({ action: 'documents.nvi', page: '/documents' })
      if (accessDenied) return accessDenied
    } else if (selectedServiceId !== 'tcKimlik' || !dogumTarihi) {
      return NextResponse.json({ success: false, error: 'Bu NVİ sorgusu için oturum gereklidir.' }, { status: 401 })
    }

    // Oturumlu sorgu: kullanici bazli (getRequestClientKey ters proxy yoksa
    // sabittir, sessionUserId ayirt edicidir). Oturumsuz (public): tek/global
    // kova - asil koruma asagidaki TC bazli sinirdir.
    const rateLimitKey = `nvi:${getRequestClientKey(request)}:${sessionUserId || 'public'}`
    const rateLimit = checkRateLimit(rateLimitKey, {
      limit: sessionUserId ? 200 : 60,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla NVİ sorgusu yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }

    if (!tcNo || !dogumYili) {
      return NextResponse.json({ success: false, error: 'TC No ve doğum yılı zorunludur.' }, { status: 400 })
    }

    // Oturumsuz (public) sorgularda IP bazli sinir tek basina yeterli degil
    // (X-Forwarded-For sahtelenebilir) - AYNI TC numarasina karsi da kaynaktan
    // bagimsiz bir sinir uygulanarak, NVİ (nufus kaydi) sorgusunun IP
    // degistirilerek otomatik taranmasi engellenir.
    if (!sessionUserId) {
      const tcRateLimit = checkRateLimit(`nvi-tc:${String(tcNo)}`, { limit: 15, windowMs: 10 * 60 * 1000 })
      if (!tcRateLimit.allowed) {
        return NextResponse.json(
          { success: false, error: 'Çok fazla NVİ sorgusu yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
          { status: 429, headers: { 'Retry-After': String(tcRateLimit.retryAfterSeconds) } },
        )
      }
    }

    await ensureNviSettingsTable()

    const settings = await prisma.$queryRaw<SettingRow[]>`
      SELECT key, value
      FROM sistem_ayarlar
      WHERE key IN ('nvi_services', 'nvi_creds')
    `
    const servicesSetting = settings.find((setting) => setting.key === 'nvi_services') || { key: 'nvi_services', value: [] }
    const credsSetting = settings.find((setting) => setting.key === 'nvi_creds')

    if (!servicesSetting) {
      return NextResponse.json({ success: false, error: 'NVİ servis ayarları bulunamadı.' }, { status: 404 })
    }

    const services = parseSettingValue<NviService[]>(servicesSetting.value, [])
    const creds = parseSettingValue<NviCredentials>(credsSetting?.value, { user: '', pass: '', useBridge: true })
    const activeService = services.find((service) => service.id === selectedServiceId) || {
      id: selectedServiceId,
      url: defaultServiceUrl,
      enabled: ['tcKimlik', 'adres', 'nufusKayit'].includes(selectedServiceId),
    }

    const canUseBridgeService = ['tcKimlik', 'adres', 'nufusKayit'].includes(selectedServiceId)

    if (!activeService || (!activeService.enabled && !canUseBridgeService)) {
      return NextResponse.json({ success: false, error: 'İlgili NVİ servisi aktif değil.' }, { status: 400 })
    }

    // [DİREKT BAĞLANTI ÖNCELİĞİ] 
    if (canUseBridgeService) {
      const bridgeUrl = resolveBridgeUrl(creds.bridgeUrl)
      const bridgeToken = creds.bridgeToken?.trim() || process.env.NVI_BRIDGE_TOKEN || ''

      if (bridgeToken && /^https?:\/\//i.test(bridgeUrl)) {
        try {
          const bridgeResult = await callNviBridge({
            bridgeUrl,
            bridgeToken,
            tcNo,
            dogumYili,
            dogumTarihi,
            serviceId: selectedServiceId,
          })

          if (bridgeResult.success) {
            return NextResponse.json(bridgeResult)
          }

          return NextResponse.json({
            success: false,
            error: bridgeResult.error || 'KPSV2 servisinden kişi bilgisi alınamadı.',
            meta: bridgeResult.meta,
          }, { status: 502 })
        } catch (bridgeError) {
          console.error('KPSV2 bridge connection error:', bridgeError)
          return NextResponse.json({
            success: false,
            error: 'KPSV2 servisine bağlanılamadı. http://localhost:3500/master.asmx adresinin açık olduğundan emin olun.',
            technical: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
          }, { status: 502 })
        }
      }
    }

    if (activeService.enabled && creds.user && creds.pass) {
      const { method, serviceUrl, soapAction, namespace, isWsdlService, serviceName } = normalizeServiceConfig(activeService)
      const soapEnvelope = buildSoapEnvelope({
        username: creds.user,
        password: creds.pass,
        method,
        tcNo,
        dogumYili,
        namespace,
        isWsdlService,
        serviceName,
      })

      try {
        const headers: Record<string, string> = isWsdlService
          ? {
              'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
            }
          : {
              'Content-Type': 'text/xml; charset=utf-8',
              SOAPAction: soapAction,
            }

        const nviResponse = await fetch(serviceUrl, {
          method: 'POST',
          headers,
          body: soapEnvelope,
          next: { revalidate: 0 },
          signal: AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS),
        })
        const xmlText = await nviResponse.text()
        const faultMsg = getTagValue(xmlText, ['faultstring', 'Text', 'HataBilgisi', 'Aciklama'])

        if (nviResponse.ok && !faultMsg) {
          const personData = mapNviPerson(xmlText, tcNo, dogumYili)
          if (personData.ad) {
            return NextResponse.json({
              success: true,
              data: personData,
              meta: { serviceUrl, method, source: 'direct_nvi' },
              message: 'NVİ verileri doğrudan resmi servislerden başarıyla çekildi.',
            })
          }
        }

        // Eğer direkt bağlantı hata döndürdüyse ve köprü kullanılmayacaksa spesifik hatayı dön
        if (creds.useBridge === false) {
           return NextResponse.json({
             success: false,
             error: faultMsg ? `NVİ Servis Hatası: ${toFriendlyNviError(faultMsg)}` : 'NVİ servisinden geçerli bir yanıt alınamadı.',
             technical: xmlText.substring(0, 1000),
             status: nviResponse.status,
             hint: 'Resmi NVİ sunucusu isteği reddetti. IP adresinizin yetkili olduğundan ve kullanıcı bilgilerinizin doğruluğundan emin olun.'
           }, { status: nviResponse.status === 200 ? 502 : nviResponse.status })
        }
      } catch (directError: any) {
        console.warn('Direct NVI connection failed:', directError)
        if (creds.useBridge === false) {
          return NextResponse.json({
            success: false,
            error: 'NVİ sunucusuna fiziksel bağlantı kurulamadı.',
            technical: directError.message,
            hint: 'Sunucunuzun internet çıkış IP adresi NVİ tarafında tanımlı olmayabilir veya güvenlik duvarı engeline takılıyor olabilirsiniz.'
          }, { status: 504 })
        }
      }
    }

    // [KÖPRÜ (BRIDGE) BAĞLANTISI]
    // Sadece 'useBridge' ayarı aktifse köprüye bağlanılır.
    if (creds.useBridge !== false) {
      const bridgeUrl = resolveBridgeUrl(creds.bridgeUrl)
      const bridgeToken = creds.bridgeToken?.trim() || process.env.NVI_BRIDGE_TOKEN || ''
      const shouldUseBridge = Boolean(bridgeToken) && /^https?:\/\//i.test(bridgeUrl) && ['tcKimlik', 'adres', 'nufusKayit'].includes(selectedServiceId)

      if (shouldUseBridge) {
        try {
          const bridgeResult = await callNviBridge({
            bridgeUrl,
            bridgeToken,
            tcNo,
            dogumYili,
            dogumTarihi,
            serviceId: selectedServiceId,
          })

          if (bridgeResult.success) {
            return NextResponse.json(bridgeResult)
          }
        } catch (bridgeError) {
          console.error('Bridge connection error:', bridgeError)
        }
      }
    }

    return NextResponse.json({ 
      success: false, 
      error: 'NVİ verileri çekilemedi.',
      hint: creds.useBridge === false ? 'Köprü bağlantısı kapalı ve doğrudan bağlantı başarısız oldu.' : 'Hem doğrudan hem de köprü bağlantısı başarısız oldu.'
    }, { status: 503 })
  } catch (error) {
    console.error('NVİ servisi hatasi:', error)
    // Oturumsuz (public) cagiranlara ic sistem/baglanti detayi (ör. koprü
    // sunucusu adresi/hata metni) sizdirilmiyor - sadece oturum acmis
    // personel ekrandaki hata ayrintisini gorebilir (sorun giderme icin).
    let hasSession = false
    try {
      const cookieStore = await cookies()
      hasSession = Boolean(parseSessionValue(readSessionCookie(cookieStore)))
    } catch {}
    const detail = hasSession ? `: ${(error as Error).message}` : ''
    return NextResponse.json({ success: false, error: `NVİ servisine bağlanırken hata oluştu${detail}` }, { status: 500 })
  }
}
